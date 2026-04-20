import type { DiagramView, ProjectGraph, Relation, RelationType, Symbol } from "@dmpg/shared";

type StageId =
  | "inputs"
  | "extract"
  | "transform"
  | "match"
  | "distribution"
  | "simulation";

type ScoreMap = Record<StageId, number>;
type ArtifactCategory = "tabular" | "json" | "binary" | "arrival" | "source" | "artifact" | "libraries-imports";
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
}

interface ProcessEdgeConfig {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  label?: string;
}

interface ProcessStageViewConfig {
  id: string;
  title: string;
  parentViewId?: string | null;
  scope: DiagramView["scope"];
  diagramType?: DiagramView["diagramType"];
  hiddenInSidebar?: boolean;
  nodeRefs: string[];
  edgeRefs: string[];
}

interface ProcessViewAdjustment {
  id: string;
  parentViewId?: string | null;
  hiddenInSidebar?: boolean;
}

export interface ProcessDiagramConfig {
  viewId: string;
  title: string;
  packages: ProcessPackageConfig[];
  nodes: ProcessNodeConfig[];
  edges: ProcessEdgeConfig[];
  supportNodes?: ProcessNodeConfig[];
  stageViews?: ProcessStageViewConfig[];
  viewAdjustments?: ProcessViewAdjustment[];
}

interface StageDef {
  id: StageId;
  packageId: string;
  viewId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StageRule {
  pattern: RegExp;
  score: number;
}

interface StageOverrideRule {
  stage: StageId;
  pattern: RegExp;
}

interface Classification {
  primaryStage: StageId;
  score: number;
  scores: ScoreMap;
}

interface RankedStageNode {
  symbol: Symbol;
  stageScore: number;
  rank: number;
}

interface Context {
  symbolById: Map<string, Symbol>;
  relationsBySymbolId: Map<string, Relation[]>;
  childrenById: Map<string, Symbol[]>;
  ancestorsById: Map<string, string[]>;
  ownTextById: Map<string, string>;
  parentTextById: Map<string, string>;
  childTextById: Map<string, string>;
  neighborTextById: Map<string, string>;
  textById: Map<string, string>;
  classifications: Map<string, Classification | null>;
  stageAssignments: Map<string, StageId | null>;
}

interface ArtifactFlowGroup {
  key: string;
  label: string;
  paths: string[];
  artifactIds: string[];
  producerStageIds: StageId[];
  consumerStageIds: StageId[];
  producerSourceIds: string[];
  consumerSourceIds: string[];
  producerLabels: string[];
  consumerLabels: string[];
  relationCount: number;
  readCount: number;
  writeCount: number;
  category: ArtifactCategory;
  kind: "input" | "handoff" | "output";
  score: number;
}

interface LayerOneContent {
  packages: ProcessPackageConfig[];
  nodes: ProcessNodeConfig[];
  edges: ProcessEdgeConfig[];
}

interface LayerOneSideNodeConfig {
  node: ProcessNodeConfig;
  edgeLabel: string;
  groupKeys?: string[];
  groups?: ArtifactFlowGroup[];
}

interface LayerOneStageArtifactItem {
  node: ProcessNodeConfig;
  producerStageId: StageId;
  consumerStageIds: StageId[];
  category: ArtifactCategory;
  edgeLabel: string;
  score: number;
  groupKeys: string[];
  groups: ArtifactFlowGroup[];
}

interface ArtifactClusterBucket {
  key: string;
  label: string;
  producerStageId: StageId;
  groups: ArtifactFlowGroup[];
  category: ArtifactCategory;
  score: number;
  candidateKind: "family" | "category";
}

type ArtifactPreviewMode = "single" | "cluster";

interface ArtifactPreviewMetaPayload {
  kind: "artifact-preview";
  mode: ArtifactPreviewMode;
  stageId?: StageId;
  stageLabel?: string;
  flow?: string;
  category?: ArtifactCategory;
  groupKind?: ArtifactFlowGroup["kind"];
  groupCount: number;
  pathCount: number;
}

interface ArtifactPreviewItemPayload {
  label: string;
  paths: string[];
  artifactIds: string[];
  writeCount: number;
  readCount: number;
  producerIds: string[];
  consumerIds: string[];
  producers: string[];
  consumers: string[];
  producerStages: StageId[];
  consumerStages: StageId[];
  category: ArtifactCategory;
  groupKind: ArtifactFlowGroup["kind"];
}

const MIN_STAGE_CLUSTER_BUCKET_SIZE = 3;

interface BuiltStageView {
  views: ProcessStageViewConfig[];
  edges: ProcessEdgeConfig[];
  nodes: ProcessNodeConfig[];
}

export interface ProcessArtifactDescriptor {
  id: string;
  label: string;
  preview?: string[];
}

const VIEW_ID = "view:process-overview";
const STAGE_VIEW_PREFIX = "view:process-stage:";
const VIEW_TITLE = "Architecture & Dataflow Overview";

const STAGES: readonly StageDef[] = [
  {
    id: "inputs",
    packageId: "proc:pkg:inputs",
    viewId: `${STAGE_VIEW_PREFIX}inputs`,
    label: "Input Sources",
    x: 760,
    y: 180,
    width: 320,
    height: 112,
  },
  {
    id: "extract",
    packageId: "proc:pkg:extract",
    viewId: `${STAGE_VIEW_PREFIX}extract`,
    label: "Extraction & Preprocessing",
    x: 750,
    y: 350,
    width: 340,
    height: 112,
  },
  {
    id: "transform",
    packageId: "proc:pkg:transform",
    viewId: `${STAGE_VIEW_PREFIX}transform`,
    label: "Transformation",
    x: 770,
    y: 520,
    width: 300,
    height: 112,
  },
  {
    id: "match",
    packageId: "proc:pkg:match",
    viewId: `${STAGE_VIEW_PREFIX}match`,
    label: "Matching & Filtering",
    x: 760,
    y: 690,
    width: 320,
    height: 112,
  },
  {
    id: "distribution",
    packageId: "proc:pkg:distribution",
    viewId: `${STAGE_VIEW_PREFIX}distribution`,
    label: "Distribution / KDE / Persistence",
    x: 740,
    y: 870,
    width: 360,
    height: 112,
  },
  {
    id: "simulation",
    packageId: "proc:pkg:simulation",
    viewId: `${STAGE_VIEW_PREFIX}simulation`,
    label: "Simulation",
    x: 790,
    y: 1060,
    width: 260,
    height: 112,
  },
] as const;

const RULES: Record<StageId, readonly StageRule[]> = {
  inputs: [
    { pattern: /\binput\b|\binputs\b|input sources?|data sources?|datenquellen/, score: 18 },
    { pattern: /\bmes\b|\bdruid\b|\bsap\b|\bapi\b|\bconnector\b|\bingest\b/, score: 18 },
    { pattern: /\bsql\b|\bdatabase\b|\bdb\b|\bcsv\b|\bxlsx\b|\bxls\b|\bexcel\b/, score: 14 },
  ],
  extract: [
    { pattern: /\bextract\b|\bextraction\b|\bdata extraction\b|\bload data\b/, score: 18 },
    { pattern: /\bpreprocess\b|\bpreprocessing\b|\bprepare\b|\bclean\b|\betl\b/, score: 14 },
    { pattern: /\barrival\b|\bis table\b|\bwt\b|\bload\b/, score: 10 },
  ],
  transform: [
    { pattern: /\btransform\b|\btransformation\b|\bnormalize\b|\bconvert\b|\benrich\b/, score: 18 },
    { pattern: /\bcolor\b|\bstatistics\b|\banaly[sz]e\b|\breshape\b|\baggregate\b/, score: 12 },
    { pattern: /\butil\b|\bhelper\b/, score: 4 },
  ],
  match: [
    { pattern: /\bmatch\b|\bmatching\b|\bcluster\b|\bassign\b|\bmap\b/, score: 18 },
    { pattern: /\bfilter\b|\bfiltering\b|\biqr\b|\boutlier\b|\bremove outliner\b|\bremove outlier\b/, score: 18 },
    { pattern: /\broute\b|\bstation\b|\border\b/, score: 10 },
  ],
  distribution: [
    { pattern: /\bdistribution\b|\bfit distribution\b|\bparameter\b/, score: 18 },
    { pattern: /\bkde\b|\bkernel\b|\bkerndichtesch\b/, score: 18 },
    { pattern: /\bpersist\b|\bpersistence\b|\bpickle\b|\bpkl\b|\bsave object\b|\bsave_object\b/, score: 16 },
  ],
  simulation: [
    { pattern: /\bsimulation\b|\bsimulator\b|\bsim data\b|\bsim\b/, score: 18 },
    { pattern: /\bgenerator\b|\bruntime\b|\bmodel py\b|\bmodel\.py\b/, score: 14 },
    { pattern: /\bcalc sim time\b|\bprocessing time\b/, score: 12 },
  ],
};

const STAGE_OVERRIDE_RULES: readonly StageOverrideRule[] = [
  { stage: "inputs", pattern: /\bconnector\b|\bmes connector\b|\bdruid connector\b/ },
  { stage: "extract", pattern: /\bdata extraction\b|\bdata extractor\b/ },
  { stage: "transform", pattern: /\bcolor change\b|\bdata analyzer\b|\bstatistics\b/ },
  { stage: "match", pattern: /\bfilter methods\b|\biqr filter\b|\bis table\b|\bgenerate is table\b/ },
  { stage: "distribution", pattern: /\bdistribution\b|\bkerndichtesch/ },
  { stage: "simulation", pattern: /\bsimulation data generator\b|\bsim generator\b|\barrival table\b|\bgenerate arrival table\b/ },
] as const;

const FLOW_NODE_WIDTH = 322;
const FLOW_NODE_HEIGHT = 96;
const FLOW_SIDE_GAP = 430;
const FLOW_VERTICAL_GAP = 122;
const SIDE_NODE_TOP_Y = 36;
const SIDE_NODE_BOTTOM_OFFSET = 102;
const SIDE_NODE_ESTIMATED_WIDTH = 188;
const SIDE_NODE_GAP_X = 286;
const SIDE_NODE_GAP_Y = 96;

const PIPELINE_EDGES: readonly ProcessEdgeConfig[] = [
  {
    id: "pipeline:inputs->extract",
    source: "proc:pkg:inputs",
    target: "proc:pkg:extract",
    type: "reads",
    label: "source records",
  },
  {
    id: "pipeline:extract->transform",
    source: "proc:pkg:extract",
    target: "proc:pkg:transform",
    type: "calls",
    label: "prepared data",
  },
  {
    id: "pipeline:transform->match",
    source: "proc:pkg:transform",
    target: "proc:pkg:match",
    type: "calls",
    label: "normalized entities",
  },
  {
    id: "pipeline:match->distribution",
    source: "proc:pkg:match",
    target: "proc:pkg:distribution",
    type: "calls",
    label: "matched / filtered data",
  },
  {
    id: "pipeline:distribution->simulation",
    source: "proc:pkg:distribution",
    target: "proc:pkg:simulation",
    type: "reads",
    label: "fitted distributions / KDE",
  },
] as const;

const KNOWN_ARTIFACT_LABELS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /^df data$/, label: "df_data.csv" },
  { pattern: /^df data with order$/, label: "df_data_with_order.csv" },
  { pattern: /^df data with order cluster$/, label: "df_data_with_order_cluster.csv" },
  { pattern: /^df data with order worker$/, label: "df_data_with_order_worker.csv" },
  { pattern: /^df wt$/, label: "df_wt.csv" },
  { pattern: /^df wt to order$/, label: "df_wt_to_order.csv" },
  { pattern: /^nass var$/, label: "nass_var.csv" },
  { pattern: /^nass var constant times$/, label: "nass_var_constant_times.csv" },
  { pattern: /^arrival klein$/i, label: "Arrival_Klein.csv" },
  { pattern: /^arrival gro.*$/i, label: "Arrival_Groß.csv" },
  { pattern: /^kde min max values$/i, label: "kde_min_max_values.json" },
  { pattern: /^effency$/i, label: "effency.json" },
  { pattern: /^distribution$/i, label: "distribution.json" },
  { pattern: /^fallback$/i, label: "fallback.json" },
  { pattern: /^color change$/i, label: "color_change.json" },
  { pattern: /^color change fallback$/i, label: "color_change_fallback.json" },
  { pattern: /^data analyzation$/i, label: "data_analyzation.xlsx" },
] as const;

