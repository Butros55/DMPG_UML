import type { ProjectGraph, Relation, RelationType, Symbol } from "@dmpg/shared";

type StageId = "sources" | "connectors" | "extract" | "transform" | "persist" | "simulate";
type ScoreMap = Record<StageId, number>;
type UmlType =
  | "package"
  | "database"
  | "artifact"
  | "note"
  | "component"
  | "module"
  | "class"
  | "function"
  | "method"
  | "group"
  | "external";

interface DrilldownConfig {
  viewSearch?: string[];
  symbolSearch?: string[];
  preferredViewIds?: string[];
  preferredSymbolIds?: string[];
}

interface PositionConfig {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface ProcessPackageConfig {
  id: string;
  label: string;
  stereotype?: string;
  preview?: string[];
  parentId?: string;
  childViewId?: string;
  position: PositionConfig;
  drilldown?: DrilldownConfig;
}

interface ProcessNodeConfig {
  id: string;
  label: string;
  umlType: UmlType;
  stereotype?: string;
  preview?: string[];
  parentId?: string;
  childViewId?: string;
  position: PositionConfig;
  drilldown?: DrilldownConfig;
}

interface ProcessEdgeConfig {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  label?: string;
}

export interface ProcessDiagramConfig {
  viewId: string;
  title: string;
  packages: ProcessPackageConfig[];
  nodes: ProcessNodeConfig[];
  edges: ProcessEdgeConfig[];
}

interface StageDef {
  id: StageId;
  packageId: string;
  label: string;
  x: number;
  y: number;
  width: number;
}

interface StageRule {
  pattern: RegExp;
  score: number;
}

interface Classification {
  stage: StageId;
  score: number;
  scores: ScoreMap;
}

interface Context {
  symbolById: Map<string, Symbol>;
  relationsBySymbolId: Map<string, Relation[]>;
  ancestorsById: Map<string, string[]>;
  ownTextById: Map<string, string>;
  parentTextById: Map<string, string>;
  neighborTextById: Map<string, string>;
  textById: Map<string, string>;
  classifications: Map<string, Classification | null>;
}

interface FlowDef {
  source: StageId;
  target: StageId;
  label: string;
  fallbackType: RelationType;
}

const VIEW_ID = "view:process-overview";
const VIEW_TITLE = "Layer 1 - Process Overview";
const STAGES: readonly StageDef[] = [
  { id: "sources", packageId: "proc:pkg:sources", label: "SQL-Datenquellen", x: 620, y: 60, width: 360 },
  { id: "connectors", packageId: "proc:pkg:connectors", label: "Connectoren", x: 620, y: 220, width: 360 },
  { id: "extract", packageId: "proc:pkg:extract", label: "Data Extraction", x: 620, y: 380, width: 360 },
  { id: "transform", packageId: "proc:pkg:transform", label: "Transformation / Matching", x: 620, y: 540, width: 360 },
  { id: "persist", packageId: "proc:pkg:persist", label: "Distribution / Persistenz", x: 620, y: 700, width: 360 },
  { id: "simulate", packageId: "proc:pkg:simulate", label: "Simulation", x: 620, y: 860, width: 360 },
] as const;
const STAGE_ORDER: Record<StageId, number> = {
  sources: 0,
  connectors: 1,
  extract: 2,
  transform: 3,
  persist: 4,
  simulate: 5,
};
const STAGE_FLOW: readonly FlowDef[] = [
  { source: "sources", target: "connectors", label: "query source systems", fallbackType: "reads" },
  { source: "connectors", target: "extract", label: "load raw data", fallbackType: "calls" },
  { source: "extract", target: "transform", label: "prepare / match data", fallbackType: "calls" },
  { source: "transform", target: "persist", label: "fit / persist", fallbackType: "calls" },
  { source: "persist", target: "simulate", label: "consume artefacts", fallbackType: "reads" },
] as const;
const RULES: Record<StageId, readonly StageRule[]> = {
  sources: [
    { pattern: /datenquellen|data sources?|source systems?/, score: 14 },
    { pattern: /\bmes\b|\bdruid\b|\bsap\b/, score: 12 },
    { pattern: /\bsql\b|\bdatabase\b|\bdb\b|datasource|analytics db|production db/, score: 12 },
  ],
  connectors: [
    { pattern: /connector|connection|cursor|fetchall/, score: 18 },
    { pattern: /execute query|run query|convert to df|buffer file/, score: 10 },
  ],
  extract: [
    { pattern: /data extraction|dataextraction|extract data|get data|load data|read data/, score: 16 },
    { pattern: /preprocess|vorverarbeitung|setting up times|arrival input|arrival table|is table/, score: 12 },
  ],
  transform: [
    { pattern: /transform|matching|match|cluster|station|route|number of goods/, score: 16 },
    { pattern: /filter|iqr|fallback|preprocessing after extraction/, score: 14 },
  ],
  persist: [
    { pattern: /distribution|fit dist|fit distribution|calc distribution|kde|kerndichtesch/, score: 16 },
    { pattern: /persist|save to file|save object|save min max|min max|json|pickle|pkl|efficien/, score: 14 },
  ],
  simulate: [
    { pattern: /simulation|simulation model|model py|model\.py|runtime/, score: 16 },
    { pattern: /get processing time|calc sim time|generate sim data|simulationdatagenerator/, score: 14 },
  ],
};

export function buildProcessDiagramConfigFromGraph(graph: ProjectGraph): ProcessDiagramConfig {
  const ctx = buildContext(graph);
  for (const symbol of graph.symbols) {
    ctx.classifications.set(symbol.id, classifySymbolToProcessStage(symbol, ctx));
  }

  return {
    viewId: VIEW_ID,
    title: VIEW_TITLE,
    packages: STAGES.map((stage) => ({
      id: stage.packageId,
      label: stage.label,
      stereotype: "<<package>>",
      drilldown: {
        preferredViewIds: compact([chooseBestStageDrilldownView(graph, ctx, stage.id)]),
        preferredSymbolIds: collectStageSymbolIds(ctx, stage.id),
        viewSearch: viewTerms(stage.id),
      },
      position: {
        x: stage.x,
        y: stage.y,
        width: stage.width,
        height: 108,
      },
    })),
    nodes: [],
    edges: aggregateStageEdges(graph, ctx),
  };
}

function buildContext(graph: ProjectGraph): Context {
  const symbolById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const relationsBySymbolId = new Map<string, Relation[]>();
  for (const relation of graph.relations) {
    if (relation.id.startsWith("process-edge:") || relation.id.startsWith("stub-edge:")) continue;
    const outgoing = relationsBySymbolId.get(relation.source) ?? [];
    outgoing.push(relation);
    relationsBySymbolId.set(relation.source, outgoing);
    const incoming = relationsBySymbolId.get(relation.target) ?? [];
    incoming.push(relation);
    relationsBySymbolId.set(relation.target, incoming);
  }

  const ancestorsById = buildAncestors(graph.symbols);
  const ownTextById = new Map<string, string>();
  const parentTextById = new Map<string, string>();
  const neighborTextById = new Map<string, string>();
  const textById = new Map<string, string>();

  for (const symbol of graph.symbols) {
    const ownText = normalize([
      symbol.id,
      symbol.label,
      symbol.location?.file,
      symbol.doc?.summary,
      symbol.stereotype,
      symbol.umlType,
      ...(symbol.preview?.lines ?? []),
      ...(symbol.tags ?? []),
    ].filter(Boolean).join(" "));
    const parentText = normalize(
      (ancestorsById.get(symbol.id) ?? [])
        .slice(1)
        .map((ancestorId) => {
          const parent = symbolById.get(ancestorId);
          return `${parent?.label ?? ancestorId} ${parent?.location?.file ?? ""}`;
        })
        .join(" "),
    );
    const neighborText = normalize(
      (relationsBySymbolId.get(symbol.id) ?? [])
        .slice(0, 20)
        .map((relation) => {
          const otherId = relation.source === symbol.id ? relation.target : relation.source;
          const other = symbolById.get(otherId);
          return `${relation.type} ${other?.label ?? otherId} ${other?.location?.file ?? ""}`;
        })
        .join(" "),
    );
    ownTextById.set(symbol.id, ownText);
    parentTextById.set(symbol.id, parentText);
    neighborTextById.set(symbol.id, neighborText);
    textById.set(symbol.id, normalize(`${ownText} ${parentText} ${neighborText}`));
  }

  return {
    symbolById,
    relationsBySymbolId,
    ancestorsById,
    ownTextById,
    parentTextById,
    neighborTextById,
    textById,
    classifications: new Map(),
  };
}

function classifySymbolToProcessStage(symbol: Symbol, ctx: Context): Classification | null {
  const own = ctx.ownTextById.get(symbol.id) ?? "";
  if (shouldIgnoreSymbolForLayerOne(symbol, own)) return null;

  const parentText = ctx.parentTextById.get(symbol.id) ?? "";
  const neighborText = ctx.neighborTextById.get(symbol.id) ?? "";
  const fileText = normalize(symbol.location?.file ?? "");
  const scores = emptyScores();

  for (const stage of STAGES) {
    for (const rule of RULES[stage.id]) {
      if (rule.pattern.test(own)) scores[stage.id] += rule.score;
      if (rule.pattern.test(parentText)) scores[stage.id] += Math.round(rule.score * 0.65);
      if (rule.pattern.test(neighborText)) scores[stage.id] += Math.round(rule.score * 0.4);
    }
  }

  if (fileText.includes("connector")) scores.connectors += 18;
  if (fileText.includes("extract")) scores.extract += 16;
  if (fileText.includes("arrival")) {
    scores.extract += 10;
    scores.simulate += 6;
  }
  if (fileText.includes("filter") || fileText.includes("match") || fileText.includes("cluster")) scores.transform += 14;
  if (fileText.includes("distribution") || fileText.includes("kde") || fileText.includes("pickle")) scores.persist += 16;
  if (fileText.includes("simulation") || fileText.endsWith("model py")) scores.simulate += 16;
  if (looksLikeSqlSource(own) && !own.includes("connector")) scores.sources += 12;
  if (looksLikePersistedArtifact(own)) scores.persist += 10;

  for (const relation of ctx.relationsBySymbolId.get(symbol.id) ?? []) {
    const otherId = relation.source === symbol.id ? relation.target : relation.source;
    const otherText = ctx.textById.get(otherId) ?? normalize(otherId);
    if (relation.type === "reads" && looksLikeSqlSource(otherText)) scores.extract += 8;
    if (relation.type === "writes" && looksLikePersistedArtifact(otherText)) scores.persist += 8;
    if ((relation.type === "calls" || relation.type === "instantiates") && otherText.includes("connector")) scores.extract += 6;
    if ((relation.type === "calls" || relation.type === "imports") && (otherText.includes("distribution") || otherText.includes("kde"))) scores.persist += 6;
    if ((relation.type === "reads" || relation.type === "uses_config") && looksLikePersistedArtifact(otherText)) scores.simulate += 6;
  }

  let bestStage: StageId | null = null;
  let bestScore = -1;
  for (const stage of STAGES) {
    const score = scores[stage.id];
    if (score > bestScore || (score === bestScore && tieBreak(stage.id, bestStage ?? stage.id) > 0)) {
      bestStage = stage.id;
      bestScore = score;
    }
  }

  const threshold = symbol.kind === "external" ? 14 : 12;
  return bestStage && bestScore >= threshold ? { stage: bestStage, score: bestScore, scores } : null;
}

function aggregateStageEdges(graph: ProjectGraph, ctx: Context): ProcessEdgeConfig[] {
  const counts = new Map<string, Partial<Record<RelationType, number>>>();

  for (const relation of graph.relations) {
    if (relation.id.startsWith("process-edge:") || relation.id.startsWith("stub-edge:") || relation.type === "contains") continue;

    const sourceStage = resolveRelationStage(relation.source, ctx);
    const targetStage = resolveRelationStage(relation.target, ctx);
    if (!sourceStage || !targetStage || sourceStage === targetStage) continue;

    const oriented =
      STAGE_ORDER[sourceStage] <= STAGE_ORDER[targetStage]
        ? { source: sourceStage, target: targetStage }
        : { source: targetStage, target: sourceStage };
    const key = `${oriented.source}->${oriented.target}`;
    if (!STAGE_FLOW.some((flow) => flow.source === oriented.source && flow.target === oriented.target)) continue;

    const bucket = counts.get(key) ?? {};
    bucket[relation.type] = (bucket[relation.type] ?? 0) + 1;
    counts.set(key, bucket);
  }

  return STAGE_FLOW.map((flow) => {
    const pairKey = `${flow.source}->${flow.target}`;
    const pairCounts = counts.get(pairKey);
    return {
      id: `stage:${flow.source}->${flow.target}`,
      source: stageDef(flow.source).packageId,
      target: stageDef(flow.target).packageId,
      type: dominantType(pairCounts, flow.fallbackType),
      label: flow.label,
    };
  });
}

function resolveRelationStage(symbolId: string, ctx: Context): StageId | undefined {
  const direct = ctx.classifications.get(symbolId);
  if (direct?.stage) return direct.stage;

  for (const ancestorId of ctx.ancestorsById.get(symbolId) ?? []) {
    const classification = ctx.classifications.get(ancestorId);
    if (classification?.stage) return classification.stage;
  }

  return undefined;
}

function collectStageSymbolIds(ctx: Context, stage: StageId): string[] {
  const ids: string[] = [];
  const classified = [...ctx.classifications.entries()]
    .filter((entry): entry is [string, Classification] => Boolean(entry[1] && entry[1].stage === stage))
    .sort((a, b) => b[1].score - a[1].score);

  for (const [symbolId] of classified) {
    const chain = ctx.ancestorsById.get(symbolId) ?? [symbolId];
    const group = chain.find((candidateId) => ctx.symbolById.get(candidateId)?.kind === "group");
    const module = chain.find((candidateId) => ctx.symbolById.get(candidateId)?.kind === "module");
    if (group) ids.push(group);
    if (module) ids.push(module);
  }

  return compact(ids).slice(0, 20);
}

function chooseBestStageDrilldownView(graph: ProjectGraph, ctx: Context, stage: StageId): string | undefined {
  const stageEntries = [...ctx.classifications.entries()]
    .filter((entry): entry is [string, Classification] => Boolean(entry[1] && entry[1].stage === stage))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 60);
  if (stageEntries.length === 0) return chooseBestStageViewByTerms(graph, stage);

