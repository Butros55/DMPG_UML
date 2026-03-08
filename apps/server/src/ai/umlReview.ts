import type {
  AiExternalContextReviewResponse,
  AiLabelImprovementResponse,
  AiRelationSuggestion,
  AiStructureReviewResponse,
  AiSymbolEnrichmentResponse,
  DiagramView,
  ExternalContextSuggestion,
  LabelImprovement,
  ProjectGraph,
  Relation,
  RelationType,
  Symbol as Sym,
  ViewReviewIssue,
} from "@dmpg/shared";
import {
  AiExternalContextReviewResponseSchema,
  AiLabelImprovementResponseSchema,
  AiStructureReviewResponseSchema,
  AiSymbolEnrichmentResponseSchema,
} from "@dmpg/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveAiConfig, type AiConfig } from "../env.js";
import { callAiJson } from "./client.js";
import { resolveModelForTask } from "./modelRouting.js";
import { AI_USE_CASES, getTaskTypeForUseCase, type AiUseCase } from "./useCases.js";

const ENRICHABLE_SYMBOL_KINDS = new Set(["function", "method", "class", "module", "script", "package"]);
const NON_STRUCTURAL_RELATION_TYPES = new Set<RelationType>(["contains"]);
const AI_DISCOVERABLE_RELATION_TYPES = [
  "calls",
  "reads",
  "writes",
  "uses_config",
  "instantiates",
] as const satisfies readonly RelationType[];
const AI_DISCOVERABLE_RELATION_TYPE_SET = new Set<string>(AI_DISCOVERABLE_RELATION_TYPES);

type AiDiscoverableRelationType = typeof AI_DISCOVERABLE_RELATION_TYPES[number];

interface AiRelationCandidate {
  type: AiDiscoverableRelationType;
  targetName: string;
  confidence?: number;
  rationale?: string;
}

export interface UmlViewHeuristics {
  viewId: string;
  nodeCount: number;
  internalEdgeCount: number;
  externalDependencyCount: number;
  isolatedNodeCount: number;
  isolatedNodeRatio: number;
  edgeDensity: number;
  layoutPattern: "unknown" | "stacked" | "distributed";
  sparse: boolean;
  reasons: string[];
  applicableUseCases: AiUseCase[];
}

export interface UmlViewOpportunity extends UmlViewHeuristics {
  title: string;
  resolvedModels: Array<{
    useCase: AiUseCase;
    taskType: string;
    model: string;
    source: string;
  }>;
}

export interface EnrichViewSymbolsResult {
  viewId: string;
  enriched: AiSymbolEnrichmentResponse[];
  skippedSymbolIds: string[];
}

export interface SuggestMissingRelationsResult {
  viewId: string;
  suggestions: AiRelationSuggestion[];
  appliedRelationIds: string[];
}

export interface ReviewViewStructureResult {
  review: AiStructureReviewResponse;
  heuristics: UmlViewHeuristics;
  contextReview?: AiExternalContextReviewResponse;
}

function isNonStructuralRelation(rel: Relation): boolean {
  return !NON_STRUCTURAL_RELATION_TYPES.has(rel.type);
}

function isEnrichableSymbol(sym: Sym): boolean {
  return ENRICHABLE_SYMBOL_KINDS.has(sym.kind);
}

function findView(graph: ProjectGraph, viewId: string): DiagramView {
  const view = graph.views.find((candidate) => candidate.id === viewId);
  if (!view) throw new Error(`View not found: ${viewId}`);
  return view;
}

function findSymbol(graph: ProjectGraph, symbolId: string): Sym {
  const sym = graph.symbols.find((candidate) => candidate.id === symbolId);
  if (!sym) throw new Error(`Symbol not found: ${symbolId}`);
  return sym;
}

function getViewSymbols(graph: ProjectGraph, view: DiagramView): Sym[] {
  const nodeIds = new Set(view.nodeRefs);
  return graph.symbols.filter((sym) => nodeIds.has(sym.id));
}

function getViewRelations(graph: ProjectGraph, view: DiagramView) {
  const nodeIds = new Set(view.nodeRefs);
  const internal = graph.relations.filter((rel) =>
    isNonStructuralRelation(rel) && nodeIds.has(rel.source) && nodeIds.has(rel.target)
  );
  const external = graph.relations.filter((rel) =>
    isNonStructuralRelation(rel) && (nodeIds.has(rel.source) !== nodeIds.has(rel.target))
  );
  return { internal, external };
}

function detectLayoutPattern(view: DiagramView): UmlViewHeuristics["layoutPattern"] {
  if (!view.nodePositions || view.nodePositions.length < 3) return "unknown";
  const xs = view.nodePositions.map((position) => position.x);
  const ys = view.nodePositions.map((position) => position.y);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  if (xRange <= 220 && yRange > Math.max(320, xRange * 1.5)) return "stacked";
  return "distributed";
}