export function buildProcessDiagramConfigFromGraph(graph: ProjectGraph): ProcessDiagramConfig {
  const ctx = buildContext(graph);
  for (const symbol of graph.symbols) {
    ctx.classifications.set(symbol.id, classifySymbol(symbol, ctx));
  }

  const flowGroups = collectArtifactFlowGroups(graph, ctx);
  const prominentFlowGroups = selectArtifactFlowGroupsForStageOverlay(flowGroups);
  const builtStageViews = STAGES.map((stage) => buildStageViewConfig(graph, ctx, stage, prominentFlowGroups));
  const stageViews = builtStageViews.flatMap((entry) => entry.views);
  const stageEdges = builtStageViews.flatMap((entry) => entry.edges);
  const supportNodes = builtStageViews.flatMap((entry) => entry.nodes);
  const layerOne = buildLayerOneContent(ctx, stageViews, flowGroups);

  return {
    viewId: VIEW_ID,
    title: VIEW_TITLE,
    packages: layerOne.packages,
    nodes: layerOne.nodes,
    supportNodes,
    edges: [...layerOne.edges, ...stageEdges, ...PIPELINE_EDGES],
    stageViews,
    viewAdjustments: buildViewAdjustments(graph, ctx),
  };
}

function buildLayerOneContent(
  ctx: Context,
  stageViews: ProcessStageViewConfig[],
  flowGroups: ArtifactFlowGroup[],
): LayerOneContent {
  const stageViewById = new Map(stageViews.map((view) => [view.id, view]));
  const inputNodes = buildLayerOneInputNodes(
    ctx,
    stageViewById.get(stageDef("inputs").viewId)?.nodeRefs ?? [],
    flowGroups,
  );
  const outputNodes = buildLayerOneOutputNodes(flowGroups);
  const outputGroupKeys = new Set(outputNodes.flatMap((entry) => entry.groupKeys ?? []));
  const stageArtifactItems = buildLayerOneStageArtifactItems(flowGroups, outputGroupKeys);
  const stageFlowNodes = STAGES.flatMap((stage) =>
    positionStageSideNodes(
      stage,
      stageArtifactItems
        .filter((item) => item.producerStageId === stage.id)
        .map((item) => item.node),
    ),
  );

  const packages = STAGES.map((stage) =>
    buildStagePackageConfig(
      stage,
      ctx,
      stageViewById.get(stage.viewId)?.nodeRefs ?? [],
      flowGroups,
    ),
  );

  const nodes: ProcessNodeConfig[] = [];
  const edges: ProcessEdgeConfig[] = [];

  nodes.push(...positionInputNodes(inputNodes.map((entry) => entry.node)));
  nodes.push(...stageFlowNodes);
  for (const inputNode of inputNodes) {
    edges.push({
      id: `flow:${slugify(inputNode.node.id)}:to-inputs`,
      source: inputNode.node.id,
      target: "proc:pkg:inputs",
      type: "reads",
      label: inputNode.edgeLabel,
    });
  }

  nodes.push(...positionOutputNodes(outputNodes.map((entry) => entry.node)));
  for (const outputNode of outputNodes) {
    edges.push({
      id: `flow:${slugify(outputNode.node.id)}:to-simulation-output`,
      source: "proc:pkg:simulation",
      target: outputNode.node.id,
      type: "writes",
      label: summarizeArtifactEdgeLabel(
        outputNode.groups ?? [],
        outputNode.edgeLabel,
        outputNode.groupKeys?.length ?? 0,
      ),
    });
  }

  for (const item of stageArtifactItems) {
    const artifactNodeId = item.node.id;
    edges.push({
      id: `flow:${slugify(stageDef(item.producerStageId).packageId)}:${slugify(artifactNodeId)}:write`,
      source: stageDef(item.producerStageId).packageId,
      target: artifactNodeId,
      type: "writes",
      label: summarizeArtifactEdgeLabel(item.groups, item.edgeLabel, item.groupKeys.length),
    });

    for (const consumerStage of item.consumerStageIds) {
      const consumerGroups = item.groups.filter((group) => crossStageConsumers(group).includes(consumerStage));
      edges.push({
        id: `flow:${slugify(artifactNodeId)}:${slugify(stageDef(consumerStage).packageId)}:read`,
        source: artifactNodeId,
        target: stageDef(consumerStage).packageId,
        type: "reads",
        label: summarizeArtifactEdgeLabel(
          consumerGroups,
          flowReadLabelForCategory(item.category, consumerStage),
          item.groupKeys.length,
        ),
      });
    }
  }

  return { packages, nodes, edges };
}

function buildLayerOneInputNodes(
  ctx: Context,
  stageNodeRefs: string[],
  flowGroups: ArtifactFlowGroup[],
): LayerOneSideNodeConfig[] {
  const inputSymbols = stageNodeRefs
    .map((nodeRef) => ctx.symbolById.get(nodeRef))
    .filter((symbol): symbol is Symbol => Boolean(symbol));
  const sortedInputSymbols = [...inputSymbols]
    .sort((left, right) => left.label.localeCompare(right.label));
  const inputLabels = unique(inputSymbols.map((symbol) => symbol.label));
  const fileInputs = flowGroups
    .filter((group) =>
      group.kind === "input" &&
      (group.category === "tabular" || group.category === "source" || looksLikeConcreteArtifact(group.label)),
    )
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const dbExamples = inputLabels.filter((label) =>
    /\bdruid\b|\bdb\b|\bsql\b|\bdatabase\b/.test(normalize(label)),
  );
  const dbSymbols = sortedInputSymbols.filter((symbol) =>
    /\bdruid\b|\bdb\b|\bsql\b|\bdatabase\b/.test(normalize(symbol.label)),
  );
  const externalExamples = inputLabels.filter((label) =>
    /\bmes\b|\bapi\b|\bexternal\b|\bconnector\b/.test(normalize(label)) &&
    !dbExamples.includes(label),
  );
  const externalSymbols = sortedInputSymbols.filter((symbol) =>
    /\bmes\b|\bapi\b|\bexternal\b|\bconnector\b/.test(normalize(symbol.label)) &&
    !dbSymbols.some((candidate) => candidate.id === symbol.id),
  );

  const nodes: LayerOneSideNodeConfig[] = [];

  if (dbExamples.length > 0) {
    nodes.push({
      node: createLayerOneSideNode(
        "proc:input:database-import",
        "Database Import",
        "database",
        buildInputSymbolPreview(dbSymbols, "source"),
      ),
      edgeLabel: "database import",
    });
  }

  if (fileInputs.length > 0) {
    nodes.push({
      node: createLayerOneSideNode(
        "proc:input:file-imports",
        "CSV / Files",
        "artifact",
        buildDetailedArtifactPreview(fileInputs, "inputs"),
      ),
      edgeLabel: "file ingest",
    });
  }

  if (externalExamples.length > 0 || (inputLabels.length > 0 && dbExamples.length === 0)) {
    const previewSymbols = externalSymbols.length > 0 ? externalSymbols : sortedInputSymbols;
    nodes.push({
      node: createLayerOneSideNode(
        "proc:input:external-sources",
        "MES / External Sources",
        "component",
        buildInputSymbolPreview(previewSymbols, "source"),
      ),
      edgeLabel: "external feeds",
    });
  }

  return nodes;
}

function buildLayerOneOutputNodes(flowGroups: ArtifactFlowGroup[]): LayerOneSideNodeConfig[] {
  const relevantGroups = flowGroups
    .filter((group) => {
      const producerStage = dominantStage(group.producerStageIds);
      return producerStage === "simulation" && group.kind === "output";
    })
    .sort((a, b) =>
      outputSelectionPriority(b) - outputSelectionPriority(a) ||
      b.score - a.score ||
      a.label.localeCompare(b.label),
    );

  const usedKeys = new Set<string>();
  const takeGroups = (predicate: (group: ArtifactFlowGroup) => boolean): ArtifactFlowGroup[] => {
    const groups = relevantGroups.filter((group) => !usedKeys.has(group.key) && predicate(group));
    for (const group of groups) {
      usedKeys.add(group.key);
    }
    return groups;
  };

  const nodes: LayerOneSideNodeConfig[] = [];
  const addNode = (
    id: string,
    label: string,
    umlType: UmlType,
    edgeLabel: string,
    groups: ArtifactFlowGroup[],
  ) => {
    if (groups.length === 0) return;
    nodes.push({
      node: createLayerOneSideNode(
        id,
        label,
        umlType,
        buildDetailedArtifactPreview(groups),
      ),
      edgeLabel,
      groupKeys: groups.map((group) => group.key),
      groups,
    });
  };

  const arrivalGroups = takeGroups((group) =>
    group.category === "arrival" || /\barrival\b/.test(normalize(group.label)),
  );
  addNode("proc:output:arrival-table", "Arrival Table", "artifact", "arrival data", arrivalGroups);

  const generatedDataGroups = takeGroups((group) =>
    group.category === "tabular" &&
    !/\barrival\b/.test(normalize(group.label)) &&
    !isSimulationResultGroup(group) &&
    !isVisualArtifactGroup(group),
  );
  addNode("proc:output:generated-data", "Generated Data", "artifact", "generated data", generatedDataGroups);

  const generatedSimulationDataGroups = takeGroups((group) =>
    (group.category === "json" || group.category === "binary" || looksLikePersistedOutput(normalize(group.label))) &&
    !isSimulationResultGroup(group),
  );
  addNode(
    "proc:output:generated-simulation-data",
    "Generated Simulation Data",
    "artifact",
    "generated simulation data",
    generatedSimulationDataGroups,
  );

  const simulationResultGroups = takeGroups((group) => isSimulationResultGroup(group) || isVisualArtifactGroup(group));
  addNode(
    "proc:output:simulation-results",
    "Simulation Results",
    "artifact",
    "simulation results",
    simulationResultGroups,
  );

  const remainingGroups = relevantGroups.filter((group) => !usedKeys.has(group.key));
  if (remainingGroups.length > 0) {
    const generatedNode = nodes.find((entry) => entry.node.id === "proc:output:generated-data");
    if (generatedNode) {
      generatedNode.groups = [...(generatedNode.groups ?? []), ...remainingGroups];
      generatedNode.groupKeys = unique([
        ...(generatedNode.groupKeys ?? []),
        ...remainingGroups.map((group) => group.key),
      ]);
      generatedNode.node.preview = buildDetailedArtifactPreview(
        generatedNode.groups,
      );
    } else {
      addNode("proc:output:generated-data", "Generated Data", "artifact", "generated data", remainingGroups);
    }
  }

  return nodes;
}

function buildLayerOneStageArtifactItems(
  flowGroups: ArtifactFlowGroup[],
  excludedGroupKeys: Set<string>,
): LayerOneStageArtifactItem[] {
  const items: LayerOneStageArtifactItem[] = [];

  for (const stage of STAGES) {
    if (stage.id === "inputs") continue;

    const stageGroups = flowGroups.filter((group) =>
      dominantStage(group.producerStageIds) === stage.id &&
      group.kind !== "input" &&
      !excludedGroupKeys.has(group.key),
    );
    if (stageGroups.length === 0) continue;

    const clusters = buildArtifactClustersForStage(stage.id, stageGroups);
    const clusteredKeys = new Set(clusters.flatMap((cluster) => cluster.groups.map((group) => group.key)));
    const stageItems = [
      ...clusters.map((cluster) => createStageArtifactItemFromCluster(cluster)),
      ...stageGroups
        .filter((group) => !clusteredKeys.has(group.key))
        .map((group) => createStageArtifactItemFromGroup(stage.id, group)),
    ]
      .sort((a, b) =>
        stageArtifactItemPriority(stage.id, b) - stageArtifactItemPriority(stage.id, a) ||
        b.score - a.score ||
        a.node.label.localeCompare(b.node.label),
      )
      .slice(0, stageArtifactLimit(stage.id));

    items.push(...stageItems);
  }

  return items;
}

