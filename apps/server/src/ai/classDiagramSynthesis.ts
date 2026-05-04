import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  DiagramView,
  LlmClassDiagramMode,
  ProjectGraph,
  Relation,
  RelationType,
  ScanFeatureOption,
  Symbol,
} from "@dmpg/shared";
import { resolveAiConfig } from "../env.js";
import { callAiJson } from "./client.js";
import {
  buildProjectEmbeddingIndex,
  searchProjectEmbeddings,
  type ProjectEmbeddingIndex,
} from "./embeddings.js";
import { resolveModelForTask } from "./modelRouting.js";
import { AI_TASK_TYPES } from "./taskTypes.js";
import {
  CLASS_DIAGRAM_RELATION_TYPES,
  CLASS_DIAGRAM_RELATION_TYPE_SET,
  collectAllowedClassNodeIds,
  ensureClassDiagramViewNodePools,
} from "../scanner/classDiagramViews.js";

export { ensureClassDiagramViewNodePools } from "../scanner/classDiagramViews.js";

const MIN_CONFIDENCE = 0.65;
const UML_MULTIPLICITY_PATTERN = /^(\*|\d+|\d+\.\.\*|\d+\.\.\d+|0\.\.\*|0\.\.1|1\.\.\*)$/;

type ClassDiagramRelationType = typeof CLASS_DIAGRAM_RELATION_TYPES[number];

export interface ClassDiagramSynthesisOptions {
  useEmbeddings?: ScanFeatureOption;
  llmClassDiagramMode?: LlmClassDiagramMode;
  embeddingIndex?: ProjectEmbeddingIndex | null;
  onBatch?: (event: ClassDiagramSynthesisBatchEvent) => void | Promise<void>;
}

export interface ClassDiagramSynthesisBatchEvent {
  viewId?: string;
  current: number;
  total: number;
  relationsAdded: number;
  message: string;
  warnings?: string[];
}

export interface ValidatedClassDiagramRelationSuggestion {
  sourceId: string;
  targetId: string;
  relationType: ClassDiagramRelationType;
  confidence: number;
  label?: string;
  rationale?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceRole?: string;
  targetRole?: string;
}

export interface ClassDiagramSynthesisStats {
  viewsPrepared: number;
  viewsAnalyzed: number;
  relationsAdded: number;
  warnings: string[];
}

function isRelationType(value: unknown): value is ClassDiagramRelationType {
  return typeof value === "string" && CLASS_DIAGRAM_RELATION_TYPE_SET.has(value as RelationType);
}

function normalizeLlmClassDiagramMode(mode: LlmClassDiagramMode | undefined): LlmClassDiagramMode {
  if (!mode || mode === "auto") return "validated_auto_apply";
  if (mode === "validated_auto") return "validated_auto_apply";
  return mode;
}

function shouldApplyLlmSuggestions(mode: LlmClassDiagramMode | undefined): boolean {
  const normalized = normalizeLlmClassDiagramMode(mode);
  return normalized !== "off" && normalized !== "review_only";
}

function relationKey(relation: Pick<Relation, "source" | "target" | "type">): string {
  return `${relation.source}|${relation.target}|${relation.type}`;
}

function relationExists(graph: ProjectGraph, source: string, target: string, type: RelationType): boolean {
  const key = `${source}|${target}|${type}`;
  return graph.relations.some((relation) => relationKey(relation) === key);
}