function countMissingDocFields(symbols: readonly Sym[]): number {
  return symbols.filter((sym) =>
    isEnrichableSymbol(sym) &&
    (
      !sym.doc?.summary ||
      sym.doc.summary.trim().length < 12 ||
      !sym.doc.inputs?.length ||
      !sym.doc.outputs?.length
    )
  ).length;
}

function countLabelProblems(view: DiagramView, symbols: readonly Sym[]): number {
  const suspicious = (label: string) =>
    label.length > 32 ||
    label.includes("/") ||
    label.includes("\\") ||
    label.split(".").length > 3;

  return [
    suspicious(view.title) ? 1 : 0,
    ...symbols.map((sym) => suspicious(sym.label) || sym.kind === "group" ? 1 : 0),
  ].reduce((total, value) => total + value, 0);
}

export function buildViewHeuristics(graph: ProjectGraph, viewId: string): UmlViewHeuristics {
  const view = findView(graph, viewId);
  const symbols = getViewSymbols(graph, view);
  const { internal, external } = getViewRelations(graph, view);
  const degreeCount = new Map<string, number>();
  for (const sym of symbols) degreeCount.set(sym.id, 0);
  for (const rel of internal) {
    degreeCount.set(rel.source, (degreeCount.get(rel.source) ?? 0) + 1);
    degreeCount.set(rel.target, (degreeCount.get(rel.target) ?? 0) + 1);
  }

  const isolatedNodeCount = symbols.filter((sym) => (degreeCount.get(sym.id) ?? 0) === 0).length;
  const nodeCount = symbols.length;
  const internalEdgeCount = internal.length;
  const isolatedNodeRatio = nodeCount > 0 ? isolatedNodeCount / nodeCount : 0;
  const possibleEdges = nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 0;
  const edgeDensity = possibleEdges > 0 ? internalEdgeCount / possibleEdges : 0;
  const layoutPattern = detectLayoutPattern(view);
  const reasons: string[] = [];

  if (nodeCount >= 4 && internalEdgeCount <= Math.max(1, Math.floor(nodeCount / 4))) {
    reasons.push("Very few internal relations are visible for the number of nodes.");
  }
  if (nodeCount >= 4 && isolatedNodeRatio >= 0.5) {
    reasons.push("More than half of the nodes are isolated inside the current view.");
  }
  if (external.length >= Math.max(4, internalEdgeCount * 2) && internalEdgeCount <= 2) {
    reasons.push("External dependencies dominate the view while internal context is weak.");
  }
  if (layoutPattern === "stacked" && internalEdgeCount <= 1 && nodeCount >= 4) {
    reasons.push("The node layout looks like a vertical list instead of a connected UML slice.");
  }

  const applicableUseCases: AiUseCase[] = [AI_USE_CASES.UML_STRUCTURE_REVIEW];
  if (countMissingDocFields(symbols) > 0) {
    applicableUseCases.push(AI_USE_CASES.UML_SYMBOL_ENRICHMENT);
  }
  if (symbols.some((sym) => ["function", "method", "class"].includes(sym.kind) && sym.location)) {
    applicableUseCases.push(AI_USE_CASES.UML_RELATION_ENRICHMENT);
  }
  if (countLabelProblems(view, symbols) > 0) {
    applicableUseCases.push(AI_USE_CASES.UML_LABEL_IMPROVEMENT);
  }
  if (reasons.length > 0 || external.length > internal.length) {
    applicableUseCases.push(AI_USE_CASES.UML_EXTERNAL_CONTEXT_REVIEW);
  }

  return {
    viewId,
    nodeCount,
    internalEdgeCount,
    externalDependencyCount: external.length,
    isolatedNodeCount,
    isolatedNodeRatio,
    edgeDensity,
    layoutPattern,
    sparse: reasons.length > 0,
    reasons,
    applicableUseCases,
  };
}

export function collectViewOpportunities(
  graph: ProjectGraph,
  aiConfig: AiConfig = resolveAiConfig(),
): UmlViewOpportunity[] {
  return graph.views.map((view) => {
    const heuristics = buildViewHeuristics(graph, view.id);
    return {
      ...heuristics,
      title: view.title,
      resolvedModels: heuristics.applicableUseCases.map((useCase) => {
        const taskType = getTaskTypeForUseCase(useCase);
        const model = resolveModelForTask(taskType, aiConfig);
        return {
          useCase,
          taskType,
          model: model.model,
          source: model.source,
        };
      }),
    };
  });
}

export function readSourceCodeForSymbol(sym: Sym, scanRoot?: string): string | undefined {
  const loc = sym.location;
  if (!loc?.file) return undefined;

  const absPath = path.isAbsolute(loc.file) ? loc.file : path.join(scanRoot ?? "", loc.file);
  try {
    const src = fs.readFileSync(absPath, "utf-8");
    const lines = src.split("\n");
    const start = Math.max(0, (loc.startLine ?? 1) - 1);
    const end = loc.endLine != null ? loc.endLine : Math.min(start + 80, lines.length);
    return lines.slice(start, end).join("\n");
  } catch {
    return undefined;
  }
}