function buildArtifactClustersForStage(
  stage: StageId,
  groups: ArtifactFlowGroup[],
): ArtifactClusterBucket[] {
  if (groups.length < MIN_STAGE_CLUSTER_BUCKET_SIZE) {
    return [];
  }

  const usedGroupKeys = new Set<string>();
  const clusters: ArtifactClusterBucket[] = [];
  const candidates = buildArtifactClusterCandidates(stage, groups)
    .filter((candidate) => shouldCreateArtifactCluster(groups, candidate.groups, candidate.candidateKind))
    .sort((a, b) =>
      b.groups.length - a.groups.length ||
      (a.candidateKind === b.candidateKind ? 0 : a.candidateKind === "family" ? -1 : 1) ||
      b.score - a.score ||
      a.label.localeCompare(b.label),
    );

  for (const candidate of candidates) {
    if (candidate.groups.some((group) => usedGroupKeys.has(group.key))) {
      continue;
    }
    clusters.push(candidate);
    for (const group of candidate.groups) {
      usedGroupKeys.add(group.key);
    }
  }

  return clusters.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function buildArtifactClusterCandidates(
  stage: StageId,
  groups: ArtifactFlowGroup[],
): ArtifactClusterBucket[] {
  const candidates: ArtifactClusterBucket[] = [];
  const familyBuckets = groupBy(groups, (group) => [
    stage,
    group.category,
    artifactClusterFamilyKey(group) ?? "mixed",
  ].join("|"));
  const categoryBuckets = groupBy(groups, (group) => [stage, group.category].join("|"));

  for (const bucketGroups of familyBuckets.values()) {
    const category = bucketGroups[0]?.category ?? "artifact";
    const familyKey = preferredArtifactClusterFamily(bucketGroups);
    if (!familyKey) continue;
    candidates.push(
      createArtifactClusterBucket(stage, category, bucketGroups, {
        familyKey: familyKey ?? undefined,
        candidateKind: "family",
      }),
    );
  }

  for (const bucketGroups of categoryBuckets.values()) {
    const category = bucketGroups[0]?.category ?? "artifact";
    candidates.push(
      createArtifactClusterBucket(stage, category, bucketGroups, {
        familyKey: preferredArtifactClusterFamily(bucketGroups) ?? undefined,
        candidateKind: "category",
      }),
    );
  }

  return candidates;
}

function shouldCreateArtifactCluster(
  stageGroups: ArtifactFlowGroup[],
  bucketGroups: ArtifactFlowGroup[],
  candidateKind: ArtifactClusterBucket["candidateKind"],
): boolean {
  if (bucketGroups.length < MIN_STAGE_CLUSTER_BUCKET_SIZE) {
    return false;
  }

  if (bucketGroups.length === 1) {
    return false;
  }

  if (bucketGroups.length === stageGroups.length && bucketGroups.length < 4) {
    return false;
  }

  if (candidateKind === "family") {
    return bucketGroups.length >= MIN_STAGE_CLUSTER_BUCKET_SIZE;
  }

  const remaining = stageGroups.length - bucketGroups.length;
  return bucketGroups.length >= 4 || remaining >= 1;
}

function createArtifactClusterBucket(
  stage: StageId,
  category: ArtifactCategory,
  groups: ArtifactFlowGroup[],
  options: {
    familyKey?: string;
    candidateKind: "family" | "category";
  },
): ArtifactClusterBucket {
  const qualifier = options.familyKey ? humanizeArtifactFamily(options.familyKey) : shortStageTitle(stage);
  return {
    key: `${stage}:${category}:${options.familyKey ?? options.candidateKind}`,
    label: `${artifactCategoryTitle(category)} (${qualifier})`,
    producerStageId: stage,
    groups: [...groups].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)),
    category,
    score: groups.reduce((sum, group) => sum + group.score, 0) + groups.length * 24,
    candidateKind: options.candidateKind,
  };
}

function createStageArtifactItemFromCluster(cluster: ArtifactClusterBucket): LayerOneStageArtifactItem {
  const groupKeys = cluster.groups.map((group) => group.key);
  return {
    node: createLayerOneSideNode(
      `proc:artifact-cluster:${slugify(cluster.key)}`,
      cluster.label,
      "artifact",
      buildDetailedArtifactPreview(cluster.groups, cluster.producerStageId),
    ),
    producerStageId: cluster.producerStageId,
    consumerStageIds: sortUniqueStages(cluster.groups.flatMap((group) => crossStageConsumers(group))),
    category: cluster.category,
    edgeLabel: flowWriteLabelForCategory(cluster.category),
    score: cluster.score,
    groupKeys,
    groups: cluster.groups,
  };
}

function createStageArtifactItemFromGroup(stage: StageId, group: ArtifactFlowGroup): LayerOneStageArtifactItem {
  return {
    node: createLayerOneSideNode(
      flowNodeId(group),
      group.label,
      "artifact",
      buildFlowPreview(group),
    ),
    producerStageId: stage,
    consumerStageIds: crossStageConsumers(group),
    category: group.category,
    edgeLabel: flowWriteLabel(group),
    score: group.score,
    groupKeys: [group.key],
    groups: [group],
  };
}

function createLayerOneSideNode(
  id: string,
  label: string,
  umlType: UmlType,
  preview: string[] | undefined,
): ProcessNodeConfig {
  return {
    id,
    label,
    umlType,
    stereotype: stereotypeForUmlType(umlType),
    preview,
    position: { x: 0, y: 0, width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT },
  };
}

function buildExamplePreview(examples: string[]): string[] | undefined {
  return examples.length > 0 ? [`Examples: ${summarizeList(unique(examples), 3)}`] : undefined;
}

function stereotypeForUmlType(umlType: UmlType): string | undefined {
  switch (umlType) {
    case "database":
      return "<<database>>";
    case "component":
      return "<<component>>";
    case "note":
      return "<<note>>";
    case "artifact":
      return "<<artifact>>";
    default:
      return undefined;
  }
}

function buildStagePackageConfig(
  stage: StageDef,
  ctx: Context,
  stageNodeRefs: string[],
  flowGroups: ArtifactFlowGroup[],
): ProcessPackageConfig {
  return {
    id: stage.packageId,
    label: stage.label,
    stereotype: "<<package>>",
    childViewId: stage.viewId,
    preview: buildStagePackagePreview(stage.id, ctx, stageNodeRefs, flowGroups),
    position: {
      x: stage.x,
      y: stage.y,
      width: stage.width,
      height: stage.height,
    },
  };
}