  const stageSymbols = new Set(stageEntries.map(([id]) => id));
  const stageAncestors = new Set<string>();
  for (const [symbolId] of stageEntries) {
    for (const ancestorId of ctx.ancestorsById.get(symbolId) ?? []) {
      const symbol = ctx.symbolById.get(ancestorId);
      if (symbol && (symbol.kind === "group" || symbol.kind === "module" || symbol.kind === "class")) {
        stageAncestors.add(ancestorId);
      }
    }
  }

  let best: { id: string; score: number } | null = null;
  for (const view of graph.views) {
    if (view.id === VIEW_ID) continue;
    if (view.id.startsWith("view:process-stage:")) continue;
    if (view.scope !== "group" && view.scope !== "module") continue;

    const viewText = normalize(`${view.id} ${view.title}`);
    if (isExcludedDrilldownView(viewText)) continue;

    let score = view.scope === "group" ? 40 : 24;
    let hits = 0;

    for (const term of viewTerms(stage)) {
      if (includes(viewText, term)) score += 10;
    }

    for (const nodeId of view.nodeRefs) {
      if (nodeId.startsWith("ext:") || nodeId.startsWith("stub:") || nodeId.startsWith("proc:")) {
        score -= 6;
        continue;
      }
      if (stageSymbols.has(nodeId)) {
        score += 22;
        hits += 2;
        continue;
      }
      if (stageAncestors.has(nodeId)) {
        score += 12;
        hits += 1;
      }
    }

    if (hits === 0) continue;
    score += Math.min(hits * 2, 12);

    if (!best || score > best.score) {
      best = { id: view.id, score };
    }
  }