function buildSymbolRelationContext(graph: ProjectGraph, symbolId: string): string {
  return graph.relations
    .filter((rel) => isNonStructuralRelation(rel) && (rel.source === symbolId || rel.target === symbolId))
    .slice(0, 10)
    .map((rel) => {
      const otherId = rel.source === symbolId ? rel.target : rel.source;
      const other = graph.symbols.find((sym) => sym.id === otherId);
      return `${rel.type} ${rel.source === symbolId ? "->" : "<-"} ${other?.label ?? otherId}`;
    })
    .join(", ");
}

function applySymbolEnrichment(sym: Sym, enrichment: AiSymbolEnrichmentResponse): string[] {
  const updatedFields: string[] = [];
  const aiGenerated = { ...(sym.doc?.aiGenerated ?? {}) };

  if ((!sym.doc?.summary || sym.doc.summary.trim().length < 12) && enrichment.summary) {
    sym.doc = { ...(sym.doc ?? {}), summary: enrichment.summary };
    aiGenerated.summary = true;
    updatedFields.push("summary");
  }

  if ((!sym.doc?.inputs || sym.doc.inputs.length === 0) && enrichment.inputs?.length) {
    sym.doc = { ...(sym.doc ?? {}), inputs: enrichment.inputs };
    aiGenerated.inputs = true;
    updatedFields.push("inputs");
  }

  if ((!sym.doc?.outputs || sym.doc.outputs.length === 0) && enrichment.outputs?.length) {
    sym.doc = { ...(sym.doc ?? {}), outputs: enrichment.outputs };
    aiGenerated.outputs = true;
    updatedFields.push("outputs");
  }

  if (updatedFields.length > 0) {
    sym.doc = { ...(sym.doc ?? {}), aiGenerated };
  }

  return updatedFields;
}

export async function enrichSymbolInGraph(
  graph: ProjectGraph,
  symbolId: string,
  scanRoot?: string,
): Promise<{ enrichment: AiSymbolEnrichmentResponse; updatedFields: string[] }> {
  const sym = findSymbol(graph, symbolId);
  const code = readSourceCodeForSymbol(sym, scanRoot);

  if (!code) {
    throw new Error(`No source code available for symbol ${sym.label}`);
  }

  const { data } = await callAiJson({
    taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_SYMBOL_ENRICHMENT),
    systemPrompt: `You enrich UML symbol documentation for a software architecture graph.
Return JSON exactly in this format:
{
  "symbolId": "${sym.id}",
  "summary": "short description",
  "inputs": [{"name": "param", "type": "Type", "description": "what it means"}],
  "outputs": [{"name": "result", "type": "Type", "description": "what is returned"}],
  "confidence": 0.0
}
Rules:
- Focus on concise UML-friendly documentation, not implementation trivia
- Only include fields you can infer with high confidence
- Use an empty array for inputs/outputs only if the symbol clearly has none
- summary should be max 180 chars
- confidence must be between 0 and 1
Respond ONLY with valid JSON.`,
    userPrompt: `Symbol: ${sym.label}
Kind: ${sym.kind}
Known relations: ${buildSymbolRelationContext(graph, sym.id) || "none"}
Code:
${code.slice(0, 3000)}`,
  });

  const parsed = AiSymbolEnrichmentResponseSchema.safeParse({
    ...(typeof data === "object" && data ? data : {}),
    symbolId: sym.id,
  });
  if (!parsed.success) {
    throw new Error(`AI symbol enrichment failed validation: ${parsed.error.message}`);
  }

  const updatedFields = applySymbolEnrichment(sym, parsed.data);
  return { enrichment: parsed.data, updatedFields };
}

export async function enrichViewSymbolsInGraph(
  graph: ProjectGraph,
  viewId: string,
  scanRoot?: string,
  limit = 12,
): Promise<EnrichViewSymbolsResult> {
  const view = findView(graph, viewId);
  const candidates = getViewSymbols(graph, view)
    .filter((sym) =>
      isEnrichableSymbol(sym) &&
      (
        !sym.doc?.summary ||
        sym.doc.summary.trim().length < 12 ||
        !sym.doc.inputs?.length ||
        !sym.doc.outputs?.length
      )
    )
    .slice(0, limit);

  const enriched: AiSymbolEnrichmentResponse[] = [];
  const skippedSymbolIds: string[] = [];

  for (const sym of candidates) {
    try {
      const { enrichment } = await enrichSymbolInGraph(graph, sym.id, scanRoot);
      enriched.push(enrichment);
    } catch {
      skippedSymbolIds.push(sym.id);
    }
  }

  return { viewId, enriched, skippedSymbolIds };
}