function buildStagePackagePreview(
  stage: StageId,
  ctx: Context,
  stageNodeRefs: string[],
  flowGroups: ArtifactFlowGroup[],
): string[] | undefined {
  const focus = summarizeList(
    unique(stageNodeRefs
      .map((nodeRef) => ctx.symbolById.get(nodeRef))
      .filter((symbol): symbol is Symbol => Boolean(symbol))
      .filter((symbol) => !symbol.id.startsWith("proc:"))
      .map((symbol) => symbol.label)
      .filter((label): label is string => Boolean(label))),
    2,
  );
  const consumed = summarizeList(
    unique(flowGroups
      .filter((group) => group.consumerStageIds.includes(stage) && !group.producerStageIds.includes(stage))
      .map((group) => group.label)),
    3,
  );
  const produced = summarizeList(
    unique(flowGroups
      .filter((group) => group.producerStageIds.includes(stage))
      .map((group) => group.label)),
    3,
  );

  const lines = [
    focus ? `Focus: ${focus}` : null,
    consumed ? `Consumes: ${consumed}` : null,
    produced ? `Produces: ${produced}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines : undefined;
}

function collectArtifactFlowGroups(graph: ProjectGraph, ctx: Context): ArtifactFlowGroup[] {
  const byKey = new Map<string, {
    originalLabel: string;
    paths: Set<string>;
    artifactIds: Set<string>;
    producerStageCounts: Map<StageId, number>;
    consumerStageCounts: Map<StageId, number>;
    producerSourceIds: Set<string>;
    consumerSourceIds: Set<string>;
    producerLabels: Set<string>;
    consumerLabels: Set<string>;
    readCount: number;
    writeCount: number;
  }>();

  for (const relation of graph.relations) {
    if (relation.type !== "reads" && relation.type !== "writes") continue;
    if (relation.id.startsWith("process-edge:") || relation.id.startsWith("stub-edge:")) continue;

    const target = ctx.symbolById.get(relation.target);
    if (!target || !isLayerOneArtifactCandidate(target)) continue;

    const stage = resolveStageForSymbolId(relation.source, ctx);
    if (!stage) continue;

    const artifactLabel = canonicalArtifactLabel(target.label);
    const key = artifactFamilyKey(artifactLabel);
    const bucket = byKey.get(key) ?? {
      originalLabel: artifactLabel,
      paths: new Set<string>(),
      artifactIds: new Set<string>(),
      producerStageCounts: new Map<StageId, number>(),
      consumerStageCounts: new Map<StageId, number>(),
      producerSourceIds: new Set<string>(),
      consumerSourceIds: new Set<string>(),
      producerLabels: new Set<string>(),
      consumerLabels: new Set<string>(),
      readCount: 0,
      writeCount: 0,
    };
    bucket.paths.add(artifactLabel);
    bucket.artifactIds.add(relation.target);

    const sourceLabel = ctx.symbolById.get(relation.source)?.label ?? relation.source;
    if (relation.type === "writes") {
      bucket.writeCount += 1;
      bucket.producerStageCounts.set(stage, (bucket.producerStageCounts.get(stage) ?? 0) + 1);
      bucket.producerSourceIds.add(relation.source);
      bucket.producerLabels.add(sourceLabel);
    } else {
      bucket.readCount += 1;
      bucket.consumerStageCounts.set(stage, (bucket.consumerStageCounts.get(stage) ?? 0) + 1);
      bucket.consumerSourceIds.add(relation.source);
      bucket.consumerLabels.add(sourceLabel);
    }

    byKey.set(key, bucket);
  }

  return [...byKey.entries()]
    .map(([key, bucket]) => {
      const producerStageIds = sortStagesByWeight(bucket.producerStageCounts);
      const consumerStageIds = sortStagesByWeight(bucket.consumerStageCounts);
      if (producerStageIds.length === 0 && consumerStageIds.length === 0) return null;

      const category = detectArtifactCategory(bucket.originalLabel, [...bucket.paths]);
      const differentConsumers = consumerStageIds.filter((stageId) => !producerStageIds.includes(stageId));
      const kind: ArtifactFlowGroup["kind"] =
        producerStageIds.length === 0
          ? "input"
          : differentConsumers.length > 0
            ? "handoff"
            : "output";

      const score =
        bucket.readCount +
        bucket.writeCount * 2 +
        differentConsumers.length * 5 +
        bucket.paths.size +
        (kind === "input" ? 4 : 0) +
        (category === "arrival" ? 4 : 0) +
        (category === "json" || category === "binary" ? 3 : 0);

      return {
        key,
        label: artifactDisplayLabel(bucket.originalLabel, [...bucket.paths]),
        paths: [...bucket.paths].sort((a, b) => a.localeCompare(b)),
        artifactIds: [...bucket.artifactIds].sort((a, b) => a.localeCompare(b)),
        producerStageIds,
        consumerStageIds,
        producerSourceIds: [...bucket.producerSourceIds].sort((a, b) => a.localeCompare(b)),
        consumerSourceIds: [...bucket.consumerSourceIds].sort((a, b) => a.localeCompare(b)),
        producerLabels: [...bucket.producerLabels].sort((a, b) => a.localeCompare(b)),
        consumerLabels: [...bucket.consumerLabels].sort((a, b) => a.localeCompare(b)),
        relationCount: bucket.readCount + bucket.writeCount,
        readCount: bucket.readCount,
        writeCount: bucket.writeCount,
        category,
        kind,
        score,
      } satisfies ArtifactFlowGroup;
    })
    .filter((group): group is ArtifactFlowGroup => Boolean(group))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function selectArtifactFlowGroupsForLayer(flowGroups: ArtifactFlowGroup[]): ArtifactFlowGroup[] {
  const selected: ArtifactFlowGroup[] = [];
  const selectedKeys = new Set<string>();

  const take = (groups: ArtifactFlowGroup[], limit: number) => {
    for (const group of groups) {
      if (selected.length >= 18) break;
      if (selectedKeys.has(group.key)) continue;
      selected.push(group);
      selectedKeys.add(group.key);
      if (selected.filter((candidate) => groups.includes(candidate)).length >= limit) break;
    }
  };

  take(
    flowGroups
      .filter((group) => group.kind === "input")
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)),
    4,
  );

  for (const stage of STAGES) {
    if (stage.id === "inputs") continue;
    const limit =
      stage.id === "extract" ? 4 :
      stage.id === "distribution" ? 4 :
      stage.id === "simulation" ? 3 :
      2;

    take(
      flowGroups
        .filter((group) =>
          dominantStage(group.producerStageIds) === stage.id &&
          (group.kind === "handoff" || stage.id === "distribution" || stage.id === "simulation"),
        )
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)),
      limit,
    );
  }

  take(
    flowGroups
      .filter((group) => group.kind === "output")
      .sort((a, b) =>
        outputSelectionPriority(b) - outputSelectionPriority(a) ||
        b.score - a.score ||
        a.label.localeCompare(b.label),
      ),
    4,
  );

  return selected.sort((a, b) => compareFlowLayoutOrder(a, b) || a.label.localeCompare(b.label));
}

function selectArtifactFlowGroupsForStageOverlay(flowGroups: ArtifactFlowGroup[]): ArtifactFlowGroup[] {
  const selected: ArtifactFlowGroup[] = [];
  const selectedKeys = new Set<string>();

  const take = (stage: StageId, limit: number) => {
    for (const group of flowGroups
      .filter((candidate) => dominantStage(candidate.producerStageIds) === stage)
      .sort((a, b) =>
        stageArtifactPriority(stage, b) - stageArtifactPriority(stage, a) ||
        b.score - a.score ||
        a.label.localeCompare(b.label),
      )) {
      if (selectedKeys.has(group.key)) continue;
      selected.push(group);
      selectedKeys.add(group.key);
      if (selected.filter((candidate) => dominantStage(candidate.producerStageIds) === stage).length >= limit) {
        break;
      }
    }
  };

  take("extract", 4);
  take("transform", 2);
  take("match", 2);
  take("distribution", 4);
  take("simulation", 4);

  return selected.sort((a, b) => compareFlowLayoutOrder(a, b) || a.label.localeCompare(b.label));
}

function buildInputConnectorNode(ctx: Context, stageNodeRefs: string[]): ProcessNodeConfig | null {
  const connectorSymbols = stageNodeRefs
    .map((nodeRef) => ctx.symbolById.get(nodeRef))
    .filter((symbol): symbol is Symbol => Boolean(symbol))
    .filter((symbol) => /\bconnector\b|\bmes\b|\bdruid\b|\bapi\b|\bsql\b/.test(normalize(symbol.label)));

  const preferred = connectorSymbols.filter((symbol) => symbol.kind === "class");
  const labels = unique((preferred.length > 0 ? preferred : connectorSymbols).map((symbol) => symbol.label))
    .sort((a, b) => a.localeCompare(b));

  if (labels.length === 0) return null;

  return {
    id: "proc:src:connector-access",
    label: summarizeTitle(labels, "Connector Access"),
    umlType: "component",
    stereotype: "<<component>>",
    preview: [`Modules: ${summarizeList(labels, 3)}`],
    position: { x: 0, y: 0, width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT },
  };
}

function flowGroupToNode(group: ArtifactFlowGroup): ProcessNodeConfig {
  return {
    id: flowNodeId(group),
    label: group.label,
    umlType: "artifact",
    stereotype: "<<artifact>>",
    preview: buildFlowPreview(group),
    position: { x: 0, y: 0, width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT },
  };
}

function buildFlowPreview(group: ArtifactFlowGroup): string[] {
  return buildStructuredArtifactPreview([group], {
    mode: "single",
    stage: dominantStage(group.producerStageIds) ?? undefined,
    flow: buildFlowLine(group),
  }) ?? [];
}

function buildDetailedArtifactPreview(
  groups: ArtifactFlowGroup[],
  stage?: StageId,
): string[] | undefined {
  return buildStructuredArtifactPreview(groups, {
    mode: "cluster",
    stage,
  });
}

function buildStructuredArtifactPreview(
  groups: ArtifactFlowGroup[],
  options: {
    mode: ArtifactPreviewMode;
    stage?: StageId;
    flow?: string;
  },
): string[] | undefined {
  if (groups.length === 0) return undefined;

  const sortedGroups = [...groups].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const primaryCategory = sortedGroups[0]?.category;
  const primaryKind = sortedGroups[0]?.kind;
  const meta: ArtifactPreviewMetaPayload = {
    kind: "artifact-preview",
    mode: options.mode,
    stageId: options.stage,
    stageLabel: options.stage ? stageTitle(options.stage) : undefined,
    flow: options.flow,
    category: primaryCategory,
    groupKind: primaryKind,
    groupCount: sortedGroups.length,
    pathCount: sortedGroups.reduce((sum, group) => sum + group.paths.length, 0),
  };

  return [
    encodeArtifactPreviewLine("preview", meta),
    ...sortedGroups.map((group) =>
      encodeArtifactPreviewLine("item", buildArtifactPreviewItem(group)),
    ),
  ];
}

function buildArtifactPreviewFromItems(
  meta: ArtifactPreviewMetaPayload,
  items: ArtifactPreviewItemPayload[],
): string[] | undefined {
  if (items.length === 0) return undefined;
  return [
    encodeArtifactPreviewLine("preview", meta),
    ...items.map((item) => encodeArtifactPreviewLine("item", item)),
  ];
}

function buildImportClusterPreview(
  stage: StageId,
  entries: Array<{
    symbol: Symbol;
    importerIds: Set<string>;
    importerLabels: Set<string>;
    count: number;
  }>,
): string[] {
  const meta: ArtifactPreviewMetaPayload = {
    kind: "artifact-preview",
    mode: "cluster",
    stageId: stage,
    stageLabel: stageTitle(stage),
    category: "libraries-imports",
    groupKind: "input",
    groupCount: entries.length,
    pathCount: entries.length,
  };

  return buildArtifactPreviewFromItems(
    meta,
    entries.map((entry) => ({
      label: entry.symbol.label,
      paths: [entry.symbol.label],
      artifactIds: [entry.symbol.id],
      writeCount: 0,
      readCount: entry.count,
      producerIds: [...entry.importerIds].sort((left, right) => left.localeCompare(right)),
      consumerIds: [],
      producers: [...entry.importerLabels].sort((left, right) => left.localeCompare(right)),
      consumers: [],
      producerStages: [stage],
      consumerStages: [],
      category: "libraries-imports",
      groupKind: "input",
    })),
  ) ?? [];
}

function buildInputSymbolPreview(
  symbols: Symbol[],
  category: ArtifactCategory,
): string[] | undefined {
  const items = symbols
    .map((symbol) => ({
      label: symbol.label,
      paths: [symbol.location?.file ? shortArtifactPath(symbol.location.file) : symbol.label],
      artifactIds: [symbol.id],
      writeCount: 0,
      readCount: 1,
      producerIds: [],
      consumerIds: [],
      producers: [],
      consumers: [stageTitle("inputs")],
      producerStages: [],
      consumerStages: ["inputs"] satisfies StageId[],
      category,
      groupKind: "input" as const,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return buildArtifactPreviewFromItems(
    {
      kind: "artifact-preview",
      mode: "cluster",
      stageId: "inputs",
      stageLabel: stageTitle("inputs"),
      category,
      groupKind: "input",
      groupCount: items.length,
      pathCount: items.reduce((sum, item) => sum + Math.max(1, item.paths.length), 0),
    },
    items,
  );
}

function buildArtifactPreviewItem(group: ArtifactFlowGroup): ArtifactPreviewItemPayload {
  return {
    label: group.label,
    paths: unique(group.paths.map(shortArtifactPath)),
    artifactIds: unique(group.artifactIds),
    writeCount: group.writeCount,
    readCount: group.readCount,
    producerIds: unique(group.producerSourceIds),
    consumerIds: unique(group.consumerSourceIds),
    producers: unique(group.producerLabels),
    consumers: unique(group.consumerLabels),
    producerStages: sortUniqueStages(group.producerStageIds),
    consumerStages: sortUniqueStages(group.consumerStageIds),
    category: group.category,
    groupKind: group.kind,
  };
}

function encodeArtifactPreviewLine(
  kind: "preview" | "item",
  payload: ArtifactPreviewMetaPayload | ArtifactPreviewItemPayload,
): string {
  return `@${kind} ${JSON.stringify(payload)}`;
}

function buildFlowLine(group: ArtifactFlowGroup): string {
  const producer = dominantStage(group.producerStageIds);
  const consumer = dominantStage(crossStageConsumers(group)) ?? dominantStage(group.consumerStageIds);
  if (!producer && consumer) {
    return `Feeds: ${stageTitle("inputs")}`;
  }
  if (producer && consumer && producer === consumer) {
    return `Created in: ${stageTitle(producer)}`;
  }
  if (producer && consumer) {
    return `Flow: ${stageTitle(producer)} -> ${stageTitle(consumer)}`;
  }
  if (producer) {
    return `Created in: ${stageTitle(producer)}`;
  }
  return `Linked artefact`;
}

function positionInputNodes(nodes: ProcessNodeConfig[]): ProcessNodeConfig[] {
  if (nodes.length === 0) return [];
  const inputStage = stageDef("inputs");
  return positionHorizontalBandNodes(
    nodes,
    inputStage.x + Math.round(inputStage.width / 2),
    SIDE_NODE_TOP_Y,
    3,
  );
}

function positionStageSideNodes(stage: StageDef, nodes: ProcessNodeConfig[]): ProcessNodeConfig[] {
  if (nodes.length === 0) return [];
  const side = stageSide(stage.id);
  const x = side === "left"
    ? stage.x - FLOW_SIDE_GAP
    : stage.x + stage.width + 110;
  const baseY = stage.y - Math.floor((nodes.length - 1) * FLOW_VERTICAL_GAP / 2);

  return nodes.map((node, index) => ({
    ...node,
    position: {
      x,
      y: baseY + index * FLOW_VERTICAL_GAP,
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT,
    },
  }));
}

function positionOutputNodes(nodes: ProcessNodeConfig[]): ProcessNodeConfig[] {
  if (nodes.length === 0) return [];
  const outputsStage = stageDef("simulation");
  return positionHorizontalBandNodes(
    nodes,
    outputsStage.x + Math.round(outputsStage.width / 2),
    outputsStage.y + outputsStage.height + SIDE_NODE_BOTTOM_OFFSET,
    4,
  );
}

function positionHorizontalBandNodes(
  nodes: ProcessNodeConfig[],
  centerX: number,
  startY: number,
  maxColumns: number,
): ProcessNodeConfig[] {
  const columns = Math.max(1, Math.min(maxColumns, nodes.length));
  const startX =
    centerX -
    Math.round(((columns - 1) * SIDE_NODE_GAP_X) / 2) -
    Math.round(SIDE_NODE_ESTIMATED_WIDTH / 2);

  return nodes.map((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...node,
      position: {
        x: startX + column * SIDE_NODE_GAP_X,
        y: startY + row * SIDE_NODE_GAP_Y,
        width: node.position.width ?? FLOW_NODE_WIDTH,
        height: node.position.height ?? FLOW_NODE_HEIGHT,
      },
    };
  });
}

function resolveStageForSymbolId(symbolId: string, ctx: Context): StageId | null {
  const chain = ctx.ancestorsById.get(symbolId) ?? [symbolId];
  for (const candidateId of chain) {
    const symbol = ctx.symbolById.get(candidateId);
    if (!symbol) continue;
    const assignedStage = mapSymbolToStage(symbol, ctx);
    if (assignedStage) return assignedStage;
  }

  const symbol = ctx.symbolById.get(symbolId);
  if (!symbol) return null;
  return chooseBestStageFromText(
    normalize(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`),
  ) ?? null;
}

function isLayerOneArtifactCandidate(symbol: Symbol): boolean {
  if (symbol.kind !== "external") return false;
  if (symbol.id.startsWith("proc:") || symbol.id.startsWith("stub:")) return false;
  return looksLikeConcreteArtifact(symbol.label);
}

function looksLikeConcreteArtifact(label: string): boolean {
  const canonical = canonicalArtifactLabel(label.trim());
  const basename = basenameOf(canonical);
  if (/^\{[^}]+\}$/.test(basename)) return false;
  return /[\\/]/.test(canonical) || /\.(csv|xlsx|xls|json|pkl|pickle|parquet)$/i.test(canonical);
}

function artifactFamilyKey(label: string): string {
  return basenameOf(canonicalArtifactLabel(label)).toLowerCase();
}

function artifactDisplayLabel(primaryLabel: string, paths: string[]): string {
  const basenames = unique(paths.map((path) => basenameOf(canonicalArtifactLabel(path))));
  if (basenames.length === 1) return basenames[0];
  return basenameOf(canonicalArtifactLabel(primaryLabel));
}

function processArtifactDisplayLabel(canonicalLabel: string): string {
  return basenameOf(canonicalLabel);
}

function detectArtifactCategory(
  originalLabel: string,
  paths: string[],
): ArtifactFlowGroup["category"] {
  const text = normalize(`${originalLabel} ${paths.join(" ")}`);
  if (/\barrival\b/.test(text)) return "arrival";
  if (/\bjson\b/.test(text)) return "json";
  if (/\bpkl\b|\bpickle\b|\bkde\b/.test(text)) return "binary";
  if (/\bcsv\b|\bxlsx\b|\bxls\b|\btable\b|\bdf\b/.test(text)) return "tabular";
  if (/\binput\b|\barchive\b|\broute\b|\bcluster\b|\bmaterial\b/.test(text)) return "source";
  return "artifact";
}

function groupBy<TItem, TKey>(values: TItem[], keyFn: (value: TItem) => TKey): Map<TKey, TItem[]> {
  const grouped = new Map<TKey, TItem[]>();
  for (const value of values) {
    const key = keyFn(value);
    const bucket = grouped.get(key) ?? [];
    bucket.push(value);
    grouped.set(key, bucket);
  }
  return grouped;
}

