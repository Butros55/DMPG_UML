import type { DiagramView, ProjectGraph, Relation, RelationType, Symbol } from "@dmpg/shared";

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
  stageViews: ProcessStageViewConfig[];
}

interface StageViewNodePosition {
  symbolId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface ProcessStageViewConfig {
  id: string;
  title: string;
  stage: StageId;
  nodeRefs: string[];
  edgeRefs: string[];
  nodePositions: StageViewNodePosition[];
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
  reason: string;
}

interface Classification {
  stage: StageId;
  score: number;
  scores: ScoreMap;
  reasons: string[];
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

interface DraftNode {
  id: string;
  label: string;
  umlType: UmlType;
  stage?: StageId;
  role: string;
  order: number;
  priority: number;
  stereotype?: string;
  preview?: string[];
  parentId?: string;
  childViewId?: string;
  drilldown?: DrilldownConfig;
  mappedSymbolIds: string[];
  drilldownSymbolIds: string[];
}

interface Blueprint {
  id: string;
  stage: StageId;
  label: string;
  role: string;
  order: number;
  terms: string[];
  minScore?: number;
}

interface ArtifactFamily {
  id: string;
  stage: StageId;
  label: string;
  role: string;
  order: number;
  explicit: RegExp[];
  inferred?: string[];
}

interface SourceDef {
  id: string;
  label: string;
  order: number;
  terms: string[];
}

interface EdgeAcc {
  source: string;
  target: string;
  typeCounts: Partial<Record<RelationType, number>>;
  labels: Map<string, number>;
}

const VIEW_ID = "view:process-overview";
const VIEW_TITLE = "Layer 1 - Process Overview";
const STAGES: readonly StageDef[] = [
  { id: "sources", packageId: "proc:pkg:sources", label: "SQL-Datenquellen", x: 40, y: 150, width: 320 },
  { id: "connectors", packageId: "proc:pkg:connectors", label: "Connectoren", x: 390, y: 150, width: 320 },
  { id: "extract", packageId: "proc:pkg:extract", label: "Data Extraction & Vorverarbeitung", x: 740, y: 150, width: 360 },
  { id: "transform", packageId: "proc:pkg:transform", label: "Transformation / Matching / Filtering", x: 1130, y: 150, width: 400 },
  { id: "persist", packageId: "proc:pkg:persist", label: "Distributionen / KDE / Persistenz", x: 1560, y: 150, width: 390 },
  { id: "simulate", packageId: "proc:pkg:simulate", label: "Simulation (Konsum)", x: 1980, y: 150, width: 360 },
] as const;
const STAGE_ORDER: Record<StageId, number> = { sources: 0, connectors: 1, extract: 2, transform: 3, persist: 4, simulate: 5 };
const RULES: Record<StageId, readonly StageRule[]> = {
  sources: [
    { pattern: /\bmes\b|\bdruid\b|\bsap\b/, score: 8, reason: "named source" },
    { pattern: /\bsql\b|\bdatabase\b|\bdb\b|datasource/, score: 8, reason: "database" },
  ],
  connectors: [
    { pattern: /connector/, score: 22, reason: "connector" },
    { pattern: /execute query|run query|convert to df|buffer file/, score: 12, reason: "query adapter" },
  ],
  extract: [
    { pattern: /data extraction|dataextraction/, score: 24, reason: "extraction" },
    { pattern: /get data|_get process data|_get wt list|inject times/, score: 14, reason: "extract method" },
    { pattern: /preprocess|vorverarbeitung|setting up times|arrival table|main sql|is table/, score: 12, reason: "preprocessing" },
  ],
  transform: [
    { pattern: /filter|iqr|outliner|fallback/, score: 18, reason: "filtering" },
    { pattern: /\bmatch\b|\bcluster\b|\bstation\b|\broute\b|number of goods/, score: 16, reason: "matching" },
    { pattern: /extract data|get station data|simulation data generator/, score: 8, reason: "sim prep" },
  ],
  persist: [
    { pattern: /\bdistribution\b|fit distribution|fit dist|calc distribution/, score: 18, reason: "distribution" },
    { pattern: /\bkde\b|kerndichtesch|min max/, score: 18, reason: "kde" },
    { pattern: /save to file|save distribution|save object|json|pickle|pkl|efficien/, score: 14, reason: "persist" },
  ],
  simulate: [
    { pattern: /simulation data generator|simulationdatagenerator|generate sim data/, score: 22, reason: "simulation generator" },
    { pattern: /\bsimulation\b|runtime|calc sim time|get processing time|arrival/, score: 12, reason: "simulation runtime" },
    { pattern: /model py|simulation model/, score: 18, reason: "model" },
  ],
};
const BLUEPRINTS: readonly Blueprint[] = [
  { id: "mes", stage: "connectors", label: "MESConnector", role: "mes-connector", order: 10, terms: ["mes connector", "mesconnector"], minScore: 20 },
  { id: "druid", stage: "connectors", label: "DruidConnector", role: "druid-connector", order: 20, terms: ["druid connector", "druidconnector"], minScore: 20 },
  { id: "sap", stage: "connectors", label: "SAPConnector", role: "sap-connector", order: 30, terms: ["sap connector", "sapconnector"], minScore: 20 },
  { id: "connector-layer", stage: "connectors", label: "Connector Layer", role: "connector-layer", order: 90, terms: ["connector"], minScore: 20 },
  { id: "extract-core", stage: "extract", label: "Data Extraction", role: "extraction-core", order: 10, terms: ["data extraction", "dataextraction", "get data"], minScore: 18 },
  { id: "preprocessing", stage: "extract", label: "Vorverarbeitung / QC", role: "preprocessing", order: 20, terms: ["setting up times", "inject times", "material cluster", "is table"], minScore: 18 },
  { id: "arrival-builder", stage: "extract", label: "Arrival Input Builder", role: "arrival-builder", order: 30, terms: ["arrival table", "get arrival", "main sql"], minScore: 18 },
  { id: "matching", stage: "transform", label: "Matching / Clustering", role: "matching", order: 10, terms: ["match", "cluster", "route", "number of goods"], minScore: 18 },
  { id: "filtering", stage: "transform", label: "Filtering / IQR", role: "filtering", order: 20, terms: ["filter", "iqr", "outliner"], minScore: 18 },
  { id: "sim-prep", stage: "transform", label: "Simulation Prep", role: "simulation-prep", order: 30, terms: ["extract data", "filter data", "get station data"], minScore: 18 },
  { id: "distribution-fit", stage: "persist", label: "Distribution Fit", role: "distribution-fit", order: 10, terms: ["distribution", "fit distribution", "fit dist", "calc distribution"], minScore: 18 },
  { id: "kde", stage: "persist", label: "KDE / Min-Max", role: "kde", order: 20, terms: ["kde", "kerndichtesch", "get kde", "min max"], minScore: 18 },
  { id: "persistence", stage: "persist", label: "Persistenz Layer", role: "persistence", order: 30, terms: ["save to file", "save distribution", "save object", "json dump", "pickle dump"], minScore: 18 },
  { id: "sim-generator", stage: "simulate", label: "SimulationDataGenerator", role: "simulation-generator", order: 10, terms: ["simulation data generator", "simulationdatagenerator", "generate sim data"], minScore: 18 },
  { id: "runtime", stage: "simulate", label: "Runtime / Modell", role: "runtime-model", order: 20, terms: ["get processing time", "calc sim time", "model py", "runtime"], minScore: 18 },
] as const;
const SOURCES: readonly SourceDef[] = [
  { id: "mes", label: "MES / Produktions-DB", order: 10, terms: ["mes", "production db"] },
  { id: "druid", label: "Druid / Analytics-DB", order: 20, terms: ["druid", "analytics db"] },
  { id: "sap", label: "SAP / ERP-DB", order: 30, terms: ["sap", "erp"] },
] as const;
const ARTIFACTS: readonly ArtifactFamily[] = [
  { id: "input-files", stage: "extract", label: "Input-Dateien (.csv/.xlsx)", role: "input-files", order: 70, explicit: [/[\\/](input|files[\\/]+input|mes auszuge)[\\/].*\.(csv|xlsx?|json|sql)$/i] },
  { id: "matched", stage: "transform", label: "Gematchte / gefilterte Datasets", role: "matched-datasets", order: 80, explicit: [/(with order|cluster|worker|filter stats|outliner|route\.csv|is table).*\.(csv|xlsx?)$/i] },
  { id: "raw", stage: "extract", label: "Rohdaten-Datasets (.csv)", role: "raw-datasets", order: 80, explicit: [/(df wt|df data|validation data|nass var).*\.(csv|xlsx?)$/i] },
  { id: "json", stage: "persist", label: "Persistierte JSON-Parameter", role: "distribution-json", order: 80, explicit: [/\.json$/i], inferred: ["json dump", "save to file", "save min max values"] },
  { id: "kde", stage: "persist", label: "KDE / PKL Artefakte", role: "kde-artifacts", order: 90, explicit: [/\.(pkl|pickle|joblib)$/i], inferred: ["pickle dump", "get kde", "kde"] },
  { id: "exports", stage: "persist", label: "Distribution / Effizienz Exporte", role: "distribution-exports", order: 100, explicit: [/(distribution|efficien|constant times).*\.(csv|xlsx?)$/i] },
  { id: "arrival", stage: "simulate", label: "Arrival Tables (.csv)", role: "arrival-tables", order: 80, explicit: [/arrival.*\.csv$/i] },
  { id: "sim-output", stage: "simulate", label: "Simulations-Output", role: "simulation-output", order: 90, explicit: [/simulation[_-]?(output|payload|result).*\.(csv|json|xlsx?)$/i] },
] as const;

export function buildProcessDiagramConfigFromGraph(graph: ProjectGraph): ProcessDiagramConfig {
  const ctx = buildContext(graph);
  for (const symbol of graph.symbols) ctx.classifications.set(symbol.id, classifySymbolToProcessStage(symbol, graph, ctx));
  const componentNodes = buildStageNodes(graph, ctx);
  const sourceNodes = buildSyntheticSourceNodes(graph, ctx);
  const artifactNodes = buildSyntheticArtifactNodes(graph, ctx);
  const stageNodes = ensureStageCoverage(graph, ctx, [...sourceNodes, ...componentNodes, ...artifactNodes]);
  const stageViews = buildStageViews(graph, ctx, stageNodes);
  const packages = STAGES.map((stage) => ({
    id: stage.packageId,
    label: stage.label,
    stage: stage.id,
    stereotype: "<<package>>",
    preview: buildStagePreview(stage.id, ctx, stageNodes),
    childViewId: stageViewId(stage.id),
    drilldown: { preferredViewIds: [stageViewId(stage.id)] },
  }));
  const note: DraftNode = {
    id: "proc:note:overview",
    label: "Scan-basierte Layer-1-Prozesssicht\nsynthetisch aus Symbolen, Relationen und Artefakten erzeugt.",
    umlType: "note",
    role: "overview-note",
    order: 0,
    priority: 1,
    mappedSymbolIds: [],
    drilldownSymbolIds: [],
  };
  return generateProcessLayout({
    viewId: VIEW_ID,
    title: VIEW_TITLE,
    packages,
    nodes: [
      note,
      ...stageNodes.map((node) =>
        node.stage && !isStoreDraftNode(node)
          ? { ...node, drilldown: { preferredViewIds: [stageViewId(node.stage)] }, childViewId: stageViewId(node.stage) }
          : { ...node, drilldown: undefined, childViewId: undefined },
      ),
    ],
    edges: aggregateProcessEdges(graph, ctx, stageNodes),
    stageViews,
  });
}

function buildContext(graph: ProjectGraph): Context {
  const symbolById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const relationsBySymbolId = new Map<string, Relation[]>();
  for (const relation of graph.relations) {
    if (relation.id.startsWith("process-edge:") || relation.id.startsWith("stub-edge:")) continue;
    const src = relationsBySymbolId.get(relation.source) ?? [];
    src.push(relation);
    relationsBySymbolId.set(relation.source, src);
    const tgt = relationsBySymbolId.get(relation.target) ?? [];
    tgt.push(relation);
    relationsBySymbolId.set(relation.target, tgt);
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
        .map((id) => {
          const parent = symbolById.get(id);
          return `${parent?.label ?? id} ${parent?.location?.file ?? ""}`;
        })
        .join(" "),
    );
    const neighborText = normalize(
      (relationsBySymbolId.get(symbol.id) ?? [])
        .slice(0, 16)
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

function classifySymbolToProcessStage(symbol: Symbol, graph: ProjectGraph, ctx: Context): Classification | null {
  if (symbol.tags?.includes("process-overview") || symbol.tags?.includes("external-stub")) return null;
  const cached = ctx.classifications.get(symbol.id);
  if (cached !== undefined) return cached;

  const scores = emptyScores();
  const reasons: string[] = [];
  const own = ctx.ownTextById.get(symbol.id) ?? "";
  const parents = ctx.parentTextById.get(symbol.id) ?? "";
  const neighbors = ctx.neighborTextById.get(symbol.id) ?? "";
  const file = normalize(symbol.location?.file ?? "");

  for (const stage of STAGES) {
    for (const rule of RULES[stage.id]) {
      if (rule.pattern.test(own)) addScore(scores, stage.id, rule.score, reasons, `${stage.id}:${rule.reason}`);
      if (rule.pattern.test(parents)) addScore(scores, stage.id, Math.round(rule.score * 0.65), reasons, `${stage.id}:parent`);
      if (rule.pattern.test(neighbors)) addScore(scores, stage.id, Math.round(rule.score * 0.45), reasons, `${stage.id}:neighbor`);
    }
  }

  if (file.includes("connector")) addScore(scores, "connectors", 28, reasons, "connectors:file");
  if (file.includes("data extraction")) addScore(scores, "extract", 28, reasons, "extract:file");
  if (file.includes("distribution")) addScore(scores, "persist", 24, reasons, "persist:file");
  if (file.includes("kerndichtesch")) addScore(scores, "persist", 28, reasons, "persist:kde-file");
  if (file.includes("arrival table")) {
    addScore(scores, "extract", 18, reasons, "extract:arrival-file");
    addScore(scores, "simulate", 8, reasons, "simulate:arrival-file");
  }
  if (file.includes("is table")) {
    addScore(scores, "extract", 12, reasons, "extract:is-table");
    addScore(scores, "transform", 12, reasons, "transform:is-table");
  }
  if (own.includes("simulation data generator extract data") || own.includes("simulation data generator filter data")) {
    addScore(scores, "transform", 18, reasons, "transform:sim-prep");
  }
  if (own.includes("generate sim data")) addScore(scores, "simulate", 18, reasons, "simulate:generate");
  if (own.includes("calc distribution")) addScore(scores, "persist", 14, reasons, "persist:calc");
  if (own.includes("get processing time") || own.includes("calc sim time")) addScore(scores, "simulate", 18, reasons, "simulate:runtime");
  if (own.includes("match order to number of goods")) addScore(scores, "transform", 18, reasons, "transform:goods");

  for (const relation of ctx.relationsBySymbolId.get(symbol.id) ?? []) {
    const otherId = relation.source === symbol.id ? relation.target : relation.source;
    const otherText = ctx.textById.get(otherId) ?? normalize(otherId);
    if (relation.type === "reads" && looksLikeInput(otherText)) addScore(scores, "extract", 10, reasons, "extract:reads-input");
    if (relation.type === "reads" && looksLikePersist(otherText)) addScore(scores, "simulate", 10, reasons, "simulate:reads-persist");
    if (relation.type === "writes" && looksLikeArrival(otherText)) {
      addScore(scores, "extract", 10, reasons, "extract:writes-arrival");
      addScore(scores, "simulate", 6, reasons, "simulate:writes-arrival");
    }
    if (relation.type === "writes" && looksLikePersist(otherText)) addScore(scores, "persist", 10, reasons, "persist:writes");
    if ((relation.type === "calls" || relation.type === "instantiates") && otherText.includes("connector")) addScore(scores, "extract", 8, reasons, "extract:uses-connector");
    if ((relation.type === "calls" || relation.type === "instantiates") && own.includes("simulation data generator") && otherText.includes("data extraction")) addScore(scores, "transform", 10, reasons, "transform:uses-extract");
    if ((relation.type === "calls" || relation.type === "imports") && (otherText.includes("distribution") || otherText.includes("kde"))) addScore(scores, "persist", 8, reasons, "persist:uses-persist");
  }

  if (looksLikeArtifact(symbol)) {
    if (looksLikeInput(own)) addScore(scores, "extract", 16, reasons, "extract:input-artifact");
    if (looksLikeRaw(own)) addScore(scores, "extract", 12, reasons, "extract:raw-artifact");
    if (looksLikeMatched(own)) addScore(scores, "transform", 18, reasons, "transform:matched-artifact");
    if (looksLikePersist(own)) addScore(scores, "persist", 18, reasons, "persist:artifact");
    if (looksLikeArrival(own)) addScore(scores, "simulate", 20, reasons, "simulate:arrival-artifact");
  }

  let best: StageId | null = null;
  let bestScore = -1;
  for (const stage of STAGES) {
    const score = scores[stage.id];
    if (score > bestScore || (score === bestScore && tieBreak(stage.id, best ?? stage.id) > 0)) {
      best = stage.id;
      bestScore = score;
    }
  }
  const threshold = symbol.kind === "external" ? 10 : 14;
  const result = best && bestScore >= threshold ? { stage: best, score: bestScore, scores, reasons: reasons.slice(0, 6) } : null;
  ctx.classifications.set(symbol.id, result);
  return result;
}

function buildStageNodes(graph: ProjectGraph, ctx: Context): DraftNode[] {
  const claimed = new Set<string>();
  const nodes: DraftNode[] = [];
  for (const blueprint of BLUEPRINTS) {
    const hits = graph.symbols
      .filter((symbol) => !claimed.has(symbol.id) && isCodeSymbol(symbol) && ctx.classifications.get(symbol.id)?.stage === blueprint.stage)
      .map((symbol) => ({ symbol, score: scoreBlueprint(symbol, blueprint, ctx) }))
      .filter((entry) => entry.score >= (blueprint.minScore ?? 18))
      .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
      .slice(0, 4);
    if (hits.length === 0) continue;
    const ids = compact(hits.map((hit) => hit.symbol.id));
    for (const id of ids) claimed.add(id);
    nodes.push({
      id: `proc:node:${blueprint.stage}:${blueprint.id}`,
      label: blueprint.label,
      umlType: "component",
      stage: blueprint.stage,
      role: blueprint.role,
      order: blueprint.order,
      priority: hits[0]?.score ?? 0,
      stereotype: "<<component>>",
      parentId: stageDef(blueprint.stage).packageId,
      preview: compact(hits.map((hit) => hit.symbol.label)).slice(0, 3),
      mappedSymbolIds: ids,
      drilldownSymbolIds: ids,
      drilldown: { preferredSymbolIds: ids, symbolSearch: blueprint.terms },
    });
  }

  for (const stage of STAGES) {
    if (stage.id === "sources") continue;
    if (nodes.some((node) => node.stage === stage.id && node.umlType !== "artifact")) continue;
    const fallback = graph.symbols
      .filter((symbol) => !claimed.has(symbol.id) && isCodeSymbol(symbol) && ctx.classifications.get(symbol.id)?.stage === stage.id)
      .map((symbol) => ({ symbol, score: (ctx.classifications.get(symbol.id)?.score ?? 0) + kindWeight(symbol.kind) }))
      .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
      .slice(0, 4);
    if (fallback.length === 0) continue;
    const ids = compact(fallback.map((entry) => entry.symbol.id));
    nodes.push({
      id: `proc:node:${stage.id}:fallback`,
      label: fallbackLabel(stage.id),
      umlType: "component",
      stage: stage.id,
      role: `${stage.id}-fallback`,
      order: 95,
      priority: fallback[0]?.score ?? 0,
      stereotype: "<<component>>",
      parentId: stage.packageId,
      preview: compact(fallback.map((entry) => entry.symbol.label)).slice(0, 3),
      mappedSymbolIds: ids,
      drilldownSymbolIds: ids,
      drilldown: { preferredSymbolIds: ids, preferredViewIds: compact([chooseBestStageDrilldownView(graph, ctx, stage.id)]) },
    });
  }
  return nodes.sort(compareNodes);
}

function buildSyntheticSourceNodes(graph: ProjectGraph, ctx: Context): DraftNode[] {
  const nodes: DraftNode[] = [];
  for (const source of SOURCES) {
    const supporting = graph.symbols
      .filter((symbol) => {
        const stage = ctx.classifications.get(symbol.id)?.stage;
        if (stage !== "connectors" && stage !== "sources") return false;
        const text = ctx.textById.get(symbol.id) ?? "";
        return source.terms.some((term) => includes(text, term));
      })
      .sort((a, b) => kindWeight(b.kind) - kindWeight(a.kind));
    if (supporting.length === 0) continue;
    const ids = compact(supporting.map((symbol) => symbol.id)).slice(0, 6);
    nodes.push({
      id: `proc:db:${source.id}`,
      label: source.label,
      umlType: "database",
      stage: "sources",
      role: `source:${source.id}`,
      order: source.order,
      priority: supporting.length,
      stereotype: "<<database>>",
      parentId: stageDef("sources").packageId,
      preview: [`inferred from ${compact(supporting.map((symbol) => symbol.label)).slice(0, 2).join(", ")}`],
      mappedSymbolIds: [],
      drilldownSymbolIds: ids,
      drilldown: { preferredSymbolIds: ids, symbolSearch: source.terms },
    });
  }
  if (nodes.length > 0) return nodes;
  const connectorIds = compact(graph.symbols.filter((symbol) => ctx.classifications.get(symbol.id)?.stage === "connectors").map((symbol) => symbol.id)).slice(0, 6);
  return connectorIds.length === 0
    ? []
    : [{
        id: "proc:db:generic",
        label: "Externe SQL-Quellen",
        umlType: "database",
        stage: "sources",
        role: "source:generic",
        order: 99,
        priority: 1,
        stereotype: "<<database>>",
        parentId: stageDef("sources").packageId,
        preview: ["inferred from connector layer"],
        mappedSymbolIds: [],
        drilldownSymbolIds: connectorIds,
        drilldown: { preferredSymbolIds: connectorIds, viewSearch: ["connector", "source"] },
      }];
}

function buildSyntheticArtifactNodes(graph: ProjectGraph, ctx: Context): DraftNode[] {
  const explicitArtifacts = graph.symbols.filter((symbol) => looksLikeArtifact(symbol));
  const claimed = new Set<string>();
  const nodes: DraftNode[] = [];
  for (const family of ARTIFACTS) {
    const explicit = explicitArtifacts.filter((symbol) => !claimed.has(symbol.id) && family.explicit.some((pattern) => pattern.test(artifactText(symbol.label))));
    const inferred = graph.symbols.filter((symbol) => (family.inferred ?? []).some((term) => includes(ctx.textById.get(symbol.id) ?? "", term)));
    if (explicit.length === 0 && inferred.length === 0) continue;
    for (const symbol of explicit) claimed.add(symbol.id);
    const mappedIds = compact([...explicit.map((symbol) => symbol.id), ...inferred.filter((symbol) => symbol.kind === "external").map((symbol) => symbol.id)]);
    const drilldownIds = compact([
      ...explicit.flatMap((symbol) => artifactRelatedIds(graph, symbol.id)),
      ...inferred.filter((symbol) => symbol.kind !== "external").map((symbol) => symbol.id),
      ...mappedIds,
    ]).slice(0, 8);
    nodes.push({
      id: `proc:art:${family.id}`,
      label: family.label,
      umlType: "artifact",
      stage: family.stage,
      role: family.role,
      order: family.order,
      priority: explicit.length + inferred.length,
      stereotype: "<<artifact>>",
      parentId: stageDef(family.stage).packageId,
      preview: artifactPreview(explicit, inferred),
      mappedSymbolIds: mappedIds,
      drilldownSymbolIds: drilldownIds,
      drilldown: { preferredSymbolIds: drilldownIds },
    });
  }
  return nodes.sort(compareNodes);
}

function ensureStageCoverage(graph: ProjectGraph, ctx: Context, nodes: DraftNode[]): DraftNode[] {
  const next = [...nodes];
  for (const stage of STAGES) {
    if (next.some((node) => node.stage === stage.id)) continue;
    const ids = collectStageSymbolIds(ctx, stage.id, []).slice(0, 6);
    next.push({
      id: `proc:node:${stage.id}:generic`,
      label: fallbackLabel(stage.id),
      umlType: stage.id === "sources" ? "database" : "component",
      stage: stage.id,
      role: `${stage.id}-generic`,
      order: 999,
      priority: 0,
      stereotype: stage.id === "sources" ? "<<database>>" : "<<component>>",
      parentId: stage.packageId,
      preview: ids.length > 0 ? [`scan hits: ${ids.length}`] : ["scan-driven fallback"],
      mappedSymbolIds: [],
      drilldownSymbolIds: ids,
      drilldown: { preferredSymbolIds: ids, preferredViewIds: compact([chooseBestStageDrilldownView(graph, ctx, stage.id)]) },
    });
  }
  return next.sort(compareNodes);
}

function buildStageViews(graph: ProjectGraph, ctx: Context, nodes: DraftNode[]): ProcessStageViewConfig[] {
  return STAGES.map((stage) => {
    const storeNodes = stageStoreNodes(stage.id, nodes);
    const internalNodeRefs = buildStageViewInternalNodeRefs(graph, ctx, stage.id, nodes);
    const nodeRefs = compact([
      ...storeNodes.map((node) => node.id),
      ...internalNodeRefs,
    ]);
    const nodeRefSet = new Set(nodeRefs);
    const edgeRefs = graph.relations
      .filter((relation) =>
        relation.type !== "contains" &&
        !relation.id.startsWith("process-edge:") &&
        !relation.id.startsWith("stub-edge:") &&
        nodeRefSet.has(relation.source) &&
        nodeRefSet.has(relation.target),
      )
      .map((relation) => relation.id);
    const edges = buildStageStoreEdges(graph, ctx, stage.id, nodes, storeNodes, internalNodeRefs);
    return {
      id: stageViewId(stage.id),
      title: stage.label,
      stage: stage.id,
      nodeRefs,
      edgeRefs,
      edges,
      nodePositions: generateStageViewLayout(graph, nodeRefs, nodes),
    };
  });
}

function buildStageViewInternalNodeRefs(
  graph: ProjectGraph,
  ctx: Context,
  stage: StageId,
  nodes: DraftNode[],
): string[] {
  const symbolById = ctx.symbolById;
  const ranked = new Map<string, number>();
  const boost = (symbolId: string | undefined, amount: number) => {
    if (!symbolId) return;
    const symbol = symbolById.get(symbolId);
    if (!symbol || !isStageViewInternalSymbol(symbol)) return;
    ranked.set(symbol.id, Math.max(ranked.get(symbol.id) ?? Number.NEGATIVE_INFINITY, amount));
  };

  const seedIds = new Set<string>();
  for (const id of collectStageSymbolIds(ctx, stage, nodes)) {
    for (const candidateId of ctx.ancestorsById.get(id) ?? [id]) {
      const candidate = symbolById.get(candidateId);
      if (!candidate || !isStageViewInternalSymbol(candidate)) continue;
      seedIds.add(candidate.id);
      break;
    }
  }

  for (const node of nodes.filter((candidate) => candidate.stage === stage && !isStoreDraftNode(candidate))) {
    for (const id of [...node.mappedSymbolIds, ...node.drilldownSymbolIds]) {
      for (const candidateId of ctx.ancestorsById.get(id) ?? [id]) {
        const candidate = symbolById.get(candidateId);
        if (!candidate || !isStageViewInternalSymbol(candidate)) continue;
        seedIds.add(candidate.id);
        break;
      }
    }
  }

  if (stage === "sources" || stage === "connectors") {
    for (const node of nodes.filter((candidate) => candidate.stage === "connectors" && !isStoreDraftNode(candidate))) {
      for (const id of [...node.mappedSymbolIds, ...node.drilldownSymbolIds]) {
        for (const candidateId of ctx.ancestorsById.get(id) ?? [id]) {
          const candidate = symbolById.get(candidateId);
          if (!candidate || !isStageViewInternalSymbol(candidate)) continue;
          seedIds.add(candidate.id);
          break;
        }
      }
    }
  }

  for (const id of seedIds) {
    const symbol = symbolById.get(id);
    if (!symbol) continue;
    boost(symbol.id, scoreStageViewSymbol(symbol, stage, ctx, graph));
    if (symbol.kind === "class") {
      boost(symbol.parentId, scoreStageViewSymbol(symbol, stage, ctx, graph) + 12);
    }
    if (symbol.kind === "module" || symbol.kind === "class") {
      for (const ancestorId of ctx.ancestorsById.get(symbol.id) ?? []) {
        const ancestor = symbolById.get(ancestorId);
        if (!ancestor || ancestor.id === symbol.id || ancestor.kind !== "group" || !isStageViewInternalSymbol(ancestor)) continue;
        boost(ancestor.id, scoreStageViewSymbol(symbol, stage, ctx, graph) + 6);
        break;
      }
    }
  }

  const modules = [...ranked.entries()]
    .map(([id, score]) => ({ id, score, symbol: symbolById.get(id)! }))
    .filter((entry) => entry.symbol.kind === "module" && isAcceptedStageSymbol(entry.symbol, stage, ctx))
    .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
    .slice(0, 8)
    .map((entry) => entry.id);
  const classes = [...ranked.entries()]
    .map(([id, score]) => ({ id, score, symbol: symbolById.get(id)! }))
    .filter((entry) => entry.symbol.kind === "class" && isAcceptedStageSymbol(entry.symbol, stage, ctx))
    .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
    .slice(0, 8)
    .map((entry) => entry.id);
  const groupCandidates = compact([...modules, ...classes].flatMap((id) =>
    (ctx.ancestorsById.get(id) ?? [])
      .map((ancestorId) => symbolById.get(ancestorId))
      .filter((ancestor): ancestor is Symbol => Boolean(ancestor && ancestor.kind === "group" && isStageViewInternalSymbol(ancestor)))
      .map((ancestor) => ancestor.id)
      .slice(0, 1),
  ));
  const groups = groupCandidates
    .map((id) => ({ id, score: ranked.get(id) ?? 0, symbol: symbolById.get(id)! }))
    .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
    .slice(0, 2)
    .map((entry) => entry.id);

  return compact([...groups, ...modules, ...classes]);
}

function buildStageStoreEdges(
  graph: ProjectGraph,
  ctx: Context,
  stage: StageId,
  nodes: DraftNode[],
  storeNodes: DraftNode[],
  internalNodeRefs: string[],
): ProcessEdgeConfig[] {
  if (internalNodeRefs.length === 0) return [];
  const internalSet = new Set(internalNodeRefs);
  const componentNodes = nodes.filter((node) => node.stage === stage && !isStoreDraftNode(node));
  const primaryTargets = componentNodes
    .flatMap((node) => resolveInternalTargets(node, ctx, internalSet))
    .slice(0, 4);
  const fallbackTarget = primaryTargets[0] ?? internalNodeRefs[0];
  const edges: ProcessEdgeConfig[] = [];
  for (const storeNode of storeNodes) {
    const targets = resolveInternalTargets(storeNode, ctx, internalSet);
    const targetIds = compact([...targets, fallbackTarget]).slice(0, 2);
    if (targetIds.length === 0) continue;
    for (const targetId of targetIds) {
      const spec = stageStoreEdgeSpec(storeNode, stage);
      edges.push({
        id: `stage-${stage}-${safe(storeNode.id)}-${safe(targetId)}`,
        source: spec.direction === "out" ? targetId : storeNode.id,
        target: spec.direction === "out" ? storeNode.id : targetId,
        type: spec.type,
        label: spec.label,
      });
    }
  }
  return dedupeProcessEdges(edges);
}

function resolveInternalTargets(
  node: DraftNode,
  ctx: Context,
  internalSet: Set<string>,
): string[] {
  const matches: string[] = [];
  for (const id of [...node.mappedSymbolIds, ...node.drilldownSymbolIds]) {
    for (const candidateId of ctx.ancestorsById.get(id) ?? [id]) {
      if (internalSet.has(candidateId)) {
        matches.push(candidateId);
        break;
      }
    }
  }
  return compact(matches);
}

function stageStoreNodes(stage: StageId, nodes: DraftNode[]): DraftNode[] {
  if (stage === "sources") {
    return nodes.filter((node) => node.umlType === "database").sort(compareNodes);
  }
  if (stage === "connectors") {
    return nodes.filter((node) => node.umlType === "database" && node.stage === "sources").sort(compareNodes);
  }
  return nodes
    .filter((node) => node.stage === stage && isStoreDraftNode(node))
    .sort(compareNodes);
}

function stageStoreEdgeSpec(
  storeNode: DraftNode,
  stage: StageId,
): { direction: "in" | "out"; type: RelationType; label?: string } {
  if (storeNode.umlType === "database") {
    return {
      direction: "in",
      type: "reads",
      label: storeNode.role.includes("druid")
        ? "read analytics data"
        : storeNode.role.includes("sap")
          ? "read ERP data"
          : "read production data",
    };
  }
  if (storeNode.role === "input-files") return { direction: "in", type: "reads", label: "read input tables" };
  if (storeNode.role === "raw-datasets") {
    return stage === "extract"
      ? { direction: "out", type: "writes", label: "write raw csv" }
      : { direction: "in", type: "reads", label: "load raw csv" };
  }
  if (storeNode.role === "matched-datasets") {
    return stage === "transform"
      ? { direction: "out", type: "writes", label: "write clean dataset" }
      : { direction: "in", type: "reads", label: "fit distributions" };
  }
  if (storeNode.role === "distribution-json") return { direction: "out", type: "writes", label: "persist json" };
  if (storeNode.role === "kde-artifacts") return { direction: "out", type: "writes", label: "persist kde" };
  if (storeNode.role === "distribution-exports") return { direction: "out", type: "writes", label: "export statistics" };
  if (storeNode.role === "arrival-tables") return { direction: "in", type: "reads", label: "load arrival tables" };
  if (storeNode.role === "simulation-output") return { direction: "out", type: "writes", label: "export simulation output" };
  return {
    direction: stage === "persist" ? "out" : "in",
    type: stage === "persist" ? "writes" : "reads",
    label: stage === "persist" ? "persist data" : "load data",
  };
}

function generateStageViewLayout(
  graph: ProjectGraph,
  nodeRefs: string[],
  nodes: DraftNode[],
): StageViewNodePosition[] {
  const symbolById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const draftById = new Map(nodes.map((node) => [node.id, node]));
  const columns: Array<{ ids: string[]; x: number; width: number; step: number }> = [
    { ids: [], x: 40, width: 250, step: 110 },
    { ids: [], x: 330, width: 280, step: 130 },
    { ids: [], x: 660, width: 300, step: 130 },
    { ids: [], x: 1010, width: 320, step: 150 },
  ];

  for (const nodeRef of nodeRefs) {
    const symbol = symbolById.get(nodeRef);
    const draft = draftById.get(nodeRef);
    const umlType = symbol?.umlType ?? draft?.umlType;
    const kind = symbol?.kind ?? kindFromDraftUmlType(draft?.umlType);
    if (umlType === "database" || umlType === "artifact") columns[0].ids.push(nodeRef);
    else if (kind === "group") columns[1].ids.push(nodeRef);
    else if (kind === "module") columns[2].ids.push(nodeRef);
    else columns[3].ids.push(nodeRef);
  }

  return columns.flatMap((column, columnIndex) =>
    column.ids.map((symbolId, index) => ({
      symbolId,
      x: column.x,
      y: 40 + index * column.step,
      width: column.width,
      height:
        columnIndex === 0
          ? 86
          : columnIndex === 1
            ? 116
            : columnIndex === 2
              ? 112
              : 138,
    })),
  );
}

function kindFromDraftUmlType(umlType: DraftNode["umlType"] | undefined): Symbol["kind"] {
  if (umlType === "package" || umlType === "group") return "group";
  if (umlType === "component" || umlType === "module") return "module";
  if (umlType === "class") return "class";
  return "external";
}

function isStageViewInternalSymbol(symbol: Symbol): boolean {
  if (symbol.tags?.includes("process-overview") || symbol.tags?.includes("external-stub")) return false;
  if (symbol.tags?.includes("artifact-cluster")) return false;
  if (symbol.tags?.some((tag) => tag.startsWith("art-cat:")) || symbol.tags?.includes("artifact-category")) return false;
  if (symbol.id.startsWith("ext:") || symbol.id.startsWith("stub:")) return false;
  if (symbol.id === "grp:dir:__root__" || symbol.id.startsWith("grp:domain:")) return false;
  if (symbol.kind !== "group" && symbol.kind !== "module" && symbol.kind !== "class") return false;
  return true;
}

function isStoreDraftNode(node: DraftNode): boolean {
  return node.umlType === "database" || node.umlType === "artifact";
}

function scoreStageViewSymbol(
  symbol: Symbol,
  stage: StageId,
  ctx: Context,
  graph: ProjectGraph,
): number {
  const ownScore = ctx.classifications.get(symbol.id)?.scores[stage] ?? 0;
  let descendantScore = 0;
  for (const candidate of graph.symbols) {
    if (candidate.id === symbol.id) continue;
    const ancestors = ctx.ancestorsById.get(candidate.id) ?? [];
    if (!ancestors.includes(symbol.id)) continue;
    descendantScore = Math.max(descendantScore, ctx.classifications.get(candidate.id)?.scores[stage] ?? 0);
  }
  return ownScore + descendantScore + kindWeight(symbol.kind) + (symbol.childViewId ? 8 : 0);
}

function isAcceptedStageSymbol(symbol: Symbol, stage: StageId, ctx: Context): boolean {
  const acceptedStages =
    stage === "sources" || stage === "connectors"
      ? new Set<StageId>(["sources", "connectors"])
      : new Set<StageId>([stage]);
  const classification = ctx.classifications.get(symbol.id);
  return classification ? acceptedStages.has(classification.stage) : false;
}

function dedupeProcessEdges(edges: ProcessEdgeConfig[]): ProcessEdgeConfig[] {
  const seen = new Set<string>();
  const uniqueEdges: ProcessEdgeConfig[] = [];
  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}|${edge.type}|${edge.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEdges.push(edge);
  }
  return uniqueEdges;
}

function aggregateProcessEdges(graph: ProjectGraph, ctx: Context, nodes: DraftNode[]): ProcessEdgeConfig[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ownerBySymbolId = new Map<string, string>();
  for (const node of [...nodes].sort((a, b) => b.priority - a.priority || a.order - b.order)) {
    for (const id of node.mappedSymbolIds) if (!ownerBySymbolId.has(id)) ownerBySymbolId.set(id, node.id);
  }
  const edgeMap = new Map<string, EdgeAcc>();

  for (const relation of graph.relations) {
    if (relation.type === "contains" || relation.id.startsWith("process-edge:") || relation.id.startsWith("stub-edge:")) continue;
    const src = ownerOf(relation.source, ownerBySymbolId, ctx.ancestorsById);
    const tgt = ownerOf(relation.target, ownerBySymbolId, ctx.ancestorsById);
    if (!src || !tgt || src === tgt) continue;
    const srcNode = nodeById.get(src);
    const tgtNode = nodeById.get(tgt);
    if (!srcNode || !tgtNode) continue;
    const oriented = orient(relation, srcNode, tgtNode);
    if (!oriented) continue;
    const fromNode = nodeById.get(oriented.sourceId);
    const toNode = nodeById.get(oriented.targetId);
    if (!fromNode || !toNode) continue;
    const distance = Math.abs(STAGE_ORDER[fromNode.stage ?? "extract"] - STAGE_ORDER[toNode.stage ?? "extract"]);
    const store = isStore(fromNode) || isStore(toNode);
    if (distance > 1) continue;
    if (isStore(fromNode) && !isStore(toNode) && STAGE_ORDER[fromNode.stage ?? "extract"] > STAGE_ORDER[toNode.stage ?? "extract"]) {
      continue;
    }
    if (!store && fromNode.stage === "persist" && toNode.stage === "simulate") continue;
    if (!store && fromNode.stage === toNode.stage) continue;
    addEdge(edgeMap, oriented.sourceId, oriented.targetId, oriented.type, edgeLabel(fromNode, toNode, oriented.type), 1);
  }

  addSourceEdges(edgeMap, nodes);
  addFallbackFlow(edgeMap, nodes);

  return [...edgeMap.values()]
    .sort((a, b) => edgeSort(a, b, nodeById))
    .map((edge, index) => ({
      id: `agg-${index + 1}-${safe(edge.source)}-${safe(edge.target)}`,
      source: edge.source,
      target: edge.target,
      type: dominantType(edge.typeCounts),
      label: bestEdgeLabel(edge),
    }));
}

function addSourceEdges(edgeMap: Map<string, EdgeAcc>, nodes: DraftNode[]): void {
  const genericConnector = stagePrimary(nodes, "connectors");
  const pairs: Array<[DraftNode | undefined, DraftNode | undefined, string]> = [
    [findRole(nodes, "source:mes"), findRole(nodes, "mes-connector") ?? genericConnector, "read production data"],
    [findRole(nodes, "source:druid"), findRole(nodes, "druid-connector") ?? genericConnector, "read analytics data"],
    [findRole(nodes, "source:sap"), findRole(nodes, "sap-connector") ?? genericConnector, "read ERP data"],
    [findRole(nodes, "source:generic"), genericConnector, "query source systems"],
  ];
  for (const [from, to, label] of pairs) {
    if (from && to) addEdge(edgeMap, from.id, to.id, "reads", label, 3);
  }
}

function addFallbackFlow(edgeMap: Map<string, EdgeAcc>, nodes: DraftNode[]): void {
  const extract = stagePrimary(nodes, "extract");
  const transform = stagePrimary(nodes, "transform");
  const persist = stagePrimary(nodes, "persist");
  const simulate = stagePrimary(nodes, "simulate");
  const input = findRole(nodes, "input-files");
  const raw = findRole(nodes, "raw-datasets");
  const matched = findRole(nodes, "matched-datasets");
  const json = findRole(nodes, "distribution-json");
  const kde = findRole(nodes, "kde-artifacts");
  const exports = findRole(nodes, "distribution-exports");
  const arrival = findRole(nodes, "arrival-tables");
  const simOutput = findRole(nodes, "simulation-output");
  const arrivalBuilder = findRole(nodes, "arrival-builder");

  for (const connector of nodes.filter((node) => node.stage === "connectors" && node.umlType !== "artifact")) {
    if (extract) addEdge(edgeMap, connector.id, extract.id, "calls", "load raw data", 1);
  }
  if (input && extract) addEdge(edgeMap, input.id, extract.id, "reads", "read input tables", 2);
  if (extract && raw) addEdge(edgeMap, extract.id, raw.id, "writes", "write raw csv", 2);
  if (raw && transform) addEdge(edgeMap, raw.id, transform.id, "reads", "normalize + match", 2);
  if (!raw && extract && transform) addEdge(edgeMap, extract.id, transform.id, "calls", "normalize", 1);
  if (transform && matched) addEdge(edgeMap, transform.id, matched.id, "writes", "write clean dataset", 2);
  if (matched && persist) addEdge(edgeMap, matched.id, persist.id, "reads", "fit distributions", 2);
  if (!matched && transform && persist) addEdge(edgeMap, transform.id, persist.id, "calls", "fit distributions", 1);
  if (persist && json) addEdge(edgeMap, persist.id, json.id, "writes", "persist json", 2);
  if (persist && kde) addEdge(edgeMap, persist.id, kde.id, "writes", "persist kde", 2);
  if (persist && exports) addEdge(edgeMap, persist.id, exports.id, "writes", "export statistics", 1);
  if (json && simulate) addEdge(edgeMap, json.id, simulate.id, "reads", "consume persisted artefacts", 2);
  if (kde && simulate) addEdge(edgeMap, kde.id, simulate.id, "reads", "consume persisted artefacts", 2);
  if (arrivalBuilder && arrival) addEdge(edgeMap, arrivalBuilder.id, arrival.id, "writes", "write arrival tables", 2);
  if (arrival && simulate) addEdge(edgeMap, arrival.id, simulate.id, "reads", "load arrival tables", 2);
  if (simulate && simOutput) addEdge(edgeMap, simulate.id, simOutput.id, "writes", "export simulation output", 1);
}

function generateProcessLayout(input: {
  viewId: string;
  title: string;
  packages: Array<Omit<ProcessPackageConfig, "position"> & { stage: StageId }>;
  nodes: DraftNode[];
  edges: ProcessEdgeConfig[];
  stageViews: ProcessStageViewConfig[];
}): ProcessDiagramConfig {
  const packages: ProcessPackageConfig[] = input.packages.map((pkg) => {
    const stage = stageDef(pkg.stage);
    const childCount = input.nodes.filter((node) => node.parentId === pkg.id).length;
    return { ...pkg, position: { x: stage.x, y: stage.y, width: stage.width, height: Math.max(260, 86 + Math.ceil(Math.max(childCount, 1) / 2) * 112) } };
  });
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const nodes: ProcessNodeConfig[] = input.nodes.map((node) => {
    if (!node.parentId) return { ...node, position: { x: 850, y: 28, width: 700, height: 84 } };
    const parent = packageById.get(node.parentId);
    if (!parent) return { ...node, position: { x: 0, y: 0 } };
    const siblings = input.nodes.filter((candidate) => candidate.parentId === node.parentId).sort(compareNodes);
    const index = siblings.findIndex((candidate) => candidate.id === node.id);
    const cols = siblings.length <= 1 ? 1 : 2;
    const gap = 18;
    const usableWidth = (parent.position.width ?? 320) - 48;
    const width = cols === 1 ? usableWidth : Math.max(140, Math.floor((usableWidth - gap) / cols));
    return {
      ...node,
      position: {
        x: 24 + (index % cols) * (width + gap),
        y: 72 + Math.floor(index / cols) * 110,
        width,
        height: node.umlType === "database" ? 88 : node.umlType === "artifact" ? 78 : 92,
      },
    };
  });
  return {
    viewId: input.viewId,
    title: input.title,
    packages,
    nodes,
    edges: input.edges,
    stageViews: input.stageViews,
  };
}

function collectStageSymbolIds(ctx: Context, stage: StageId, nodes: DraftNode[]): string[] {
  return compact([
    ...nodes.filter((node) => node.stage === stage).flatMap((node) => node.drilldownSymbolIds),
    ...[...ctx.classifications.entries()].filter((entry) => entry[1]?.stage === stage).sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0)).map(([id]) => id).slice(0, 14),
  ]).slice(0, 18);
}

function buildStagePreview(stage: StageId, ctx: Context, nodes: DraftNode[]): string[] {
  const symbolCount = [...ctx.classifications.values()].filter((entry) => entry?.stage === stage).length;
  const stageNodes = nodes.filter((node) => node.stage === stage);
  const componentCount = stageNodes.filter((node) => node.umlType !== "artifact" && node.umlType !== "database").length;
  const artifactCount = stageNodes.filter((node) => node.umlType === "artifact").length;
  const dbCount = stageNodes.filter((node) => node.umlType === "database").length;
  const example = compact(stageNodes.map((node) => node.label)).slice(0, 2).join(", ");
  return compact([`${symbolCount} scan hits`, `${componentCount} Komponenten, ${artifactCount} Artefakte, ${dbCount} Quellen`, example]).slice(0, 3);
}

function chooseBestStageDrilldownView(graph: ProjectGraph, ctx: Context, stage: StageId): string | undefined {
  const stageSymbols = new Set(
    [...ctx.classifications.entries()]
      .filter((entry) => entry[1]?.stage === stage)
      .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
      .slice(0, 40)
      .map(([id]) => id),
  );
  if (stageSymbols.size === 0) return undefined;
  let best: { id: string; score: number } | null = null;
  for (const view of graph.views) {
    if (view.id === VIEW_ID) continue;
    if (view.hiddenInSidebar) continue;
    if (view.id.startsWith("view:artifacts:") || view.id.startsWith("view:art-cat:")) continue;
    if (/artifacts|other artifacts|data files|libraries|i\/o/i.test(view.title)) continue;
    let score = scopeScore(view.scope);
    for (const nodeId of view.nodeRefs) {
      if (nodeId.startsWith("ext:") || nodeId.startsWith("stub:")) {
        score -= 8;
        continue;
      }
      const chain = ctx.ancestorsById.get(nodeId) ?? [nodeId];
      const hit = chain.find((id) => stageSymbols.has(id));
      if (hit) score += ctx.classifications.get(hit)?.score ?? 4;
    }
    for (const term of viewTerms(stage)) if (includes(normalize(`${view.id} ${view.title}`), term)) score += 6;
    if (!best || score > best.score) best = { id: view.id, score };
  }
  return best && best.score > 10 ? best.id : undefined;
}

function buildAncestors(symbols: Symbol[]): Map<string, string[]> {
  const parentById = new Map(symbols.map((symbol) => [symbol.id, symbol.parentId]));
  const cache = new Map<string, string[]>();
  const compute = (id: string): string[] => {
    const cached = cache.get(id);
    if (cached) return cached;
    const chain = [id];
    let cursor = parentById.get(id);
    let depth = 0;
    while (cursor && depth < 40) {
      chain.push(cursor);
      cursor = parentById.get(cursor);
      depth += 1;
    }
    cache.set(id, chain);
    return chain;
  };
  for (const symbol of symbols) compute(symbol.id);
  return cache;
}

function ownerOf(symbolId: string, ownerBySymbolId: Map<string, string>, ancestorsById: Map<string, string[]>): string | undefined {
  if (ownerBySymbolId.has(symbolId)) return ownerBySymbolId.get(symbolId);
  for (const id of ancestorsById.get(symbolId) ?? []) {
    if (ownerBySymbolId.has(id)) return ownerBySymbolId.get(id);
  }
  return undefined;
}

function orient(relation: Relation, sourceNode: DraftNode, targetNode: DraftNode): { sourceId: string; targetId: string; type: RelationType } | null {
  const sourceIsStore = isStore(sourceNode);
  const targetIsStore = isStore(targetNode);
  if (relation.type === "reads" || relation.type === "uses_config") {
    if (!sourceIsStore && targetIsStore) return { sourceId: targetNode.id, targetId: sourceNode.id, type: relation.type };
    if (sourceIsStore && !targetIsStore) return { sourceId: sourceNode.id, targetId: targetNode.id, type: relation.type };
  }
  if (relation.type === "writes") {
    if (!sourceIsStore && targetIsStore) return { sourceId: sourceNode.id, targetId: targetNode.id, type: relation.type };
    if (sourceIsStore && !targetIsStore) return { sourceId: targetNode.id, targetId: sourceNode.id, type: relation.type };
  }
  return STAGE_ORDER[sourceNode.stage ?? "extract"] <= STAGE_ORDER[targetNode.stage ?? "extract"]
    ? { sourceId: sourceNode.id, targetId: targetNode.id, type: relation.type }
    : { sourceId: targetNode.id, targetId: sourceNode.id, type: relation.type };
}

function edgeLabel(sourceNode: DraftNode, targetNode: DraftNode, type: RelationType): string | undefined {
  if (sourceNode.umlType === "database" && targetNode.stage === "connectors") return sourceNode.role.includes("druid") ? "read analytics data" : sourceNode.role.includes("sap") ? "read ERP data" : "read production data";
  if (sourceNode.stage === "connectors" && targetNode.stage === "extract") return "load raw data";
  if (sourceNode.role === "input-files" && targetNode.stage === "extract") return "read input tables";
  if (sourceNode.stage === "extract" && targetNode.role === "raw-datasets") return "write raw csv";
  if (sourceNode.role === "raw-datasets" && targetNode.stage === "transform") return "normalize + match";
  if (sourceNode.stage === "transform" && targetNode.role === "matched-datasets") return "write clean dataset";
  if (sourceNode.role === "matched-datasets" && targetNode.stage === "persist") return "fit distributions";
  if (sourceNode.stage === "persist" && targetNode.role === "distribution-json") return "persist json";
  if (sourceNode.stage === "persist" && targetNode.role === "kde-artifacts") return "persist kde";
  if ((sourceNode.role === "distribution-json" || sourceNode.role === "kde-artifacts") && targetNode.stage === "simulate") return "consume persisted artefacts";
  if (sourceNode.role === "arrival-tables" && targetNode.stage === "simulate") return "load arrival tables";
  if (sourceNode.role === "arrival-builder" && targetNode.role === "arrival-tables") return "write arrival tables";
  if (sourceNode.stage === "simulate" && targetNode.role === "simulation-output") return "export simulation output";
  if (type === "reads") return "load data";
  if (type === "writes") return "persist data";
  if (type === "uses_config") return "load config";
  return "process";
}

function addEdge(edgeMap: Map<string, EdgeAcc>, source: string, target: string, type: RelationType, label: string | undefined, weight: number): void {
  const key = `${source}|${target}`;
  const edge: EdgeAcc = edgeMap.get(key) ?? { source, target, typeCounts: {}, labels: new Map<string, number>() };
  edge.typeCounts[type] = (edge.typeCounts[type] ?? 0) + weight;
  if (label) edge.labels.set(label, (edge.labels.get(label) ?? 0) + weight);
  edgeMap.set(key, edge);
}

function bestEdgeLabel(edge: EdgeAcc): string | undefined {
  let best: { label: string; count: number } | null = null;
  for (const [label, count] of edge.labels.entries()) if (!best || count > best.count) best = { label, count };
  return best?.label;
}

function edgeSort(a: EdgeAcc, b: EdgeAcc, nodeById: Map<string, DraftNode>): number {
  const sa = nodeById.get(a.source)?.stage ?? "sources";
  const sb = nodeById.get(b.source)?.stage ?? "sources";
  const ta = nodeById.get(a.target)?.stage ?? "sources";
  const tb = nodeById.get(b.target)?.stage ?? "sources";
  return STAGE_ORDER[sa] - STAGE_ORDER[sb] || STAGE_ORDER[ta] - STAGE_ORDER[tb] || a.source.localeCompare(b.source) || a.target.localeCompare(b.target);
}

function dominantType(counts: Partial<Record<RelationType, number>>): RelationType {
  let best: RelationType = "calls";
  let bestCount = -1;
  for (const [type, count] of Object.entries(counts) as Array<[RelationType, number]>) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

function artifactRelatedIds(graph: ProjectGraph, artifactId: string): string[] {
  return compact(graph.relations.filter((relation) => relation.source === artifactId || relation.target === artifactId).map((relation) => relation.source === artifactId ? relation.target : relation.source).filter((id) => !id.startsWith("ext:")));
}

function artifactPreview(explicit: Symbol[], inferred: Symbol[]): string[] {
  const files = compact(explicit.map((symbol) => basename(symbol.label))).slice(0, 3);
  if (files.length > 0) return files;
  return compact(inferred.map((symbol) => symbol.kind === "external" ? symbol.label.replace(/^ext:/, "") : symbol.label)).slice(0, 2).map((label) => `inferred via ${label}`);
}

function scoreBlueprint(symbol: Symbol, blueprint: Blueprint, ctx: Context): number {
  const text = ctx.textById.get(symbol.id) ?? "";
  const stageScore = ctx.classifications.get(symbol.id)?.score ?? 0;
  let hits = 0;
  for (const term of blueprint.terms) if (includes(text, term)) hits += 1;
  return hits === 0 ? -1 : stageScore + hits * 12 + kindWeight(symbol.kind) + (symbol.childViewId ? 6 : 0) + (symbol.doc?.summary ? 2 : 0);
}

function isCodeSymbol(symbol: Symbol): boolean {
  return symbol.kind === "module" || symbol.kind === "class" || symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "group";
}

function isStore(node: DraftNode): boolean {
  return node.umlType === "artifact" || node.umlType === "database";
}

function looksLikeArtifact(symbol: Symbol): boolean {
  const pathText = artifactText(`${symbol.label} ${symbol.id} ${symbol.location?.file ?? ""}`);
  const text = normalize(`${symbol.label} ${symbol.id} ${symbol.location?.file ?? ""}`);
  return symbol.kind === "external" || /\.(csv|tsv|xlsx?|json|pkl|pickle|joblib|sql|db)\b/i.test(pathText) || text.includes("json dump") || text.includes("pickle dump");
}

function looksLikeInput(text: string): boolean {
  return /\b(input|files input|mes auszuge)\b/.test(text) && /\b(csv|xlsx|xls|json|sql)\b/.test(text);
}

function looksLikeRaw(text: string): boolean {
  return /(df wt|df data|validation data|nass var)/.test(text) && /\b(csv|xlsx|xls)\b/.test(text);
}

function looksLikeMatched(text: string): boolean {
  return /(with order|cluster|worker|filter stats|outliner|route csv|is table)/.test(text);
}

function looksLikePersist(text: string): boolean {
  return /(distribution|efficien|json|pickle|pkl|kde|min max|constant times)/.test(text);
}

function looksLikeArrival(text: string): boolean {
  return /arrival/.test(text) && /\bcsv\b/.test(text);
}

function emptyScores(): ScoreMap {
  return { sources: 0, connectors: 0, extract: 0, transform: 0, persist: 0, simulate: 0 };
}

function addScore(scores: ScoreMap, stage: StageId, amount: number, reasons: string[], reason: string): void {
  scores[stage] += amount;
  if (!reasons.includes(reason)) reasons.push(reason);
}

function tieBreak(candidate: StageId, current: StageId): number {
  const priority: Record<StageId, number> = { sources: 1, connectors: 2, extract: 4, transform: 5, persist: 3, simulate: 6 };
  return priority[candidate] - priority[current];
}

function fallbackLabel(stage: StageId): string {
  return stage === "sources" ? "Externe Quellen" : stage === "connectors" ? "Connector Layer" : stage === "extract" ? "Data Extraction" : stage === "transform" ? "Matching / Filtering" : stage === "persist" ? "Distribution / Persistenz" : "Simulation Runtime";
}

function kindWeight(kind: Symbol["kind"]): number {
  return kind === "class" ? 6 : kind === "module" ? 5 : kind === "function" ? 4 : kind === "method" ? 3 : kind === "group" ? 2 : 1;
}

function stagePrimary(nodes: DraftNode[], stage: StageId): DraftNode | undefined {
  return nodes.filter((node) => node.stage === stage && node.umlType !== "artifact" && node.umlType !== "database").sort(compareNodes)[0];
}

function findRole(nodes: DraftNode[], role: string): DraftNode | undefined {
  return nodes.find((node) => node.role === role);
}

function compareNodes(a: DraftNode, b: DraftNode): number {
  return a.order - b.order || b.priority - a.priority || a.label.localeCompare(b.label);
}

function stageDef(stage: StageId): StageDef {
  const found = STAGES.find((candidate) => candidate.id === stage);
  if (!found) throw new Error(`Unknown process stage: ${stage}`);
  return found;
}

function stageViewId(stage: StageId): string {
  return `view:process-stage:${stage}`;
}

function viewTerms(stage: StageId): string[] {
  return stage === "sources" ? ["source", "connector", "data source"] : stage === "connectors" ? ["connector", "infra"] : stage === "extract" ? ["extract", "extraction", "pipeline", "arrival"] : stage === "transform" ? ["filter", "match", "cluster", "transform"] : stage === "persist" ? ["distribution", "kde", "persist"] : ["simulation", "arrival", "generator"];
}

function scopeScore(scope: DiagramView["scope"]): number {
  return scope === "group" ? 22 : scope === "module" ? 16 : scope === "class" ? 10 : scope === "root" ? -6 : 0;
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
  const normalized = normalize(term);
  return normalized.length > 0 && text.includes(normalized);
}

function compact(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function artifactText(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]+/g, "_");
}