function buildLabelIndex(graph: ProjectGraph): Map<string, string[]> {
  const labelToIds = new Map<string, string[]>();
  for (const sym of graph.symbols) {
    const short = sym.label.split(".").pop()?.toLowerCase() ?? sym.label.toLowerCase();
    const full = sym.label.toLowerCase();

    for (const key of new Set([short, full])) {
      const existing = labelToIds.get(key) ?? [];
      existing.push(sym.id);
      labelToIds.set(key, existing);
    }
  }
  return labelToIds;
}

function isAiDiscoverableRelationType(value: unknown): value is AiDiscoverableRelationType {
  return typeof value === "string" && AI_DISCOVERABLE_RELATION_TYPE_SET.has(value);
}

function normalizeRelationCandidate(raw: unknown): AiRelationCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const rel = raw as {
    type?: unknown;
    targetName?: unknown;
    confidence?: unknown;
    reason?: unknown;
    rationale?: unknown;
  };

  if (!isAiDiscoverableRelationType(rel.type)) return null;
  const targetName = typeof rel.targetName === "string" ? rel.targetName.trim() : "";
  if (!targetName) return null;

  const rationale = typeof rel.rationale === "string"
    ? rel.rationale.trim()
    : (typeof rel.reason === "string" ? rel.reason.trim() : undefined);
  const confidence = typeof rel.confidence === "number" && Number.isFinite(rel.confidence)
    ? Math.max(0, Math.min(1, rel.confidence))
    : undefined;

  return {
    type: rel.type,
    targetName,
    confidence,
    rationale: rationale && rationale.length > 0 ? rationale : undefined,
  };
}