function artifactClusterFamilyKey(group: ArtifactFlowGroup): string | null {
  const basename = basenameOf(group.paths[0] ?? group.label)
    .toLowerCase()
    .replace(/\.(csv|xlsx|xls|json|pkl|pickle|parquet)$/i, "");
  const tokens = basename.split(/[_-]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const significantTokens = tokens.filter((token) => !/^\d+$/.test(token));
  if (significantTokens.length === 0) return null;
  if (significantTokens[0] === "arrival") return "arrival";
  if (significantTokens.length === 1) return significantTokens[0];
  return `${significantTokens[0]}_${significantTokens[1]}`;
}

function preferredArtifactClusterFamily(groups: ArtifactFlowGroup[]): string | null {
  const familyCounts = new Map<string, number>();
  for (const group of groups) {
    const familyKey = artifactClusterFamilyKey(group);
    if (!familyKey) continue;
    familyCounts.set(familyKey, (familyCounts.get(familyKey) ?? 0) + 1);
  }

  const ranked = [...familyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [familyKey, count] = ranked[0] ?? [];
  if (!familyKey || !count) return null;
  return count >= 3 && count / groups.length >= 0.6 ? familyKey : null;
}

function humanizeArtifactFamily(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => (part === "df" ? "DF" : part))
    .join(" ");
}

function artifactCategoryTitle(category: ArtifactCategory): string {
  switch (category) {
    case "libraries-imports":
      return "Libraries / Imports";
    case "json":
      return "JSON Artifacts";
    case "binary":
      return "Binary Artifacts";
    case "tabular":
      return "Tabular Artifacts";
    case "arrival":
      return "Arrival Artifacts";
    case "source":
      return "Source Artifacts";
    case "artifact":
      return "Artifacts";
  }
}

function shortStageTitle(stage: StageId): string {
  switch (stage) {
    case "inputs":
      return "Inputs";
    case "extract":
      return "Extraction";
    case "transform":
      return "Transformation";
    case "match":
      return "Matching";
    case "distribution":
      return "Distribution";
    case "simulation":
      return "Simulation";
  }
}

function sortUniqueStages(stageIds: StageId[]): StageId[] {
  return [...new Set(stageIds)].sort((a, b) => compareStageOrder(a, b));
}

function sortStagesByWeight(weights: Map<StageId, number>): StageId[] {
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || compareStageOrder(a[0], b[0]))
    .map(([stage]) => stage);
}

function stageSide(stage: StageId): "left" | "right" {
  switch (stage) {
    case "extract":
    case "match":
    case "simulation":
      return "left";
    case "transform":
    case "distribution":
    case "inputs":
      return "right";
  }
}

function compareFlowLayoutOrder(a: ArtifactFlowGroup, b: ArtifactFlowGroup): number {
  const kindPriority = (group: ArtifactFlowGroup) => {
    switch (group.kind) {
      case "input":
        return 1;
      case "handoff":
        return 2;
      case "output":
        return 3;
    }
  };

  const aStage = dominantStage(a.producerStageIds) ?? dominantStage(a.consumerStageIds) ?? "inputs";
  const bStage = dominantStage(b.producerStageIds) ?? dominantStage(b.consumerStageIds) ?? "inputs";
  return kindPriority(a) - kindPriority(b) || compareStageOrder(aStage, bStage) || b.score - a.score;
}

function compareStageOrder(a: StageId, b: StageId): number {
  return tieBreak(a, b);
}

function dominantStage(stageIds: StageId[]): StageId | null {
  return stageIds[0] ?? null;
}

function crossStageConsumers(group: ArtifactFlowGroup): StageId[] {
  return group.consumerStageIds.filter((stageId) => !group.producerStageIds.includes(stageId));
}

function flowNodeId(group: ArtifactFlowGroup): string {
  return `proc:artifact:${slugify(group.key)}`;
}