function optionalString(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function optionalMultiplicity(value: unknown): string | undefined {
  const stringValue = optionalString(value, 16);
  return stringValue && UML_MULTIPLICITY_PATTERN.test(stringValue) ? stringValue : undefined;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function extractRawSuggestions(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const container = raw as { relations?: unknown; suggestions?: unknown };
  if (Array.isArray(container.relations)) return container.relations;
  if (Array.isArray(container.suggestions)) return container.suggestions;
  return [];
}

export function validateClassDiagramRelationSuggestions(
  graph: ProjectGraph,
  view: DiagramView,
  rawSuggestions: unknown,
  allowedNodeIds = collectAllowedClassNodeIds(graph, view),
): ValidatedClassDiagramRelationSuggestion[] {
  const allowed = new Set(allowedNodeIds);
  const accepted: ValidatedClassDiagramRelationSuggestion[] = [];
  const acceptedKeys = new Set<string>();

  for (const raw of extractRawSuggestions(rawSuggestions)) {
    if (!raw || typeof raw !== "object") continue;
    const suggestion = raw as {
      sourceId?: unknown;
      targetId?: unknown;
      relationType?: unknown;
      type?: unknown;
      confidence?: unknown;
      label?: unknown;
      rationale?: unknown;
      sourceMultiplicity?: unknown;
      targetMultiplicity?: unknown;
      sourceRole?: unknown;
      targetRole?: unknown;
    };
    const sourceId = optionalString(suggestion.sourceId, 240);
    const targetId = optionalString(suggestion.targetId, 240);
    const relationType = suggestion.relationType ?? suggestion.type;
    const confidence = normalizeConfidence(suggestion.confidence);

    if (!sourceId || !targetId || sourceId === targetId) continue;
    if (!allowed.has(sourceId) || !allowed.has(targetId)) continue;
    if (!isRelationType(relationType)) continue;
    if (confidence == null || confidence < MIN_CONFIDENCE) continue;
    if (relationExists(graph, sourceId, targetId, relationType)) continue;

    const key = `${sourceId}|${targetId}|${relationType}`;
    if (acceptedKeys.has(key)) continue;
    acceptedKeys.add(key);

    accepted.push({
      sourceId,
      targetId,
      relationType,
      confidence,
      label: optionalString(suggestion.label),
      rationale: optionalString(suggestion.rationale, 500),
      sourceMultiplicity: optionalMultiplicity(suggestion.sourceMultiplicity),
      targetMultiplicity: optionalMultiplicity(suggestion.targetMultiplicity),
      sourceRole: optionalString(suggestion.sourceRole, 80),
      targetRole: optionalString(suggestion.targetRole, 80),
    });
  }

  return accepted;
}

function stableAiRelationId(suggestion: ValidatedClassDiagramRelationSuggestion, existingIds: Set<string>): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${suggestion.sourceId}|${suggestion.targetId}|${suggestion.relationType}|${suggestion.label ?? ""}`)
    .digest("hex")
    .slice(0, 10);
  let id = `ai-class-rel-${hash}`;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `ai-class-rel-${hash}-${suffix++}`;
  }
  existingIds.add(id);
  return id;
}

export function applyClassDiagramSuggestions(
  graph: ProjectGraph,
  view: DiagramView,
  suggestions: readonly ValidatedClassDiagramRelationSuggestion[],
): number {
  const existingIds = new Set(graph.relations.map((relation) => relation.id));
  const viewEdgeRefs = new Set(view.edgeRefs);
  const viewNodeRefs = new Set(view.nodeRefs);
  let added = 0;

  for (const suggestion of suggestions) {
    if (relationExists(graph, suggestion.sourceId, suggestion.targetId, suggestion.relationType)) continue;
    const relation: Relation = {
      id: stableAiRelationId(suggestion, existingIds),
      type: suggestion.relationType,
      source: suggestion.sourceId,
      target: suggestion.targetId,
      confidence: suggestion.confidence,
      label: suggestion.label,
      sourceMultiplicity: suggestion.sourceMultiplicity,
      targetMultiplicity: suggestion.targetMultiplicity,
      sourceRole: suggestion.sourceRole,
      targetRole: suggestion.targetRole,
      evidence: suggestion.rationale
        ? [{ file: "llm:class-diagram", snippet: suggestion.rationale }]
        : undefined,
      aiGenerated: true,
    };
    graph.relations.push(relation);
    if (viewNodeRefs.has(relation.source) && viewNodeRefs.has(relation.target)) {
      viewEdgeRefs.add(relation.id);
    }
    added++;
  }

  view.edgeRefs = [...viewEdgeRefs];
  return added;
}

export interface ClassDiagramLlmSynthesisStatus {
  enabled: boolean;
  reason?: string;
}

export function resolveClassDiagramLlmSynthesisStatus(
  mode: LlmClassDiagramMode | undefined,
): ClassDiagramLlmSynthesisStatus {
  const normalized = normalizeLlmClassDiagramMode(mode);
  if (!shouldApplyLlmSuggestions(normalized)) {
    return { enabled: false, reason: `llmClassDiagramMode=${normalized}` };
  }

  const aiConfig = resolveAiConfig();
  const model = resolveModelForTask(AI_TASK_TYPES.CODE_ANALYSIS, aiConfig).model.trim();
  if (!model) {
    return { enabled: false, reason: "no code-analysis model configured" };
  }
  if (aiConfig.provider !== "local" && !aiConfig.apiKey) {
    return { enabled: false, reason: "cloud provider has no API key" };
  }
  return { enabled: true };
}

function readSourceSnippet(symbol: Symbol, projectPath: string): string | undefined {
  const file = symbol.location?.file;
  if (!file) return undefined;
  const absolutePath = path.isAbsolute(file) ? file : path.join(projectPath, file);
  try {
    const source = fs.readFileSync(absolutePath, "utf-8");
    const lines = source.split(/\r?\n/);
    const startLine = Math.max(1, symbol.location?.startLine ?? 1);
    const endLine = Math.min(lines.length, symbol.location?.endLine ?? startLine + 80);
    return lines.slice(startLine - 1, endLine).join("\n").slice(0, 1800);
  } catch {
    return undefined;
  }
}

function symbolPromptEntry(symbol: Symbol): string {
  const location = symbol.location?.file ? ` file=${symbol.location.file}` : "";
  const summary = symbol.doc?.summary ? ` summary=${symbol.doc.summary.slice(0, 140)}` : "";
  return `- id=${symbol.id} label=${symbol.label} kind=${symbol.kind}${location}${summary}`;
}

function relationPromptEntry(graph: ProjectGraph, relation: Relation): string {
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const source = symbolsById.get(relation.source)?.label ?? relation.source;
  const target = symbolsById.get(relation.target)?.label ?? relation.target;
  const label = relation.label ? ` label=${relation.label}` : "";
  const roles = [relation.sourceRole, relation.targetRole].filter(Boolean).join("/");
  const roleText = roles ? ` roles=${roles}` : "";
  return `- ${relation.type}: ${relation.source} (${source}) -> ${relation.target} (${target})${label}${roleText}`;
}

async function collectEmbeddingSnippets(
  embeddingIndex: ProjectEmbeddingIndex | null,
  query: string,
): Promise<string[]> {
  if (!embeddingIndex || embeddingIndex.entries.length === 0) return [];
  try {
    const matches = await searchProjectEmbeddings(embeddingIndex, query, 5);
    return matches.map((match) =>
      `File: ${match.entry.filePath}\nScore: ${match.score.toFixed(3)}\n${match.entry.text.slice(0, 1600)}`,
    );
  } catch {
    return [];
  }
}

async function synthesizeViewRelations(params: {
  graph: ProjectGraph;
  view: DiagramView;
  projectPath: string;
  allowedNodeIds: string[];
  embeddingIndex: ProjectEmbeddingIndex | null;
}): Promise<ValidatedClassDiagramRelationSuggestion[]> {
  const { graph, view, projectPath, allowedNodeIds, embeddingIndex } = params;
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const allowedSymbols = allowedNodeIds
    .map((symbolId) => symbolsById.get(symbolId))
    .filter((symbol): symbol is Symbol => Boolean(symbol));
  const allowedSet = new Set(allowedNodeIds);
  const existingRelations = graph.relations.filter((relation) =>
    CLASS_DIAGRAM_RELATION_TYPE_SET.has(relation.type) &&
    allowedSet.has(relation.source) &&
    allowedSet.has(relation.target),
  );
  const query = `${view.title}\n${allowedSymbols.map((symbol) => symbol.label).join(" ")}`;
  const embeddingSnippets = await collectEmbeddingSnippets(embeddingIndex, query);
  const fallbackSnippets = embeddingSnippets.length > 0
    ? []
    : allowedSymbols
      .slice(0, 8)
      .map((symbol) => {
        const snippet = readSourceSnippet(symbol, projectPath);
        return snippet ? `File: ${symbol.location?.file ?? symbol.id}\n${snippet}` : "";
      })
      .filter(Boolean);
  const contextSnippets = [...embeddingSnippets, ...fallbackSnippets].slice(0, 6);

  const systemPrompt = `You synthesize UML class diagram relationships from code context.
Return only JSON. You may only use these relationType values: inherits, realizes, association, aggregation, composition, dependency, instantiates.
Use only provided sourceId and targetId values. Prefer no suggestion over speculation.`;

  const userPrompt = `View: ${view.id} - ${view.title}

Allowed node pool:
${allowedSymbols.slice(0, 60).map(symbolPromptEntry).join("\n")}

Existing class relations:
${existingRelations.length > 0 ? existingRelations.slice(0, 80).map((relation) => relationPromptEntry(graph, relation)).join("\n") : "none"}

Relevant project context:
${contextSnippets.length > 0 ? contextSnippets.map((snippet, index) => `Context ${index + 1}:\n${snippet}`).join("\n\n") : "No extra snippets available."}

Return JSON exactly in this shape:
{
  "viewId": "${view.id}",
  "relations": [
    {
      "sourceId": "one allowed id",
      "targetId": "one allowed id",
      "relationType": "inherits|realizes|association|aggregation|composition|dependency|instantiates",
      "label": "optional concise label",
      "sourceMultiplicity": "optional UML multiplicity",
      "targetMultiplicity": "optional UML multiplicity",
      "sourceRole": "optional source role",
      "targetRole": "optional target role",
      "confidence": 0.0,
      "rationale": "short evidence-based reason"
    }
  ]
}`;

  const response = await callAiJson({
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    systemPrompt,
    userPrompt,
    responseFormat: "json",
    requestOptions: { temperature: 0 },
  });

  return validateClassDiagramRelationSuggestions(graph, view, response.data, allowedNodeIds);
}

function maxViewsForSynthesis(): number {
  const raw = process.env.UML_CLASS_DIAGRAM_LLM_MAX_VIEWS;
  if (!raw) return 12;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
}

function isAiAccessError(message: string): boolean {
  return /\bOllama error (401|402|403)\b/i.test(message) ||
    /\b(unauthorized|forbidden)\b/i.test(message) ||
    /requires a subscription|upgrade for access/i.test(message);
}

function summarizeAiAccessError(message: string): string {
  const status = message.match(/\bOllama error (\d+)\b/i)?.[1];
  if (/requires a subscription|upgrade for access/i.test(message)) {
    return `Ollama ${status ?? "403"}: selected model requires a subscription or upgrade`;
  }
  if (/\bunauthorized\b/i.test(message) || status === "401") {
    return `Ollama ${status ?? "401"}: unauthorized`;
  }
  if (/\bforbidden\b/i.test(message) || status === "403") {
    return `Ollama ${status ?? "403"}: forbidden`;
  }
  return message.slice(0, 220);
}

export async function synthesizeClassDiagramsForGraph(
  graph: ProjectGraph,
  projectPath: string,
  options: ClassDiagramSynthesisOptions = {},
): Promise<ClassDiagramSynthesisStats> {
  const warnings: string[] = [];
  const viewsPrepared = ensureClassDiagramViewNodePools(graph);

  const llmStatus = resolveClassDiagramLlmSynthesisStatus(options.llmClassDiagramMode);
  if (!llmStatus.enabled) {
    if (viewsPrepared > 0) {
      warnings.push(
        `LLM class diagram synthesis skipped: ${llmStatus.reason}. Deterministic class views were normalized.`,
      );
    }
    return { viewsPrepared, viewsAnalyzed: 0, relationsAdded: 0, warnings };
  }

  const hasProvidedEmbeddingIndex = options.embeddingIndex !== undefined;
  let embeddingIndex: ProjectEmbeddingIndex | null;
  if (hasProvidedEmbeddingIndex) {
    embeddingIndex = options.embeddingIndex ?? null;
  } else {
    embeddingIndex = await buildProjectEmbeddingIndex(projectPath, {
      useEmbeddings: options.useEmbeddings,
    });
  }
  if (embeddingIndex && !hasProvidedEmbeddingIndex) warnings.push(...embeddingIndex.warnings);

  const candidates = graph.views
    .filter((view) => view.diagramType === "class")
    .map((view) => ({ view, allowedNodeIds: collectAllowedClassNodeIds(graph, view) }))
    .filter((candidate) => candidate.allowedNodeIds.length >= 2)
    .slice(0, maxViewsForSynthesis());

  let viewsAnalyzed = 0;
  let relationsAdded = 0;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    try {
      const suggestions = await synthesizeViewRelations({
        graph,
        view: candidate.view,
        projectPath,
        allowedNodeIds: candidate.allowedNodeIds,
        embeddingIndex,
      });
      viewsAnalyzed++;
      const addedForView = applyClassDiagramSuggestions(graph, candidate.view, suggestions);
      relationsAdded += addedForView;
      await options.onBatch?.({
        viewId: candidate.view.id,
        current: index + 1,
        total: candidates.length,
        relationsAdded,
        message: `LLM class diagram batch ${index + 1}/${candidates.length}: ${candidate.view.title} (${addedForView} relations added)`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (isAiAccessError(message)) {
        const warning =
          `Class diagram synthesis stopped: ${summarizeAiAccessError(message)}. ` +
          "Check OLLAMA_MODEL/OLLAMA_API_KEY or disable LLM class synthesis with llmClassDiagramMode=off.";
        warnings.push(warning);
        await options.onBatch?.({
          viewId: candidate.view.id,
          current: index + 1,
          total: candidates.length,
          relationsAdded,
          message: warning,
          warnings: [warning],
        });
        break;
      }
      const warning = `Class diagram synthesis skipped for ${candidate.view.id}: ${message}`;
      warnings.push(warning);
      await options.onBatch?.({
        viewId: candidate.view.id,
        current: index + 1,
        total: candidates.length,
        relationsAdded,
        message: warning,
        warnings: [warning],
      });
    }
  }

  return { viewsPrepared, viewsAnalyzed, relationsAdded, warnings };
}