function normalizeRelationCandidateList(raw: unknown): AiRelationCandidate[] {
  if (!Array.isArray(raw)) return [];

  const deduped = new Map<string, AiRelationCandidate>();
  for (const candidate of raw.slice(0, 8)) {
    const normalized = normalizeRelationCandidate(candidate);
    if (!normalized) continue;
    const key = `${normalized.type}|${normalized.targetName.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }
  return Array.from(deduped.values());
}

function describeExistingRelationsForSymbol(graph: ProjectGraph, symbolId: string): string {
  return graph.relations
    .filter((rel) => isNonStructuralRelation(rel) && (rel.source === symbolId || rel.target === symbolId))
    .map((rel) => {
      const other = graph.symbols.find((sym) => sym.id === (rel.source === symbolId ? rel.target : rel.source));
      return `${rel.type}: ${rel.source === symbolId ? "->" : "<-"} ${other?.label ?? "?"}`;
    })
    .join(", ");
}

async function discoverRelationCandidatesForSymbol(
  graph: ProjectGraph,
  sym: Sym,
  code: string,
): Promise<AiRelationCandidate[]> {
  const { data } = await callAiJson({
    taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_RELATION_ENRICHMENT),
    systemPrompt: `You suggest missing UML relations from source code.
Return JSON exactly like this:
{"relations": [{"type": "calls"|"reads"|"writes"|"uses_config"|"instantiates", "targetName": "Name", "confidence": 0.0, "rationale": "brief evidence"}]}
Rules:
- Only include relations directly supported by the code
- targetName must be a symbol name or short identifier visible in code
- Skip trivial built-ins like print, len, str
- Maximum 8 candidates
- confidence must be between 0 and 1
Respond ONLY with valid JSON.`,
    userPrompt: `Symbol: ${sym.label} (${sym.kind})
Existing relations: ${describeExistingRelationsForSymbol(graph, sym.id) || "none"}
Code:
${code.slice(0, 2500)}`,
  });

  return normalizeRelationCandidateList((data as { relations?: unknown } | null)?.relations);
}

async function validateRelationCandidatesForSymbol(
  sym: Sym,
  code: string,
  existingRelationsSummary: string,
  candidates: AiRelationCandidate[],
): Promise<AiRelationCandidate[]> {
  if (candidates.length === 0) return [];

  try {
    const { data } = await callAiJson({
      taskType: getTaskTypeForUseCase(AI_USE_CASES.RELATION_VALIDATION),
      systemPrompt: `You validate proposed UML relations before they are persisted.
Return JSON exactly like this:
{"relations": [{"type": "calls"|"reads"|"writes"|"uses_config"|"instantiates", "targetName": "Name", "confidence": 0.0, "rationale": "brief evidence"}]}
Rules:
- Keep only candidates that are clearly justified by the code
- Reuse the provided targetName values instead of inventing new ones
- Remove speculative or duplicate relations
- Return {"relations": []} if nothing is plausible
Respond ONLY with valid JSON.`,
      userPrompt: `Symbol: ${sym.label} (${sym.kind})
Existing relations: ${existingRelationsSummary || "none"}
Candidate relations:
${JSON.stringify(candidates, null, 2)}
Code:
${code.slice(0, 2500)}`,
    });

    const validated = normalizeRelationCandidateList((data as { relations?: unknown } | null)?.relations);
    return validated.length > 0 ? validated : [];
  } catch {
    return candidates;
  }
}

function resolveCandidateTargetIds(labelIndex: Map<string, string[]>, targetName: string): string[] {
  const normalized = targetName.toLowerCase().trim();
  const direct = labelIndex.get(normalized);
  if (direct?.length) return direct;

  for (const [key, ids] of labelIndex) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return ids;
    }
  }
  return [];
}

function applyRelationSuggestionToGraph(graph: ProjectGraph, suggestion: AiRelationSuggestion): string {
  const relationId = `ai-rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const relation: Relation = {
    id: relationId,
    type: suggestion.relationType,
    source: suggestion.sourceId,
    target: suggestion.targetId,
    label: suggestion.label ?? suggestion.relationType,
    confidence: suggestion.confidence,
    aiGenerated: true,
  };
  graph.relations.push(relation);

  for (const view of graph.views) {
    if (view.nodeRefs.includes(relation.source) && view.nodeRefs.includes(relation.target) && !view.edgeRefs.includes(relation.id)) {
      view.edgeRefs.push(relation.id);
    }
  }

  return relationId;
}

export async function suggestMissingRelationsForView(
  graph: ProjectGraph,
  viewId: string,
  scanRoot?: string,
  limit = 15,
  apply = true,
): Promise<SuggestMissingRelationsResult> {
  const view = findView(graph, viewId);
  const candidates = getViewSymbols(graph, view)
    .filter((sym) => ["function", "method", "class"].includes(sym.kind) && sym.location)
    .slice(0, limit);
  const labelIndex = buildLabelIndex(graph);
  const existingKeys = new Set(graph.relations.map((rel) => `${rel.source}|${rel.target}|${rel.type}`));
  const suggestions: AiRelationSuggestion[] = [];
  const appliedRelationIds: string[] = [];

  for (const sym of candidates) {
    const code = readSourceCodeForSymbol(sym, scanRoot);
    if (!code) continue;

    const discovered = await discoverRelationCandidatesForSymbol(graph, sym, code);
    const approved = await validateRelationCandidatesForSymbol(
      sym,
      code,
      describeExistingRelationsForSymbol(graph, sym.id),
      discovered,
    );

    for (const rel of approved.slice(0, 8)) {
      const targetIds = resolveCandidateTargetIds(labelIndex, rel.targetName);
      for (const targetId of targetIds.slice(0, 1)) {
        if (targetId === sym.id) continue;
        const dedupKey = `${sym.id}|${targetId}|${rel.type}`;
        if (existingKeys.has(dedupKey)) continue;
        existingKeys.add(dedupKey);

        const suggestion: AiRelationSuggestion = {
          sourceId: sym.id,
          targetId,
          relationType: rel.type,
          label: rel.type,
          rationale: rel.rationale,
          confidence: rel.confidence ?? 0.7,
        };
        suggestions.push(suggestion);

        if (apply) {
          appliedRelationIds.push(applyRelationSuggestionToGraph(graph, suggestion));
        }
      }
    }
  }

  return { viewId, suggestions, appliedRelationIds };
}

function buildHeuristicIssues(view: DiagramView, heuristics: UmlViewHeuristics, graph: ProjectGraph): ViewReviewIssue[] {
  const issues: ViewReviewIssue[] = [];

  if (heuristics.sparse) {
    issues.push({
      type: "sparse_view",
      severity: heuristics.externalDependencyCount > heuristics.internalEdgeCount ? "high" : "medium",
      message: heuristics.reasons.join(" "),
      suggestedAction: "Add key dependencies or domain context before restructuring the view.",
      targetIds: view.nodeRefs.slice(0, 12),
    });
  }

  if (heuristics.externalDependencyCount >= Math.max(4, heuristics.internalEdgeCount * 2)) {
    issues.push({
      type: "missing_context",
      severity: "medium",
      message: "Important external dependencies exist outside the view but are not represented as context.",
      suggestedAction: "Add context stubs or aggregated dependency nodes for the strongest external collaborators.",
      targetIds: view.nodeRefs.slice(0, 12),
    });
  }

  const groupNodes = getViewSymbols(graph, view).filter((sym) => sym.kind === "group");
  for (const group of groupNodes) {
    const memberCount = graph.symbols.filter((sym) => sym.parentId === group.id && view.nodeRefs.includes(sym.id)).length;
    if (memberCount > 10) {
      issues.push({
        type: "group_too_broad",
        severity: "medium",
        message: `Group "${group.label}" contains ${memberCount} direct members in this view and may be too broad.`,
        suggestedAction: "Split the group into 2-4 thematic sub-groups.",
        targetIds: [group.id],
      });
    } else if (memberCount > 0 && memberCount < 3) {
      issues.push({
        type: "group_too_thin",
        severity: "low",
        message: `Group "${group.label}" contains only ${memberCount} visible members and may be too thin.`,
        suggestedAction: "Merge it with a neighboring domain group or widen its responsibility.",
        targetIds: [group.id],
      });
    }
  }

  return issues;
}

function dedupeIssues(issues: readonly ViewReviewIssue[]): ViewReviewIssue[] {
  const deduped = new Map<string, ViewReviewIssue>();
  for (const issue of issues) {
    const key = `${issue.type}|${issue.message}`;
    if (!deduped.has(key)) {
      deduped.set(key, issue);
    }
  }
  return Array.from(deduped.values());
}

function slugifyReviewPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function mapIssueTypeToCategory(issueType: ViewReviewIssue["type"]) {
  switch (issueType) {
    case "missing_context":
      return "context" as const;
    case "group_too_broad":
    case "group_too_thin":
      return "grouping" as const;
    case "naming_unclear":
      return "naming" as const;
    case "external_dependency_overload":
      return "relation_visibility" as const;
    case "layering_issue":
    case "sparse_view":
    default:
      return "layering" as const;
  }
}

function buildIssueTitle(issueType: ViewReviewIssue["type"]): string {
  switch (issueType) {
    case "sparse_view":
      return "View too sparse";
    case "missing_context":
      return "Missing external context";
    case "group_too_broad":
      return "Group too broad";
    case "group_too_thin":
      return "Group too thin";
    case "naming_unclear":
      return "Naming unclear";
    case "external_dependency_overload":
      return "Relation visibility weak";
    case "layering_issue":
    default:
      return "Layering issue";
  }
}

function decorateReviewIssues(
  viewId: string,
  issues: readonly ViewReviewIssue[],
  source: "structure_review" | "uml_reference_compare" | "vision_review",
): ViewReviewIssue[] {
  const createdAt = new Date().toISOString();
  return issues.map((issue, index) => ({
    ...issue,
    reviewId: issue.reviewId ?? `${source}:${viewId}:${issue.type}:${slugifyReviewPart(issue.message)}:${index}`,
    source: issue.source ?? source,
    category: issue.category ?? mapIssueTypeToCategory(issue.type),
    title: issue.title ?? buildIssueTitle(issue.type),
    status: issue.status ?? "new",
    createdAt: issue.createdAt ?? createdAt,
  }));
}

function mergeReviewIssues(
  existing: readonly ViewReviewIssue[] | undefined,
  incoming: readonly ViewReviewIssue[],
): ViewReviewIssue[] {
  const merged = new Map<string, ViewReviewIssue>();
  for (const issue of existing ?? []) {
    const key = issue.reviewId ?? `${issue.type}|${issue.message}`;
    merged.set(key, issue);
  }
  for (const issue of incoming) {
    const key = issue.reviewId ?? `${issue.type}|${issue.message}`;
    const previous = merged.get(key);
    merged.set(key, previous ? {
      ...issue,
      status: previous.status ?? issue.status,
      createdAt: previous.createdAt ?? issue.createdAt,
    } : issue);
  }
  return Array.from(merged.values());
}

function decorateContextSuggestions(
  viewId: string,
  suggestions: readonly ExternalContextSuggestion[],
): ExternalContextSuggestion[] {
  const createdAt = new Date().toISOString();
  return suggestions.map((suggestion, index) => ({
    ...suggestion,
    reviewId: suggestion.reviewId ?? `external_context_review:${viewId}:${slugifyReviewPart(suggestion.label)}:${index}`,
    source: suggestion.source ?? "external_context_review",
    status: suggestion.status ?? "new",
    createdAt: suggestion.createdAt ?? createdAt,
  }));
}

function mergeContextSuggestions(
  existing: readonly ExternalContextSuggestion[] | undefined,
  incoming: readonly ExternalContextSuggestion[],
): ExternalContextSuggestion[] {
  const merged = new Map<string, ExternalContextSuggestion>();
  for (const suggestion of existing ?? []) {
    const key = suggestion.reviewId ?? `${suggestion.label}|${suggestion.reason}`;
    merged.set(key, suggestion);
  }
  for (const suggestion of incoming) {
    const key = suggestion.reviewId ?? `${suggestion.label}|${suggestion.reason}`;
    const previous = merged.get(key);
    merged.set(key, previous ? {
      ...suggestion,
      status: previous.status ?? suggestion.status,
      createdAt: previous.createdAt ?? suggestion.createdAt,
    } : suggestion);
  }
  return Array.from(merged.values());
}

function decorateLabelImprovements(
  viewId: string,
  improvements: readonly LabelImprovement[],
): LabelImprovement[] {
  const createdAt = new Date().toISOString();
  return improvements.map((improvement, index) => ({
    ...improvement,
    reviewId: improvement.reviewId ?? `label_improvement:${viewId}:${improvement.targetId}:${index}`,
    source: improvement.source ?? "label_improvement",
    status: improvement.status ?? "new",
    createdAt: improvement.createdAt ?? createdAt,
  }));
}

function mergeLabelImprovements(
  existing: readonly LabelImprovement[] | undefined,
  incoming: readonly LabelImprovement[],
): LabelImprovement[] {
  const merged = new Map<string, LabelImprovement>();
  for (const improvement of existing ?? []) {
    const key = improvement.reviewId ?? `${improvement.targetId}|${improvement.newLabel}`;
    merged.set(key, improvement);
  }
  for (const improvement of incoming) {
    const key = improvement.reviewId ?? `${improvement.targetId}|${improvement.newLabel}`;
    const previous = merged.get(key);
    merged.set(key, previous ? {
      ...improvement,
      status: previous.status ?? improvement.status,
      createdAt: previous.createdAt ?? improvement.createdAt,
    } : improvement);
  }
  return Array.from(merged.values());
}

function summarizeExternalDependencies(graph: ProjectGraph, view: DiagramView): Array<{
  symbolId: string;
  label: string;
  kind: string;
  relationCount: number;
}> {
  const nodeIds = new Set(view.nodeRefs);
  const counts = new Map<string, number>();
  for (const rel of graph.relations) {
    if (!isNonStructuralRelation(rel)) continue;
    const outsideId = nodeIds.has(rel.source) && !nodeIds.has(rel.target)
      ? rel.target
      : (nodeIds.has(rel.target) && !nodeIds.has(rel.source) ? rel.source : null);
    if (!outsideId) continue;
    counts.set(outsideId, (counts.get(outsideId) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([symbolId, relationCount]) => {
      const sym = graph.symbols.find((candidate) => candidate.id === symbolId);
      return {
        symbolId,
        label: sym?.label ?? symbolId,
        kind: sym?.kind ?? "unknown",
        relationCount,
      };
    })
    .sort((a, b) => b.relationCount - a.relationCount)
    .slice(0, 12);
}

export async function reviewExternalContextForView(
  graph: ProjectGraph,
  viewId: string,
  persist = true,
): Promise<AiExternalContextReviewResponse> {
  const view = findView(graph, viewId);
  const heuristics = buildViewHeuristics(graph, viewId);
  const externalCandidates = summarizeExternalDependencies(graph, view);

  if (externalCandidates.length === 0) {
    const emptyReview: AiExternalContextReviewResponse = { viewId, suggestedContextNodes: [] };
    if (persist) {
      view.contextSuggestions = [];
    }
    return emptyReview;
  }

  const { data } = await callAiJson({
    taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_EXTERNAL_CONTEXT_REVIEW),
    systemPrompt: `You review sparse UML views and suggest missing external context nodes.
Return JSON exactly in this format:
{
  "viewId": "${view.id}",
  "suggestedContextNodes": [
    {
      "label": "Context label",
      "relatedSymbolIds": ["sym:..."],
      "reason": "why this context matters",
      "confidence": 0.0
    }
  ]
}
Rules:
- Suggest at most 5 context nodes
- Only use relatedSymbolIds from the candidate list
- Prefer grouped or aggregated context for repeated dependencies
- confidence must be between 0 and 1
Respond ONLY with valid JSON.`,
    userPrompt: `View: ${view.title}
Heuristics:
${JSON.stringify(heuristics, null, 2)}
External dependency candidates:
${JSON.stringify(externalCandidates, null, 2)}`,
  });

  const parsed = AiExternalContextReviewResponseSchema.safeParse({
    ...(typeof data === "object" && data ? data : {}),
    viewId,
  });
  if (!parsed.success) {
    throw new Error(`AI external context review failed validation: ${parsed.error.message}`);
  }

  const allowedIds = new Set(externalCandidates.map((candidate) => candidate.symbolId));
  const filteredSuggestions: ExternalContextSuggestion[] = parsed.data.suggestedContextNodes
    .map((suggestion) => ({
      ...suggestion,
      relatedSymbolIds: suggestion.relatedSymbolIds.filter((symbolId) => allowedIds.has(symbolId)),
    }))
    .filter((suggestion) => suggestion.relatedSymbolIds.length > 0);
  const decoratedSuggestions = decorateContextSuggestions(viewId, filteredSuggestions);

  const review: AiExternalContextReviewResponse = {
    viewId,
    suggestedContextNodes: decoratedSuggestions,
  };

  if (persist) {
    view.contextSuggestions = mergeContextSuggestions(view.contextSuggestions, decoratedSuggestions);
  }

  return review;
}

export async function reviewViewStructure(
  graph: ProjectGraph,
  viewId: string,
  persist = true,
  includeContextReview = true,
): Promise<ReviewViewStructureResult> {
  const view = findView(graph, viewId);
  const symbols = getViewSymbols(graph, view);
  const heuristics = buildViewHeuristics(graph, viewId);
  const localIssues = buildHeuristicIssues(view, heuristics, graph);
  const relationSummary = getViewRelations(graph, view);

  let aiIssues: ViewReviewIssue[] = [];
  try {
    const { data } = await callAiJson({
      taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_STRUCTURE_REVIEW),
      systemPrompt: `You review the quality of a UML view inside a software architecture graph.
Return JSON exactly in this format:
{
  "viewId": "${view.id}",
  "issues": [
    {
      "type": "sparse_view" | "missing_context" | "group_too_broad" | "group_too_thin" | "naming_unclear" | "layering_issue" | "external_dependency_overload",
      "severity": "low" | "medium" | "high",
      "message": "what is wrong",
      "suggestedAction": "how to improve it",
      "targetIds": ["sym:..."]
    }
  ]
}
Rules:
- Focus on readability, grouping quality, missing domain context and UML communication quality
- Only reference targetIds that exist in the input
- Return an empty issues array if the view already looks coherent
Respond ONLY with valid JSON.`,
      userPrompt: `View:
${JSON.stringify({
        id: view.id,
        title: view.title,
        scope: view.scope ?? "unknown",
        nodes: symbols.map((sym) => ({ id: sym.id, label: sym.label, kind: sym.kind, parentId: sym.parentId ?? null })),
        internalRelations: relationSummary.internal.map((rel) => ({ source: rel.source, target: rel.target, type: rel.type })),
        externalDependencies: summarizeExternalDependencies(graph, view),
        heuristics,
      }, null, 2)}`,
    });

    const parsed = AiStructureReviewResponseSchema.safeParse({
      ...(typeof data === "object" && data ? data : {}),
      viewId,
    });
    if (parsed.success) {
      aiIssues = parsed.data.issues;
    }
  } catch {
    // Fall back to heuristic issues.
  }

  const decoratedIssues = decorateReviewIssues(viewId, dedupeIssues([...localIssues, ...aiIssues]), "structure_review");
  const review: AiStructureReviewResponse = {
    viewId,
    issues: decoratedIssues,
  };

  let contextReview: AiExternalContextReviewResponse | undefined;
  if (includeContextReview && (heuristics.sparse || heuristics.externalDependencyCount > heuristics.internalEdgeCount)) {
    try {
      contextReview = await reviewExternalContextForView(graph, viewId, persist);
    } catch {
      contextReview = { viewId, suggestedContextNodes: [] };
      if (persist) {
        view.contextSuggestions = [];
      }
    }
  }

  if (persist) {
    view.reviewHints = mergeReviewIssues(view.reviewHints, review.issues);
  }

  return { review, heuristics, contextReview };
}

export async function improveLabelsForView(
  graph: ProjectGraph,
  viewId: string,
  persist = true,
): Promise<AiLabelImprovementResponse> {
  const view = findView(graph, viewId);
  const symbols = getViewSymbols(graph, view);
  const targets = [
    { targetId: view.id, oldLabel: view.title, kind: "view" },
    ...symbols
      .filter((sym) =>
        sym.kind === "group" ||
        sym.label.length > 28 ||
        sym.label.includes("/") ||
        sym.label.includes("\\") ||
        sym.label.split(".").length > 3
      )
      .slice(0, 24)
      .map((sym) => ({ targetId: sym.id, oldLabel: sym.label, kind: sym.kind })),
  ];

  const { data } = await callAiJson({
    taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_LABEL_IMPROVEMENT),
    systemPrompt: `You improve labels for UML views and nodes.
Return JSON exactly in this format:
{
  "viewId": "${view.id}",
  "improvements": [
    {
      "targetId": "view-or-symbol-id",
      "oldLabel": "current label",
      "newLabel": "better label",
      "reason": "why it is clearer",
      "confidence": 0.0
    }
  ]
}
Rules:
- Only improve labels that are genuinely unclear, path-like, too technical or too long
- Keep the intent stable; do not invent new domain concepts
- Use targetId values exactly as provided in the input
- newLabel should usually stay below 32 characters
- Return an empty improvements array if current labels are already fine
Respond ONLY with valid JSON.`,
    userPrompt: `View label targets:
${JSON.stringify({
      viewId: view.id,
      viewTitle: view.title,
      targets,
    }, null, 2)}`,
  });

  const parsed = AiLabelImprovementResponseSchema.safeParse({
    ...(typeof data === "object" && data ? data : {}),
    viewId,
  });
  if (!parsed.success) {
    throw new Error(`AI label improvement failed validation: ${parsed.error.message}`);
  }

  const knownTargets = new Set(targets.map((target) => target.targetId));
  const improvements: LabelImprovement[] = parsed.data.improvements.filter((improvement) =>
    knownTargets.has(improvement.targetId) &&
    improvement.newLabel.trim().length > 0 &&
    improvement.newLabel !== improvement.oldLabel
  );
  const decoratedImprovements = decorateLabelImprovements(viewId, improvements);

  const response: AiLabelImprovementResponse = { viewId, improvements: decoratedImprovements };
  if (persist) {
    view.labelSuggestions = mergeLabelImprovements(view.labelSuggestions, decoratedImprovements);
  }
  return response;
}