export function describeProcessArtifact(rawLabel: string): ProcessArtifactDescriptor {
  const canonical = canonicalArtifactLabel(rawLabel);
  const key = artifactFamilyKey(canonical);
  return {
    id: `proc:artifact:${slugify(key)}`,
    label: processArtifactDisplayLabel(canonical),
    preview: [`Path: ${shortArtifactPath(canonical)}`],
  };
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function basenameOf(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? value;
}

function shortArtifactPath(value: string): string {
  const normalized = canonicalArtifactLabel(value).replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.slice(-2).join("/");
}

function canonicalArtifactLabel(value: string): string {
  const trimmed = value.trim();
  const basename = basenameOf(trimmed);
  const normalized = normalize(basename);
  for (const rule of KNOWN_ARTIFACT_LABELS) {
    if (rule.pattern.test(normalized)) {
      if (trimmed === basename) {
        return rule.label;
      }
      return trimmed.replace(new RegExp(`${escapeRegExp(basename)}$`), rule.label);
    }
  }
  return trimmed;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function summarizeList(values: string[], maxItems: number): string {
  if (values.length === 0) return "";
  if (values.length <= maxItems) return values.join(", ");
  return `${values.slice(0, maxItems).join(", ")}, +${values.length - maxItems} more`;
}

function summarizeArtifactEdgeLabel(
  groups: ArtifactFlowGroup[],
  fallbackVerb: string,
  groupCount: number,
): string {
  if (groupCount <= 1 || groups.length === 0) {
    return fallbackVerb;
  }

  const labels = unique(groups.map((group) => group.label));
  if (labels.length === 0) {
    return fallbackVerb;
  }

  return `${fallbackVerb}: ${summarizeList(labels, 2)}`;
}

function summarizeTitle(values: string[], fallback: string): string {
  if (values.length === 0) return fallback;
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} / ${values[1]}`;
  return `${values[0]} / ${values[1]} +${values.length - 2}`;
}

function stageTitle(stage: StageId): string {
  return stageDef(stage).label;
}

function flowWriteLabel(group: ArtifactFlowGroup): string {
  return flowWriteLabelForCategory(group.category);
}

function flowWriteLabelForCategory(category: ArtifactCategory): string {
  switch (category) {
    case "json":
    case "binary":
      return "persists";
    case "arrival":
      return "creates";
    default:
      return "writes";
  }
}

function flowReadLabel(group: ArtifactFlowGroup, stage: StageId): string {
  return flowReadLabelForCategory(group.category, stage);
}

function flowReadLabelForCategory(category: ArtifactCategory, stage: StageId): string {
  if (category === "json" || category === "binary") return "loads";
  if (stage === "simulation") return "consumes";
  return "reads";
}

function stageArtifactPriority(stage: StageId, group: ArtifactFlowGroup): number {
  const text = normalize(`${group.label} ${group.paths.join(" ")}`);
  let priority = group.score;

  if (group.category === "arrival") priority += 80;
  if (group.category === "json" || group.category === "binary") priority += 60;
  if (looksLikeConcreteArtifact(group.label)) priority += 20;
  if (group.kind === "handoff") priority += 36;
  if (crossStageConsumers(group).length > 0) priority += crossStageConsumers(group).length * 20;
  if (group.readCount > 0) priority += 12;
  if (group.writeCount > 0) priority += 8;

  switch (stage) {
    case "extract":
      if (group.category === "tabular") priority += 70;
      if (group.kind === "handoff") priority += 30;
      break;
    case "transform":
      if (group.category === "json") priority += 60;
      if (group.kind === "output") priority += 12;
      break;
    case "match":
      if (group.kind === "handoff") priority += 24;
      break;
    case "distribution":
      if (group.category === "json" || group.category === "binary") priority += 90;
      if (group.kind === "output") priority += 28;
      break;
    case "simulation":
      if (group.category === "arrival") priority += 90;
      if (group.category === "tabular") priority += 48;
      if (group.kind === "output") priority += 24;
      break;
    case "inputs":
      break;
  }

  if (isSimulationResultGroup(group) && stage === "simulation") {
    priority += 40;
  }
  if (isVisualArtifactGroup(group)) {
    priority += 18;
  }
  if (text.includes("fallback")) {
    priority -= 8;
  }

  return priority;
}

function stageArtifactLimit(stage: StageId): number {
  switch (stage) {
    case "extract":
      return 5;
    case "distribution":
      return 5;
    case "simulation":
      return 4;
    case "inputs":
      return 0;
    case "transform":
    case "match":
      return 3;
  }
}

function stageArtifactItemPriority(stage: StageId, item: LayerOneStageArtifactItem): number {
  const text = normalize(`${item.node.label} ${(item.node.preview ?? []).join(" ")}`);
  let priority = item.score + (item.groupKeys.length >= MIN_STAGE_CLUSTER_BUCKET_SIZE ? 35 : 0);

  if (item.category === "arrival") priority += 40;
  if (item.category === "json" || item.category === "binary") priority += 20;

  if (stage === "extract" && item.category === "tabular") priority += 30;
  if (stage === "distribution" && (item.category === "json" || item.category === "binary")) priority += 40;
  if (stage === "simulation" && text.includes("arrival")) priority += 50;

  return priority;
}

function outputSelectionPriority(group: ArtifactFlowGroup): number {
  let priority = group.score;

  if (group.category === "arrival") priority += 80;
  if (group.category === "json" || group.category === "binary") priority += 45;
  if (group.category === "tabular") priority += 24;
  if (group.writeCount > 0) priority += 10;
  if (group.readCount === 0) priority += 6;
  if (isSimulationResultGroup(group)) priority += 22;
  if (isVisualArtifactGroup(group)) priority += 14;

  return priority;
}

function isSimulationResultGroup(group: ArtifactFlowGroup): boolean {
  const text = normalize(`${group.label} ${group.paths.join(" ")}`);
  return (
    /\bresult\b|\bfilter stats\b|\boutliners?\b|\bruntime\b|\breport\b/.test(text)
  );
}

function isVisualArtifactGroup(group: ArtifactFlowGroup): boolean {
  return /\bvisual\b|\bplot\b|\bchart\b|\bfigure\b|\bdashboard\b|\breport\b/.test(
    normalize(`${group.label} ${group.paths.join(" ")}`),
  );
}

function buildContext(graph: ProjectGraph): Context {
  const symbolById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const relationsBySymbolId = new Map<string, Relation[]>();
  const childrenById = new Map<string, Symbol[]>();

  for (const symbol of graph.symbols) {
    if (!symbol.parentId) continue;
    const bucket = childrenById.get(symbol.parentId) ?? [];
    bucket.push(symbol);
    childrenById.set(symbol.parentId, bucket);
  }

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
  const childTextById = new Map<string, string>();
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
    const childText = normalize(
      (childrenById.get(symbol.id) ?? [])
        .slice(0, 32)
        .map((child) => `${child.label} ${child.location?.file ?? ""}`)
        .join(" "),
    );
    const neighborText = normalize(
      (relationsBySymbolId.get(symbol.id) ?? [])
        .slice(0, 24)
        .map((relation) => {
          const otherId = relation.source === symbol.id ? relation.target : relation.source;
          const other = symbolById.get(otherId);
          return `${relation.type} ${other?.label ?? otherId} ${other?.location?.file ?? ""}`;
        })
        .join(" "),
    );

    ownTextById.set(symbol.id, ownText);
    parentTextById.set(symbol.id, parentText);
    childTextById.set(symbol.id, childText);
    neighborTextById.set(symbol.id, neighborText);
    textById.set(symbol.id, normalize(`${ownText} ${parentText} ${childText} ${neighborText}`));
  }

  return {
    symbolById,
    relationsBySymbolId,
    childrenById,
    ancestorsById,
    ownTextById,
    parentTextById,
    childTextById,
    neighborTextById,
    textById,
    classifications: new Map(),
    stageAssignments: new Map(),
  };
}

function classifySymbol(symbol: Symbol, ctx: Context): Classification | null {
  if (shouldIgnoreSymbolForArchitectureView(symbol)) return null;

  const own = ctx.ownTextById.get(symbol.id) ?? "";
  const parentText = ctx.parentTextById.get(symbol.id) ?? "";
  const childText = ctx.childTextById.get(symbol.id) ?? "";
  const neighborText = ctx.neighborTextById.get(symbol.id) ?? "";
  const fileText = normalize(symbol.location?.file ?? "");
  const scores = emptyScores();

  for (const stage of STAGES) {
    for (const rule of RULES[stage.id]) {
      if (rule.pattern.test(own)) scores[stage.id] += rule.score;
      if (rule.pattern.test(parentText)) scores[stage.id] += Math.round(rule.score * 0.55);
      if (rule.pattern.test(childText)) scores[stage.id] += Math.round(rule.score * 0.65);
      if (rule.pattern.test(neighborText)) scores[stage.id] += Math.round(rule.score * 0.35);
    }
  }

  if (fileText.includes("connector")) scores.inputs += 18;
  if (fileText.includes("extract")) scores.extract += 18;
  if (fileText.includes("arrival") || fileText.includes("is_table") || fileText.includes("is table")) {
    scores.extract += 10;
    scores.match += 14;
    scores.simulation += 6;
  }
  if (fileText.includes("arrival_table") || fileText.includes("generate_arrival_table")) {
    scores.simulation += 18;
  }
  if (fileText.includes("color_change")) {
    scores.transform += 16;
    scores.match += 8;
  }
  if (fileText.includes("filter")) scores.match += 18;
  if (fileText.includes("distribution") || fileText.includes("kde") || fileText.includes("pickle")) {
    scores.distribution += 18;
  }
  if (fileText.includes("simulation") || fileText.endsWith("model py")) {
    scores.simulation += 18;
  }
  if (fileText.includes("analyzer")) {
    scores.transform += 10;
  }

  for (const relation of ctx.relationsBySymbolId.get(symbol.id) ?? []) {
    const otherId = relation.source === symbol.id ? relation.target : relation.source;
    const otherText = ctx.textById.get(otherId) ?? normalize(otherId);

    if (relation.type === "reads" && looksLikeInputSource(otherText)) {
      scores.inputs += 10;
      scores.extract += 8;
    }
    if (relation.type === "reads" && looksLikePersistedOutput(otherText)) {
      scores.distribution += 4;
      scores.simulation += 6;
    }
    if (relation.type === "writes") {
      scores.simulation += 6;
      if (looksLikePersistedOutput(otherText)) scores.distribution += 8;
      if (looksLikeSimulationOutput(otherText)) scores.simulation += 6;
    }
    if ((relation.type === "calls" || relation.type === "imports" || relation.type === "instantiates") &&
        /\bconnector\b|\bmes\b|\bdruid\b|\bapi\b/.test(otherText)) {
      scores.inputs += 8;
    }
    if ((relation.type === "calls" || relation.type === "imports") &&
        /\btransform\b|\bnormalize\b|\bcolor\b|\bstatistics\b/.test(otherText)) {
      scores.transform += 8;
    }
    if ((relation.type === "calls" || relation.type === "imports") &&
        /\bfilter\b|\bmatch\b|\bcluster\b|\biqr\b/.test(otherText)) {
      scores.match += 8;
    }
    if ((relation.type === "calls" || relation.type === "imports") &&
        /\bdistribution\b|\bkde\b|\bpersist\b|\bpickle\b/.test(otherText)) {
      scores.distribution += 8;
    }
    if ((relation.type === "calls" || relation.type === "imports" || relation.type === "uses_config") &&
        /\bsimulation\b|\bgenerator\b|\bmodel\b/.test(otherText)) {
      scores.simulation += 8;
    }
  }

  if (symbol.kind === "module") {
    scores.inputs += 4;
    scores.extract += 4;
    scores.transform += 4;
    scores.match += 4;
    scores.distribution += 4;
    scores.simulation += 4;
  }
  if (symbol.kind === "class") {
    scores.transform += 2;
    scores.match += 2;
    scores.distribution += 2;
    scores.simulation += 2;
  }

  let primaryStage: StageId | null = null;
  let bestScore = -1;
  for (const stage of STAGES) {
    const score = scores[stage.id];
    if (score > bestScore || (score === bestScore && tieBreak(stage.id, primaryStage ?? stage.id) > 0)) {
      primaryStage = stage.id;
      bestScore = score;
    }
  }

  if (!primaryStage || bestScore < minimumPrimaryScore(symbol.kind)) {
    return null;
  }

  return { primaryStage, score: bestScore, scores };
}

function buildStageViewConfig(
  graph: ProjectGraph,
  ctx: Context,
  stage: StageDef,
  flowGroups: ArtifactFlowGroup[],
): BuiltStageView {
  const classNodeRefs = selectStageSequenceNodeRefs(graph, ctx, stage.id);
  const artifactOverlay = buildStageArtifactOverlay(stage.id, classNodeRefs, flowGroups, ctx);
  const importOverlay = buildStageImportOverlay(graph, ctx, stage.id, classNodeRefs);
  const nodeRefs = [
    ...classNodeRefs,
    ...artifactOverlay.nodeRefs,
    ...importOverlay.nodeRefs,
  ];
  return {
    views: [
      {
        id: stage.viewId,
        title: stage.label,
        scope: "group",
        diagramType: "class",
        hiddenInSidebar: false,
        nodeRefs,
        edgeRefs: [
          ...collectStageClassEdgeRefs(graph, ctx, classNodeRefs),
          ...artifactOverlay.edges.map((edge) => edge.id),
          ...importOverlay.edges.map((edge) => edge.id),
        ],
      },
    ],
    edges: [...artifactOverlay.edges, ...importOverlay.edges],
    nodes: [...artifactOverlay.nodes, ...importOverlay.nodes],
  };
}

function buildStageArtifactOverlay(
  stage: StageId,
  coreNodeRefs: string[],
  flowGroups: ArtifactFlowGroup[],
  ctx: Context,
): { nodeRefs: string[]; edges: ProcessEdgeConfig[]; nodes: ProcessNodeConfig[] } {
  if (coreNodeRefs.length === 0) {
    return { nodeRefs: [], edges: [], nodes: [] };
  }

  const visibleCore = new Set(coreNodeRefs);
  const nodeRefs: string[] = [];
  const nodeRefSet = new Set<string>();
  const nodes: ProcessNodeConfig[] = [];
  const edges: ProcessEdgeConfig[] = [];
  const edgeIdSet = new Set<string>();

  for (const group of flowGroups) {
    const isProducedInStage = group.producerStageIds.includes(stage);
    const isConsumedInStage = group.consumerStageIds.includes(stage);
    if (!isProducedInStage && !isConsumedInStage) continue;

    const artifactNodeId = flowNodeId(group);
    if (!nodeRefSet.has(artifactNodeId)) {
      nodeRefSet.add(artifactNodeId);
      nodeRefs.push(artifactNodeId);
      nodes.push(flowGroupToNode(group));
    }

    if (isProducedInStage) {
      const writerRefs = unique(
        group.producerSourceIds
          .map((sourceId) => findNearestVisible(sourceId, visibleCore, ctx.ancestorsById))
          .filter((sourceId): sourceId is string => Boolean(sourceId)),
      );

      for (const writerRef of writerRefs) {
        const edgeId = `stage-flow:${slugify(writerRef)}:${slugify(artifactNodeId)}:write`;
        if (edgeIdSet.has(edgeId)) continue;
        edgeIdSet.add(edgeId);
        edges.push({
          id: edgeId,
          source: writerRef,
          target: artifactNodeId,
          type: "writes",
          label: flowWriteLabel(group),
        });
      }
    }

    if (isConsumedInStage) {
      const consumerRefs = unique(
        group.consumerSourceIds
          .map((sourceId) => findNearestVisible(sourceId, visibleCore, ctx.ancestorsById))
          .filter((sourceId): sourceId is string => Boolean(sourceId)),
      );

      for (const consumerRef of consumerRefs) {
        const edgeId = `stage-flow:${slugify(artifactNodeId)}:${slugify(consumerRef)}:read`;
        if (edgeIdSet.has(edgeId)) continue;
        edgeIdSet.add(edgeId);
        edges.push({
          id: edgeId,
          source: artifactNodeId,
          target: consumerRef,
          type: "reads",
          label: flowReadLabel(group, stage),
        });
      }
    }
  }

  return { nodeRefs, edges, nodes };
}

function buildStageImportOverlay(
  graph: ProjectGraph,
  ctx: Context,
  stage: StageId,
  coreNodeRefs: string[],
): { nodeRefs: string[]; edges: ProcessEdgeConfig[]; nodes: ProcessNodeConfig[] } {
  if (coreNodeRefs.length === 0) {
    return { nodeRefs: [], edges: [], nodes: [] };
  }

  const visibleCore = new Set(coreNodeRefs);
  const importsByTarget = new Map<string, {
    symbol: Symbol;
    importerIds: Set<string>;
    importerLabels: Set<string>;
    count: number;
  }>();

  for (const relation of graph.relations) {
    if (relation.type !== "imports") continue;

    const sourceSymbol = ctx.symbolById.get(relation.source);
    const targetSymbol = ctx.symbolById.get(relation.target);
    if (!sourceSymbol || !targetSymbol) continue;
    if (sourceSymbol.id.startsWith("proc:") || targetSymbol.id.startsWith("proc:")) continue;
    if (mapSymbolToStage(sourceSymbol, ctx) !== stage) continue;
    if (mapSymbolToStage(targetSymbol, ctx) === stage && visibleCore.has(targetSymbol.id)) continue;

    const importerId = resolveVisibleImportAnchorId(graph, ctx, relation.source, visibleCore);
    if (!importerId) continue;

    const importerSymbol = ctx.symbolById.get(importerId);
    const entry = importsByTarget.get(targetSymbol.id) ?? {
      symbol: targetSymbol,
      importerIds: new Set<string>(),
      importerLabels: new Set<string>(),
      count: 0,
    };
    entry.importerIds.add(importerId);
    if (importerSymbol) {
      entry.importerLabels.add(importerSymbol.label);
    }
    entry.count += 1;
    importsByTarget.set(targetSymbol.id, entry);
  }

  const importEntries = [...importsByTarget.values()]
    .sort((left, right) => left.symbol.label.localeCompare(right.symbol.label));
  if (importEntries.length === 0) {
    return { nodeRefs: [], edges: [], nodes: [] };
  }

  const clusterNodeId = `proc:import-cluster:${stage}`;
  const node: ProcessNodeConfig = {
    id: clusterNodeId,
    label: `Libraries / Imports (${importEntries.length})`,
    umlType: "package",
    stereotype: "<<package>>",
    preview: buildImportClusterPreview(stage, importEntries),
    position: { x: 0, y: 0, width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT },
  };

  const edgeCountsByImporter = new Map<string, number>();
  for (const entry of importEntries) {
    for (const importerId of entry.importerIds) {
      edgeCountsByImporter.set(importerId, (edgeCountsByImporter.get(importerId) ?? 0) + 1);
    }
  }

  const edges = [...edgeCountsByImporter.entries()].map(([importerId, count]) => ({
    id: `stage-import:${stage}:${slugify(importerId)}`,
    source: importerId,
    target: clusterNodeId,
    type: "imports" as const,
    label: count > 1 ? `${count} imports` : "imports",
  }));

  return {
    nodeRefs: [clusterNodeId],
    edges,
    nodes: [node],
  };
}

function buildViewAdjustments(graph: ProjectGraph, ctx: Context): ProcessViewAdjustment[] {
  const ownerSymbolByViewId = new Map<string, Symbol>();
  for (const symbol of graph.symbols) {
    if (!symbol.childViewId) continue;
    const existing = ownerSymbolByViewId.get(symbol.childViewId);
    if (!existing || compareViewOwnerPriority(symbol, existing) > 0) {
      ownerSymbolByViewId.set(symbol.childViewId, symbol);
    }
  }

  const visibleViewIds = new Set<string>();
  const stageByViewId = new Map<string, StageId>();

  for (const view of graph.views) {
    if (view.id === VIEW_ID || view.id.startsWith(STAGE_VIEW_PREFIX)) continue;

    const owner = ownerSymbolByViewId.get(view.id);
    const viewText = normalize(`${view.id} ${view.title} ${owner?.label ?? ""} ${owner?.location?.file ?? ""}`);
    const stage = owner ? mapSymbolToStage(owner, ctx) : chooseBestStageFromText(viewText);
    if (stage) {
      stageByViewId.set(view.id, stage);
    }

    if (shouldShowViewInSidebar(view, owner, viewText, ctx)) {
      visibleViewIds.add(view.id);
    }
  }

  return graph.views
    .filter((view) => view.id !== VIEW_ID && !view.id.startsWith(STAGE_VIEW_PREFIX))
    .map((view) => {
      const owner = ownerSymbolByViewId.get(view.id);
      const visible = visibleViewIds.has(view.id);
      if (!visible) {
        return {
          id: view.id,
          hiddenInSidebar: true,
        };
      }

      const visibleAncestorViewId = owner
        ? findVisibleAncestorViewId(owner, visibleViewIds, ctx.symbolById)
        : undefined;
      const stage = stageByViewId.get(view.id);

      return {
        id: view.id,
        parentViewId: visibleAncestorViewId ?? (stage ? stageDef(stage).viewId : view.parentViewId ?? null),
        hiddenInSidebar: false,
      };
    });
}

function selectStageClassNodeRefs(graph: ProjectGraph, ctx: Context, stage: StageId): string[] {
  const candidates: RankedStageNode[] = [];

  for (const symbol of graph.symbols) {
    if (!isStageClassNodeCandidate(symbol)) continue;
    if (looksLikeUtilityOnly(ctx.ownTextById.get(symbol.id) ?? "")) continue;

    const assignedStage = mapSymbolToStage(symbol, ctx);
    if (assignedStage !== stage) continue;

    const classification = ctx.classifications.get(symbol.id);
    const stageScore = classification?.scores[stage] ?? scoreByTerms(
      `${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`,
      viewTerms(stage),
    );
    const threshold = minimumStageScore(stage, symbol.kind);
    if (stageScore < threshold) continue;

    let rank = stageScore;
    if (classification?.primaryStage === stage) rank += 10;
    if (symbol.kind === "class") rank += 16;
    if (symbol.childViewId) rank += 4;

    candidates.push({ symbol, stageScore, rank });
  }

  candidates.sort((a, b) =>
    b.rank - a.rank ||
    b.stageScore - a.stageScore ||
    a.symbol.label.localeCompare(b.symbol.label),
  );

  const candidateIds = new Set(candidates.map((candidate) => candidate.symbol.id));

  const selected: string[] = [];
  const selectedSet = new Set<string>();

  for (const candidate of candidates) {
    if (selected.length >= maxStageNodeCount(stage)) break;

    if (shouldSkipSymbolInStageClassView(candidate.symbol, candidateIds, selectedSet, ctx)) {
      continue;
    }

    selected.push(candidate.symbol.id);
    selectedSet.add(candidate.symbol.id);
  }

  if (selected.length > 0) {
    return expandStageClassNodeRefsForDiagram(graph, ctx, stage, selected);
  }

  return expandStageClassNodeRefsForDiagram(
    graph,
    ctx,
    stage,
    fallbackStageClassNodesByTerms(graph, ctx, stage),
  );
}

function selectStageSequenceNodeRefs(graph: ProjectGraph, ctx: Context, stage: StageId): string[] {
  const candidates: RankedStageNode[] = [];

  for (const symbol of graph.symbols) {
    if (!isStageViewNodeCandidate(symbol)) continue;
    if (looksLikeUtilityOnly(ctx.ownTextById.get(symbol.id) ?? "")) continue;

    const assignedStage = mapSymbolToStage(symbol, ctx);
    if (assignedStage !== stage) continue;

    const classification = ctx.classifications.get(symbol.id);
    const stageScore = classification?.scores[stage] ?? scoreByTerms(
      `${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`,
      viewTerms(stage),
    );
    const threshold = minimumStageScore(stage, symbol.kind);
    if (stageScore < threshold) continue;

    let rank = stageScore;
    if (classification?.primaryStage === stage) rank += 10;
    if (symbol.kind === "class") rank += 16;
    if (symbol.kind === "module") rank += 6;
    if (symbol.childViewId) rank += 4;

    candidates.push({ symbol, stageScore, rank });
  }

  candidates.sort((a, b) =>
    b.rank - a.rank ||
    b.stageScore - a.stageScore ||
    a.symbol.label.localeCompare(b.symbol.label),
  );

  const candidateIds = new Set(candidates.map((candidate) => candidate.symbol.id));

  const selected: string[] = [];
  const selectedSet = new Set<string>();

  for (const candidate of candidates) {
    if (selected.length >= maxStageNodeCount(stage)) break;

    if (shouldSkipSymbolInStageClassView(candidate.symbol, candidateIds, selectedSet, ctx)) {
      continue;
    }

    selected.push(candidate.symbol.id);
    selectedSet.add(candidate.symbol.id);
  }

  if (selected.length > 0) {
    return expandStageSequenceNodeRefsForDiagram(graph, ctx, stage, selected);
  }

  return expandStageSequenceNodeRefsForDiagram(
    graph,
    ctx,
    stage,
    fallbackStageNodesByTerms(graph, ctx, stage),
  );
}

function fallbackStageClassNodesByTerms(graph: ProjectGraph, ctx: Context, stage: StageId): string[] {
  const terms = viewTerms(stage);
  const entries = graph.symbols
    .filter((symbol) =>
      isStageClassNodeCandidate(symbol) &&
      !looksLikeUtilityOnly(ctx.ownTextById.get(symbol.id) ?? "") &&
      mapSymbolToStage(symbol, ctx) === stage,
    )
    .map((symbol) => ({
      symbol,
      score: scoreByTerms(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
    .slice(0, maxStageNodeCount(stage));

  const candidateIds = new Set(entries.map((entry) => entry.symbol.id));
  const selectedSet = new Set<string>();
  const selected: string[] = [];

  for (const entry of entries) {
    if (shouldSkipSymbolInStageClassView(entry.symbol, candidateIds, selectedSet, ctx)) {
      continue;
    }
    selected.push(entry.symbol.id);
    selectedSet.add(entry.symbol.id);
  }

  return selected;
}

function fallbackStageNodesByTerms(graph: ProjectGraph, ctx: Context, stage: StageId): string[] {
  const terms = viewTerms(stage);
  const entries = graph.symbols
    .filter((symbol) =>
      isStageViewNodeCandidate(symbol) &&
      !looksLikeUtilityOnly(ctx.ownTextById.get(symbol.id) ?? "") &&
      mapSymbolToStage(symbol, ctx) === stage,
    )
    .map((symbol) => ({
      symbol,
      score: scoreByTerms(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
    .slice(0, maxStageNodeCount(stage));

  const candidateIds = new Set(entries.map((entry) => entry.symbol.id));
  const selectedSet = new Set<string>();
  const selected: string[] = [];

  for (const entry of entries) {
    if (shouldSkipSymbolInStageClassView(entry.symbol, candidateIds, selectedSet, ctx)) {
      continue;
    }
    selected.push(entry.symbol.id);
    selectedSet.add(entry.symbol.id);
  }

  return selected;
}

function shouldSkipSymbolInStageClassView(
  symbol: Symbol,
  candidateIds: Set<string>,
  selectedSet: Set<string>,
  ctx: Context,
): boolean {
  if (symbol.kind === "module") {
    return hasCandidateClassChild(symbol.id, candidateIds, ctx);
  }

  if (symbol.kind === "class") {
    const parentId = symbol.parentId;
    if (!parentId) return false;
    const parent = ctx.symbolById.get(parentId);
    return parent?.kind === "class" && selectedSet.has(parentId);
  }

  return false;
}

function hasCandidateClassChild(
  symbolId: string,
  candidateIds: Set<string>,
  ctx: Context,
): boolean {
  return (ctx.childrenById.get(symbolId) ?? []).some((child) =>
    child.kind === "class" && candidateIds.has(child.id),
  );
}

function collectStageClassEdgeRefs(
  graph: ProjectGraph,
  ctx: Context,
  nodeRefs: string[],
): string[] {
  const structuralEdgeRefs = collectStageEdgeRefsByTypes(
    graph,
    ctx,
    nodeRefs,
    new Set<RelationType>(["inherits", "instantiates", "association", "aggregation", "composition"]),
  );

  if (structuralEdgeRefs.length > 0) {
    return structuralEdgeRefs;
  }

  return collectStageEdgeRefsByTypes(
    graph,
    ctx,
    nodeRefs,
    new Set<RelationType>(["instantiates", "imports", "uses_config"]),
  );
}

function collectStageSequenceEdgeRefs(
  graph: ProjectGraph,
  ctx: Context,
  nodeRefs: string[],
): string[] {
  return collectStageEdgeRefsByTypes(
    graph,
    ctx,
    nodeRefs,
    new Set<RelationType>(["calls", "instantiates", "reads", "writes", "uses_config"]),
  );
}

function collectStageEdgeRefsByTypes(
  graph: ProjectGraph,
  ctx: Context,
  nodeRefs: string[],
  allowedTypes: ReadonlySet<RelationType>,
): string[] {
  if (nodeRefs.length === 0) return [];

  const visible = new Set(nodeRefs);
  const edgeRefs = new Set<string>();

  for (const relation of graph.relations) {
    if (relation.type === "contains") continue;
    if (relation.id.startsWith("process-edge:") || relation.id.startsWith("stub-edge:")) continue;
    if (!allowedTypes.has(relation.type)) continue;

    const source = findNearestVisible(relation.source, visible, ctx.ancestorsById);
    const target = findNearestVisible(relation.target, visible, ctx.ancestorsById);
    if (!source || !target || source === target) continue;
    edgeRefs.add(relation.id);
  }

  return [...edgeRefs];
}

function findVisibleAncestorViewId(
  symbol: Symbol,
  visibleViewIds: Set<string>,
  symbolById: Map<string, Symbol>,
): string | undefined {
  let cursor = symbol.parentId;
  let depth = 0;
  while (cursor && depth < 32) {
    const ancestor = symbolById.get(cursor);
    if (!ancestor) break;
    if (ancestor.childViewId && visibleViewIds.has(ancestor.childViewId)) {
      return ancestor.childViewId;
    }
    cursor = ancestor.parentId;
    depth += 1;
  }
  return undefined;
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

function findNearestVisible(
  symbolId: string,
  visible: Set<string>,
  ancestorIndex: Map<string, string[]>,
): string | null {
  const chain = ancestorIndex.get(symbolId);
  if (!chain) return null;
  for (const id of chain) {
    if (visible.has(id)) return id;
  }
  return null;
}

function shouldIgnoreSymbolForArchitectureView(symbol: Symbol): boolean {
  if (symbol.tags?.includes("process-overview") || symbol.tags?.includes("external-stub")) return true;
  if (symbol.id.startsWith("proc:") || symbol.id.startsWith("stub:")) return true;
  if (symbol.kind === "external") return true;
  if (symbol.kind !== "group" && symbol.kind !== "module" && symbol.kind !== "class") return true;
  if (symbol.kind === "group" && looksLikeArtifactCategory(normalize(`${symbol.id} ${symbol.label}`))) return true;
  if (symbol.kind === "module" && /(^|[.\s])__init__$/.test(symbol.label)) return true;
  if (looksLikeSupportContainer(normalize(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`))) return true;
  return false;
}