  return best?.id ?? chooseBestStageViewByTerms(graph, stage);
}

function buildAncestors(symbols: Symbol[]): Map<string, string[]> {
  const parentById = new Map(symbols.map((symbol) => [symbol.id, symbol.parentId]));
  const cache = new Map<string, string[]>();

  const compute = (symbolId: string): string[] => {
    const cached = cache.get(symbolId);
    if (cached) return cached;

    const chain: string[] = [symbolId];
    let cursor = parentById.get(symbolId);
    let depth = 0;
    while (cursor && depth < 40) {
      chain.push(cursor);
      cursor = parentById.get(cursor);
      depth += 1;
    }
    cache.set(symbolId, chain);
    return chain;
  };

  for (const symbol of symbols) compute(symbol.id);
  return cache;
}

function dominantType(
  counts: Partial<Record<RelationType, number>> | undefined,
  fallback: RelationType,
): RelationType {
  if (!counts) return fallback;

  let best = fallback;
  let bestCount = -1;
  for (const [type, count] of Object.entries(counts) as Array<[RelationType, number]>) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

function shouldIgnoreSymbolForLayerOne(symbol: Symbol, ownText: string): boolean {
  if (symbol.tags?.includes("process-overview") || symbol.tags?.includes("external-stub")) return true;
  if (symbol.id.startsWith("proc:") || symbol.id.startsWith("stub:")) return true;
  if (symbol.kind === "external" && !looksLikeRelevantExternal(ownText)) return true;
  if (looksLikeArtifactCategory(ownText)) return true;
  return false;
}

function looksLikeRelevantExternal(text: string): boolean {
  return /\b(mes|druid|sap|sql|database|db|datasource|csv|xlsx|json|pickle|pkl|model py|model\.py|simulation)\b/.test(text);
}

function looksLikeSqlSource(text: string): boolean {
  return /\b(mes|druid|sap|sql|database|db|datasource|production db|analytics db)\b/.test(text);
}

function looksLikePersistedArtifact(text: string): boolean {
  return /\b(json|pickle|pkl|kde|min max|distribution|efficien|arrival)\b/.test(text);
}

function looksLikeArtifactCategory(text: string): boolean {
  return /(artifact|data files|libraries|i o operations|other artifacts|types models)/.test(text);
}

function isExcludedDrilldownView(text: string): boolean {
  return /(artifact|data files|libraries|i o operations|other artifacts|types models)/.test(text);
}

function chooseBestStageViewByTerms(graph: ProjectGraph, stage: StageId): string | undefined {
  let best: { id: string; score: number } | null = null;
  for (const view of graph.views) {
    if (view.id === VIEW_ID) continue;
    if (view.id.startsWith("view:process-stage:")) continue;
    if (view.scope !== "group" && view.scope !== "module") continue;

    const viewText = normalize(`${view.id} ${view.title}`);
    if (isExcludedDrilldownView(viewText)) continue;

    let score = view.scope === "group" ? 20 : 10;
    for (const term of viewTerms(stage)) {
      if (includes(viewText, term)) score += 10;
    }
    if (!best || score > best.score) best = { id: view.id, score };
  }
  return best && best.score > 20 ? best.id : undefined;
}

function emptyScores(): ScoreMap {
  return { sources: 0, connectors: 0, extract: 0, transform: 0, persist: 0, simulate: 0 };
}

function tieBreak(candidate: StageId, current: StageId): number {
  const priority: Record<StageId, number> = {
    sources: 1,
    connectors: 2,
    extract: 3,
    transform: 4,
    persist: 5,
    simulate: 6,
  };
  return priority[candidate] - priority[current];
}

function stageDef(stage: StageId): StageDef {
  const match = STAGES.find((candidate) => candidate.id === stage);
  if (!match) throw new Error(`Unknown process stage: ${stage}`);
  return match;
}

function viewTerms(stage: StageId): string[] {
  switch (stage) {
    case "sources":
      return ["datenquellen", "source", "sources", "sql", "db"];
    case "connectors":
      return ["connector", "connectors"];
    case "extract":
      return ["extract", "extraction", "pipeline", "preprocess", "arrival"];
    case "transform":
      return ["transform", "matching", "filter", "cluster"];
    case "persist":
      return ["distribution", "persist", "kde"];
    case "simulate":
      return ["simulation", "model", "generator"];
  }
}

function normalize(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[\\/_.:()[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function includes(text: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  return normalizedTerm.length > 0 && text.includes(normalizedTerm);
}

function compact(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}