function shouldShowViewInSidebar(
  view: DiagramView,
  owner: Symbol | undefined,
  viewText: string,
  ctx: Context,
): boolean {
  if (view.id === "view:root") return false;
  if (view.id.startsWith("view:artifacts:") || view.id.startsWith("view:art-cat:")) return false;
  if (!owner) return false;
  if (owner.kind !== "group" && owner.kind !== "module" && owner.kind !== "class") return false;
  if (owner.kind === "module" && hasDirectClassChildren(owner.id, ctx)) return false;
  if (owner.id.startsWith("grp:domain:")) return false;
  if (owner.id === "grp:dir:__root__") return false;
  if (owner.id.startsWith("grp:art")) return false;
  if (owner.id === "grp:dir:constant" || owner.id.startsWith("mod:constant.")) return false;
  if (looksLikeArtifactCategory(viewText)) return false;
  if (/\bdata pipeline\b.*\boverview\b/.test(viewText)) return false;
  return true;
}

function expandStageSequenceNodeRefsForDiagram(
  graph: ProjectGraph,
  ctx: Context,
  stage: StageId,
  selectedNodeRefs: string[],
): string[] {
  if (selectedNodeRefs.length === 0) return selectedNodeRefs;
  const maxNodes = maxStageNodeCount(stage);

  const selectedSet = new Set(selectedNodeRefs);
  const expanded: string[] = [];
  const expandedSet = new Set<string>();

  for (const nodeRef of selectedNodeRefs) {
    const symbol = ctx.symbolById.get(nodeRef);
    if (!symbol) continue;

    if (symbol.kind === "module") {
      const childClasses = graph.symbols
        .filter((candidate) =>
          candidate.parentId === symbol.id &&
          candidate.kind === "class" &&
          mapSymbolToStage(candidate, ctx) === stage &&
          !looksLikeUtilityOnly(ctx.ownTextById.get(candidate.id) ?? ""),
        )
        .sort((left, right) => left.label.localeCompare(right.label));

      if (childClasses.length > 0) {
        for (const childClass of childClasses) {
          if (expandedSet.has(childClass.id)) continue;
          expanded.push(childClass.id);
          expandedSet.add(childClass.id);
        }
        continue;
      }
    }

    if (symbol.kind === "class" && symbol.parentId && selectedSet.has(symbol.parentId)) {
      continue;
    }

    if (expandedSet.has(symbol.id)) continue;
    expanded.push(symbol.id);
    expandedSet.add(symbol.id);
  }

  if (expanded.length >= maxNodes) {
    return expanded.slice(0, maxNodes);
  }

  const relatedRelationTypes = new Set<RelationType>([
    "inherits",
    "instantiates",
    "association",
    "aggregation",
    "composition",
  ]);

  const maybeAddRelatedClass = (nodeId: string) => {
    if (expanded.length >= maxNodes || expandedSet.has(nodeId)) return;
    const symbol = ctx.symbolById.get(nodeId);
    if (!symbol || symbol.kind !== "class") return;
    if (mapSymbolToStage(symbol, ctx) !== stage) return;
    if (looksLikeUtilityOnly(ctx.ownTextById.get(symbol.id) ?? "")) return;
    expanded.push(symbol.id);
    expandedSet.add(symbol.id);
  };

  for (const relation of graph.relations) {
    if (!relatedRelationTypes.has(relation.type)) continue;

    const sourceRef = resolveStageStructuralNodeRef(relation.source, ctx);
    const targetRef = resolveStageStructuralNodeRef(relation.target, ctx);
    if (!sourceRef || !targetRef || sourceRef === targetRef) continue;

    if (expandedSet.has(sourceRef)) maybeAddRelatedClass(targetRef);
    if (expandedSet.has(targetRef)) maybeAddRelatedClass(sourceRef);
    if (expanded.length >= maxNodes) break;
  }

  return expanded.slice(0, maxNodes);
}

function resolveStageStructuralNodeRef(symbolId: string, ctx: Context): string | null {
  const chain = ctx.ancestorsById.get(symbolId);
  if (!chain) return null;

  for (const candidateId of chain) {
    const candidate = ctx.symbolById.get(candidateId);
    if (!candidate) continue;
    if (!isStageViewNodeCandidate(candidate)) continue;
    if (candidate.kind === "class" || candidate.kind === "module") {
      return candidateId;
    }
  }

  return null;
}

function resolveVisibleImportAnchorId(
  graph: ProjectGraph,
  ctx: Context,
  symbolId: string,
  visibleNodeRefs: Set<string>,
): string | null {
  if (visibleNodeRefs.has(symbolId)) return symbolId;

  const structuralRef = resolveStageStructuralNodeRef(symbolId, ctx);
  if (structuralRef && visibleNodeRefs.has(structuralRef)) {
    return structuralRef;
  }

  const sourceSymbol = ctx.symbolById.get(structuralRef ?? symbolId);
  if (sourceSymbol?.kind === "module") {
    const visibleChildren = graph.symbols
      .filter((candidate) =>
        candidate.parentId === sourceSymbol.id &&
        candidate.kind === "class" &&
        visibleNodeRefs.has(candidate.id),
      )
      .sort((left, right) => left.label.localeCompare(right.label));
    if (visibleChildren.length > 0) {
      return visibleChildren[0]?.id ?? null;
    }
  }

  const directParent = ctx.symbolById.get(symbolId)?.parentId;
  if (directParent && visibleNodeRefs.has(directParent)) {
    return directParent;
  }

  return null;
}

function expandStageClassNodeRefsForDiagram(
  graph: ProjectGraph,
  ctx: Context,
  stage: StageId,
  selectedNodeRefs: string[],
): string[] {
  if (selectedNodeRefs.length === 0) return selectedNodeRefs;

  const maxNodes = maxStageNodeCount(stage);
  const expanded: string[] = [];
  const expandedSet = new Set<string>();

  for (const nodeRef of selectedNodeRefs) {
    const symbol = ctx.symbolById.get(nodeRef);
    if (!symbol || symbol.kind !== "class") continue;
    if (expandedSet.has(symbol.id)) continue;
    expanded.push(symbol.id);
    expandedSet.add(symbol.id);
  }

  if (expanded.length >= maxNodes) {
    return expanded.slice(0, maxNodes);
  }

  const relatedRelationTypes = new Set<RelationType>([
    "inherits",
    "instantiates",
    "association",
    "aggregation",
    "composition",
  ]);

  const relationWeight = (type: RelationType): number => {
    switch (type) {
      case "composition":
        return 28;
      case "aggregation":
        return 24;
      case "association":
        return 20;
      case "inherits":
        return 18;
      case "instantiates":
        return 14;
      default:
        return 0;
    }
  };

  const candidateScores = new Map<string, number>();

  for (const relation of graph.relations) {
    if (!relatedRelationTypes.has(relation.type)) continue;

    const sourceRef = resolveStageStructuralClassNodeRef(relation.source, ctx);
    const targetRef = resolveStageStructuralClassNodeRef(relation.target, ctx);
    if (!sourceRef || !targetRef || sourceRef === targetRef) continue;

    const sourceSelected = expandedSet.has(sourceRef);
    const targetSelected = expandedSet.has(targetRef);
    if (!sourceSelected && !targetSelected) continue;

    const neighborId = sourceSelected ? targetRef : sourceRef;
    if (expandedSet.has(neighborId)) continue;

    const neighbor = ctx.symbolById.get(neighborId);
    if (!neighbor || neighbor.kind !== "class") continue;
    if (looksLikeUtilityOnly(ctx.ownTextById.get(neighbor.id) ?? "")) continue;

    let score = relationWeight(relation.type);
    if (mapSymbolToStage(neighbor, ctx) === stage) score += 24;
    const classification = ctx.classifications.get(neighbor.id);
    const stageScore = classification?.scores[stage] ?? 0;
    if (stageScore > 0) score += Math.min(stageScore, 18);
    if (classification?.primaryStage === stage) score += 10;
    if (relation.label) score += 2;

    candidateScores.set(neighbor.id, Math.max(candidateScores.get(neighbor.id) ?? 0, score));
  }

  const rankedCandidates = [...candidateScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([nodeId]) => nodeId);

  for (const nodeId of rankedCandidates) {
    if (expanded.length >= maxNodes) break;
    expanded.push(nodeId);
    expandedSet.add(nodeId);
  }

  return expanded.slice(0, maxNodes);
}

function resolveStageStructuralClassNodeRef(symbolId: string, ctx: Context): string | null {
  const chain = ctx.ancestorsById.get(symbolId);
  if (!chain) return null;

  for (const candidateId of chain) {
    const candidate = ctx.symbolById.get(candidateId);
    if (!candidate) continue;
    if (!isStageClassNodeCandidate(candidate)) continue;
    if (candidate.kind === "class") {
      return candidateId;
    }
  }

  return null;
}

function hasDirectClassChildren(symbolId: string, ctx: Context): boolean {
  return (ctx.childrenById.get(symbolId) ?? []).some((child) => child.kind === "class");
}

function isStageClassNodeCandidate(symbol: Symbol): boolean {
  if (shouldIgnoreSymbolForArchitectureView(symbol)) return false;
  return symbol.kind === "class";
}

function isStageViewNodeCandidate(symbol: Symbol): boolean {
  if (shouldIgnoreSymbolForArchitectureView(symbol)) return false;
  return symbol.kind === "module" || symbol.kind === "class";
}

function looksLikeInputSource(text: string): boolean {
  return /\bmes\b|\bdruid\b|\bsap\b|\bapi\b|\bsql\b|\bdatabase\b|\bdb\b|\bcsv\b|\bxlsx\b|\bxls\b|\bexcel\b|\binput\b/.test(text);
}

function looksLikePersistedOutput(text: string): boolean {
  return /\boutput\b|\bjson\b|\bpickle\b|\bpkl\b|\bkde\b|\btable\b|\btables\b|\bvalidation\b|\btraining\b|\bresult\b/.test(text);
}

function looksLikeSimulationOutput(text: string): boolean {
  return /\bsimulation\b|\bsim\b|\bruntime\b|\bresult\b|\bpayload\b/.test(text);
}

function looksLikeArtifactCategory(text: string): boolean {
  return /\bartifact\b|\bdata files\b|\blibraries\b|\bi o operations\b|\bother artifacts\b|\btypes models\b|\bvisualization\b/.test(text);
}

function looksLikeSupportContainer(text: string): boolean {
  return /\butilities\b|\bconstant\b|\bconfig\b/.test(text);
}

function looksLikeUtilityOnly(text: string): boolean {
  return /\butil\b|\bhelper\b|\bstatistics\b/.test(text) && !/\btransform\b|\bmatch\b|\bdistribution\b|\bsimulation\b/.test(text);
}

function minimumPrimaryScore(kind: Symbol["kind"]): number {
  if (kind === "group") return 22;
  if (kind === "class") return 18;
  return 16;
}

function minimumStageScore(stage: StageId, kind: Symbol["kind"]): number {
  const base = 12;
  return kind === "class" ? base - 1 : base;
}

function maxStageNodeCount(stage: StageId): number {
  return stage === "simulation" ? 9 : 8;
}

function resolvePreferredStage(symbol: Symbol, ctx: Context, fallbackText: string): StageId | undefined {
  const classification = ctx.classifications.get(symbol.id);
  if (classification?.primaryStage) return classification.primaryStage;

  const childStages = new Map<StageId, number>();
  for (const child of ctx.childrenById.get(symbol.id) ?? []) {
    const childClassification = ctx.classifications.get(child.id);
    const childStage = childClassification?.primaryStage;
    if (!childStage) continue;
    childStages.set(childStage, (childStages.get(childStage) ?? 0) + childClassification.score);
  }
  if (childStages.size > 0) {
    return [...childStages.entries()]
      .sort((a, b) => b[1] - a[1] || tieBreak(b[0], a[0]))
      [0]?.[0];
  }

  return chooseBestStageFromText(fallbackText);
}

function mapSymbolToStage(symbol: Symbol, ctx: Context): StageId | undefined {
  return resolveStageAssignment(symbol.id, ctx);
}

function resolveStageAssignment(symbolId: string, ctx: Context, depth = 0): StageId | undefined {
  if (depth > 24) return undefined;

  const cached = ctx.stageAssignments.get(symbolId);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  const symbol = ctx.symbolById.get(symbolId);
  if (!symbol) {
    ctx.stageAssignments.set(symbolId, null);
    return undefined;
  }

  const parent = symbol.parentId ? ctx.symbolById.get(symbol.parentId) : undefined;
  let stage: StageId | undefined;

  if (symbol.kind === "class" && parent && (parent.kind === "group" || parent.kind === "module")) {
    stage = resolveStageAssignment(parent.id, ctx, depth + 1);
  }

  if (!stage) {
    stage = resolveStageOverride(symbol);
  }

  if (!stage) {
    stage = ctx.classifications.get(symbolId)?.primaryStage;
  }

  if (!stage && parent) {
    if (parent && (parent.kind === "group" || parent.kind === "module" || parent.kind === "class")) {
      stage = resolveStageAssignment(parent.id, ctx, depth + 1);
    }
  }

  if (!stage) {
    const fallbackText = normalize(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`);
    stage = resolvePreferredStage(symbol, ctx, fallbackText);
  }

  ctx.stageAssignments.set(symbolId, stage ?? null);
  return stage;
}

function resolveStageOverride(symbol: Symbol): StageId | undefined {
  const text = normalize(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`);
  return STAGE_OVERRIDE_RULES.find((rule) => rule.pattern.test(text))?.stage;
}

function chooseBestStageFromText(text: string): StageId | undefined {
  let bestStage: StageId | undefined;
  let bestScore = 0;
  for (const stage of STAGES) {
    const score = scoreByTerms(text, viewTerms(stage.id));
    if (score > bestScore) {
      bestStage = stage.id;
      bestScore = score;
    }
  }
  return bestScore > 0 ? bestStage : undefined;
}

function stageDef(stage: StageId): StageDef {
  const match = STAGES.find((candidate) => candidate.id === stage);
  if (!match) throw new Error(`Unknown process stage: ${stage}`);
  return match;
}

function compareViewOwnerPriority(candidate: Symbol, current: Symbol): number {
  return ownerPriority(candidate) - ownerPriority(current);
}

function ownerPriority(symbol: Symbol): number {
  let score = 0;
  if (!symbol.id.startsWith("stub:")) score += 100;
  if (!symbol.id.startsWith("proc:")) score += 40;
  if (!symbol.tags?.includes("external-stub")) score += 40;
  if (symbol.kind === "module") score += 30;
  if (symbol.kind === "class") score += 25;
  if (symbol.kind === "group") score += 20;
  if (symbol.kind !== "external") score += 10;
  return score;
}

function emptyScores(): ScoreMap {
  return {
    inputs: 0,
    extract: 0,
    transform: 0,
    match: 0,
    distribution: 0,
    simulation: 0,
  };
}

function tieBreak(candidate: StageId, current: StageId): number {
  const priority: Record<StageId, number> = {
    inputs: 1,
    extract: 2,
    transform: 3,
    match: 4,
    distribution: 5,
    simulation: 6,
  };
  return priority[candidate] - priority[current];
}

function viewTerms(stage: StageId): string[] {
  switch (stage) {
    case "inputs":
      return ["input", "source", "connector", "mes", "druid", "db"];
    case "extract":
      return ["extract", "preprocess", "arrival", "is table", "load"];
    case "transform":
      return ["transform", "color", "normalize", "statistics"];
    case "match":
      return ["match", "filter", "cluster", "station", "route"];
    case "distribution":
      return ["distribution", "kde", "persist", "pickle", "save"];
    case "simulation":
      return ["simulation", "generator", "model", "runtime"];
  }
}

function scoreByTerms(value: string, terms: string[]): number {
  const text = normalize(value);
  return terms.reduce((score, term) => score + (text.includes(normalize(term)) ? 1 : 0), 0);
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


