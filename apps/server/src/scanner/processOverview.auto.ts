import type { DiagramView, ProjectGraph, Relation, RelationType, Symbol } from "@dmpg/shared";

type StageId =
  | "inputs"
  | "extract"
  | "transform"
  | "match"
  | "distribution"
  | "simulation"
  | "outputs";

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
  scope: DiagramView["scope"];
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

interface Classification {
  primaryStage: StageId;
  score: number;
  scores: ScoreMap;
}

interface RankedStageNode {
  symbol: Symbol;
  classification: Classification;
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
}

interface ArtifactFlowGroup {
  key: string;
  label: string;
  paths: string[];
  producerStageIds: StageId[];
  consumerStageIds: StageId[];
  producerLabels: string[];
  consumerLabels: string[];
  relationCount: number;
  readCount: number;
  writeCount: number;
  category: "tabular" | "json" | "binary" | "arrival" | "source" | "artifact";
  kind: "input" | "handoff" | "output";
  score: number;
}

interface LayerOneContent {
  packages: ProcessPackageConfig[];
  nodes: ProcessNodeConfig[];
  edges: ProcessEdgeConfig[];
}

const VIEW_ID = "view:process-overview";
const STAGE_VIEW_PREFIX = "view:process-stage:";
const VIEW_TITLE = "Layer 1 - Architecture & Dataflow Overview";

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
  {
    id: "outputs",
    packageId: "proc:pkg:outputs",
    viewId: `${STAGE_VIEW_PREFIX}outputs`,
    label: "Artefacts / Outputs",
    x: 760,
    y: 1240,
    width: 320,
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
  outputs: [
    { pattern: /\boutput\b|\boutputs\b|\bartefact\b|\bartifact\b|\bresult\b|\bresults\b/, score: 18 },
    { pattern: /\bjson\b|\bcsv\b|\bxlsx\b|\bxls\b|\bexcel\b|\btable\b|\btables\b|\breport\b/, score: 14 },
    { pattern: /\bexport\b|\bsave\b|\bwrite\b|\bvalidation\b|\btraining\b/, score: 12 },
  ],
};

const FLOW_NODE_WIDTH = 322;
const FLOW_NODE_HEIGHT = 96;
const FLOW_SIDE_GAP = 430;
const FLOW_VERTICAL_GAP = 122;
const INPUT_GRID_COLUMNS = 3;
const INPUT_GRID_GAP_X = 340;
const INPUT_GRID_GAP_Y = 112;
const OUTPUT_GRID_COLUMNS = 3;
const OUTPUT_GRID_GAP_X = 350;
const OUTPUT_GRID_GAP_Y = 116;

const PIPELINE_EDGES: readonly ProcessEdgeConfig[] = [
  {
    id: "pipeline:inputs->extract",
    source: "proc:pkg:inputs",
    target: "proc:pkg:extract",
    type: "reads",
    label: "load source data",
  },
  {
    id: "pipeline:extract->transform",
    source: "proc:pkg:extract",
    target: "proc:pkg:transform",
    type: "calls",
    label: "pre-clean / normalize",
  },
  {
    id: "pipeline:transform->match",
    source: "proc:pkg:transform",
    target: "proc:pkg:match",
    type: "calls",
    label: "enrich / align",
  },
  {
    id: "pipeline:match->distribution",
    source: "proc:pkg:match",
    target: "proc:pkg:distribution",
    type: "calls",
    label: "filtered fit inputs",
  },
  {
    id: "pipeline:distribution->simulation",
    source: "proc:pkg:distribution",
    target: "proc:pkg:simulation",
    type: "reads",
    label: "load persisted models",
  },
  {
    id: "pipeline:simulation->outputs",
    source: "proc:pkg:simulation",
    target: "proc:pkg:outputs",
    type: "writes",
    label: "produce artefacts",
  },
] as const;

export function buildProcessDiagramConfigFromGraph(graph: ProjectGraph): ProcessDiagramConfig {
  const ctx = buildContext(graph);
  for (const symbol of graph.symbols) {
    ctx.classifications.set(symbol.id, classifySymbol(symbol, ctx));
  }

  const stageViews = STAGES.map((stage) => buildStageViewConfig(graph, ctx, stage));
  const layerOne = buildLayerOneContent(graph, ctx, stageViews);

  return {
    viewId: VIEW_ID,
    title: VIEW_TITLE,
    packages: layerOne.packages,
    nodes: layerOne.nodes,
    edges: [...layerOne.edges, ...PIPELINE_EDGES],
    stageViews,
    viewAdjustments: buildViewAdjustments(graph, ctx),
  };
}

function buildLayerOneContent(
  graph: ProjectGraph,
  ctx: Context,
  stageViews: ProcessStageViewConfig[],
): LayerOneContent {
  const flowGroups = collectArtifactFlowGroups(graph, ctx);
  const selectedGroups = selectArtifactFlowGroupsForLayer(flowGroups);
  const stageViewById = new Map(stageViews.map((view) => [view.id, view]));
  const inputConnectorNode = buildInputConnectorNode(
    ctx,
    stageViewById.get(stageDef("inputs").viewId)?.nodeRefs ?? [],
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

  const inputNodes = [
    ...(inputConnectorNode ? [inputConnectorNode] : []),
    ...selectedGroups.filter((group) => group.kind === "input").map((group) => flowGroupToNode(group)),
  ];
  nodes.push(...positionInputNodes(inputNodes));
  if (inputConnectorNode) {
    edges.push({
      id: "attachment:connector-access",
      source: inputConnectorNode.id,
      target: "proc:pkg:inputs",
      type: "reads",
      label: "query / API access",
    });
  }
  for (const group of selectedGroups.filter((candidate) => candidate.kind === "input")) {
    edges.push({
      id: `flow:${slugify(group.key)}:to-inputs`,
      source: flowNodeId(group),
      target: "proc:pkg:inputs",
      type: "reads",
      label: "imported",
    });
  }

  const handoffByStage = new Map<StageId, ArtifactFlowGroup[]>();
  for (const group of selectedGroups.filter((candidate) => candidate.kind === "handoff")) {
    const producerStage = dominantStage(group.producerStageIds);
    if (!producerStage) continue;
    const bucket = handoffByStage.get(producerStage) ?? [];
    bucket.push(group);
    handoffByStage.set(producerStage, bucket);
  }

  for (const stage of STAGES) {
    const groups = handoffByStage.get(stage.id) ?? [];
    if (groups.length === 0) continue;
    nodes.push(...positionStageSideNodes(stage, groups));

    for (const group of groups) {
      const nodeId = flowNodeId(group);
      edges.push({
        id: `flow:${slugify(group.key)}:${stage.id}:write`,
        source: stage.packageId,
        target: nodeId,
        type: "writes",
        label: flowWriteLabel(group),
      });

      for (const consumerStage of crossStageConsumers(group)) {
        edges.push({
          id: `flow:${slugify(group.key)}:${consumerStage}:read`,
          source: nodeId,
          target: stageDef(consumerStage).packageId,
          type: "reads",
          label: flowReadLabel(group, consumerStage),
        });
      }
    }
  }

  const outputGroups = selectedGroups.filter((group) => group.kind === "output");
  nodes.push(...positionOutputNodes(outputGroups.map((group) => flowGroupToNode(group))));
  for (const group of outputGroups) {
    const producerStage = dominantStage(group.producerStageIds);
    if (!producerStage) continue;
    const nodeId = flowNodeId(group);
    edges.push({
      id: `flow:${slugify(group.key)}:${producerStage}:produce`,
      source: stageDef(producerStage).packageId,
      target: nodeId,
      type: "writes",
      label: flowWriteLabel(group),
    });
    edges.push({
      id: `flow:${slugify(group.key)}:to-outputs`,
      source: nodeId,
      target: "proc:pkg:outputs",
      type: "writes",
      label: "final artefact",
    });
  }

  return { packages, nodes, edges };
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
      .map((nodeRef) => ctx.symbolById.get(nodeRef)?.label)
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
    producerStageCounts: Map<StageId, number>;
    consumerStageCounts: Map<StageId, number>;
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

    const key = artifactFamilyKey(target.label);
    const bucket = byKey.get(key) ?? {
      originalLabel: target.label,
      paths: new Set<string>(),
      producerStageCounts: new Map<StageId, number>(),
      consumerStageCounts: new Map<StageId, number>(),
      producerLabels: new Set<string>(),
      consumerLabels: new Set<string>(),
      readCount: 0,
      writeCount: 0,
    };
    bucket.paths.add(target.label);

    const sourceLabel = ctx.symbolById.get(relation.source)?.label ?? relation.source;
    if (relation.type === "writes") {
      bucket.writeCount += 1;
      bucket.producerStageCounts.set(stage, (bucket.producerStageCounts.get(stage) ?? 0) + 1);
      bucket.producerLabels.add(sourceLabel);
    } else {
      bucket.readCount += 1;
      bucket.consumerStageCounts.set(stage, (bucket.consumerStageCounts.get(stage) ?? 0) + 1);
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
        producerStageIds,
        consumerStageIds,
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
    if (stage.id === "inputs" || stage.id === "outputs") continue;
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

function buildInputConnectorNode(ctx: Context, stageNodeRefs: string[]): ProcessNodeConfig | null {
  const connectorSymbols = stageNodeRefs
    .map((nodeRef) => ctx.symbolById.get(nodeRef))
    .filter((symbol): symbol is Symbol => Boolean(symbol))
    .filter((symbol) => /\bconnector\b|\bmes\b|\bdruid\b|\bapi\b|\bsql\b/.test(normalize(symbol.label)));

  const preferred = connectorSymbols.filter((symbol) => symbol.kind === "class");
  const labels = unique((preferred.length > 0 ? preferred : connectorSymbols).map((symbol) => symbol.label));

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
  const lines = [
    buildFlowLine(group),
    group.paths.length > 0 ? `Paths: ${summarizeList(group.paths.map(shortArtifactPath), 2)}` : null,
    group.producerLabels.length > 0 ? `Written by: ${summarizeList(group.producerLabels, 2)}` : null,
    group.consumerLabels.length > 0 ? `Read by: ${summarizeList(group.consumerLabels, 2)}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.slice(0, 3);
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
  const centerX = inputStage.x + Math.round(inputStage.width / 2);
  const startX = centerX - Math.floor((INPUT_GRID_COLUMNS - 1) / 2) * INPUT_GRID_GAP_X - 160;
  const startY = 18;

  return nodes.map((node, index) => {
    const column = index % INPUT_GRID_COLUMNS;
    const row = Math.floor(index / INPUT_GRID_COLUMNS);
    return {
      ...node,
      position: {
        x: startX + column * INPUT_GRID_GAP_X,
        y: startY + row * INPUT_GRID_GAP_Y,
        width: node.position.width ?? FLOW_NODE_WIDTH,
        height: node.position.height ?? FLOW_NODE_HEIGHT,
      },
    };
  });
}

function positionStageSideNodes(stage: StageDef, groups: ArtifactFlowGroup[]): ProcessNodeConfig[] {
  const side = stageSide(stage.id);
  const x = side === "left"
    ? stage.x - FLOW_SIDE_GAP
    : stage.x + stage.width + 110;
  const baseY = stage.y - Math.floor((groups.length - 1) * FLOW_VERTICAL_GAP / 2);

  return groups.map((group, index) => ({
    ...flowGroupToNode(group),
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
  const outputsStage = stageDef("outputs");
  const centerX = outputsStage.x + Math.round(outputsStage.width / 2);
  const startX = centerX - OUTPUT_GRID_GAP_X;
  const startY = outputsStage.y + outputsStage.height + 82;

  return nodes.map((node, index) => {
    const column = index % OUTPUT_GRID_COLUMNS;
    const row = Math.floor(index / OUTPUT_GRID_COLUMNS);
    return {
      ...node,
      position: {
        x: startX + column * OUTPUT_GRID_GAP_X,
        y: startY + row * OUTPUT_GRID_GAP_Y,
        width: node.position.width ?? FLOW_NODE_WIDTH,
        height: node.position.height ?? FLOW_NODE_HEIGHT,
      },
    };
  });
}

function resolveStageForSymbolId(symbolId: string, ctx: Context): StageId | null {
  const chain = ctx.ancestorsById.get(symbolId) ?? [symbolId];
  for (const candidateId of chain) {
    const classification = ctx.classifications.get(candidateId);
    if (classification?.primaryStage) return classification.primaryStage;
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
  const basename = basenameOf(label.trim());
  if (/^\{[^}]+\}$/.test(basename)) return false;
  return /[\\/]/.test(label) || /\.(csv|xlsx|xls|json|pkl|pickle|parquet)$/i.test(label);
}

function artifactFamilyKey(label: string): string {
  const basename = basenameOf(label).toLowerCase();
  if (basename.startsWith("arrival_")) return "arrival_csvs";
  if (/^filter_stats(_fallback)?\.xlsx$/.test(basename)) return "filter_stats_exports";
  return basename;
}

function artifactDisplayLabel(primaryLabel: string, paths: string[]): string {
  const basenames = unique(paths.map((path) => basenameOf(path)));
  if (basenames.length > 0 && basenames.every((name) => /^Arrival_/i.test(name))) {
    return "Arrival CSVs";
  }
  if (basenames.length > 0 && basenames.every((name) => /^filter_stats/i.test(name))) {
    return "filter_stats.xlsx";
  }
  if (basenames.length === 1) return basenames[0];
  return basenameOf(primaryLabel);
}

function detectArtifactCategory(
  originalLabel: string,
  paths: string[],
): ArtifactFlowGroup["category"] {
  const text = normalize(`${originalLabel} ${paths.join(" ")}`);
  if (/\barrival\b|\bsimulation\b/.test(text)) return "arrival";
  if (/\bjson\b/.test(text)) return "json";
  if (/\bpkl\b|\bpickle\b|\bkde\b/.test(text)) return "binary";
  if (/\bcsv\b|\bxlsx\b|\bxls\b|\btable\b|\bdf\b/.test(text)) return "tabular";
  if (/\binput\b|\barchive\b|\broute\b|\bcluster\b|\bmaterial\b/.test(text)) return "source";
  return "artifact";
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
    case "outputs":
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

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function basenameOf(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? value;
}

function shortArtifactPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.slice(-2).join("/");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function summarizeList(values: string[], maxItems: number): string {
  if (values.length === 0) return "";
  if (values.length <= maxItems) return values.join(", ");
  return `${values.slice(0, maxItems).join(", ")}, +${values.length - maxItems} more`;
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
  switch (group.category) {
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
  if (group.category === "json" || group.category === "binary") return "loads";
  if (stage === "simulation") return "consumes";
  return "reads";
}

function outputSelectionPriority(group: ArtifactFlowGroup): number {
  const text = normalize(group.label);
  if (group.category === "arrival") return 100;
  if (group.category === "json" || group.category === "binary") return 90;
  if (text.includes("df_data")) return 60;
  if (text.includes("filter_stats") || text.includes("outliners")) return 10;
  if (text.includes("validation") || text.includes("mat_export") || text.includes("distribution")) return 8;
  return 40;
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
    scores.outputs += 8;
  }
  if (fileText.includes("color_change")) {
    scores.transform += 16;
    scores.match += 8;
    scores.outputs += 6;
  }
  if (fileText.includes("filter")) scores.match += 18;
  if (fileText.includes("distribution") || fileText.includes("kde") || fileText.includes("pickle")) {
    scores.distribution += 18;
    scores.outputs += 8;
  }
  if (fileText.includes("simulation") || fileText.endsWith("model py")) {
    scores.simulation += 18;
    scores.outputs += 10;
  }
  if (fileText.includes("analyzer")) {
    scores.transform += 10;
    scores.outputs += 12;
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
      scores.outputs += 6;
    }
    if (relation.type === "writes") {
      scores.outputs += 10;
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
    scores.outputs += 4;
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
): ProcessStageViewConfig {
  const nodeRefs = selectStageNodeRefs(graph, ctx, stage.id);
  return {
    id: stage.viewId,
    title: `Layer 2 - ${stage.label}`,
    scope: "group",
    hiddenInSidebar: false,
    nodeRefs,
    edgeRefs: collectStageEdgeRefs(graph, ctx, nodeRefs),
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
    const stage = owner ? resolvePreferredStage(owner, ctx, viewText) : chooseBestStageFromText(viewText);
    if (stage) {
      stageByViewId.set(view.id, stage);
    }

    if (shouldShowViewInSidebar(view, owner, viewText)) {
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

function selectStageNodeRefs(graph: ProjectGraph, ctx: Context, stage: StageId): string[] {
  const candidates: RankedStageNode[] = [];

  for (const symbol of graph.symbols) {
    if (!isStageViewNodeCandidate(symbol)) continue;

    const classification = ctx.classifications.get(symbol.id);
    if (!classification) continue;

    const stageScore = classification.scores[stage] ?? 0;
    const threshold = minimumStageScore(stage, symbol.kind);
    if (stageScore < threshold) continue;

    let rank = stageScore;
    if (classification.primaryStage === stage) rank += 10;
    if (symbol.kind === "module") rank += 10;
    if (symbol.kind === "class") rank += 7;
    if (symbol.childViewId) rank += 4;
    if (looksLikeUtilityOnly(ctx.ownTextById.get(symbol.id) ?? "")) rank -= 10;

    candidates.push({ symbol, classification, stageScore, rank });
  }

  candidates.sort((a, b) =>
    b.rank - a.rank ||
    b.stageScore - a.stageScore ||
    a.symbol.label.localeCompare(b.symbol.label),
  );

  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const moduleRankById = new Map<string, number>();

  for (const candidate of candidates) {
    if (selected.length >= maxStageNodeCount(stage)) break;

    const parentId = candidate.symbol.parentId;
    if (candidate.symbol.kind === "class" && parentId && selectedSet.has(parentId)) {
      const parentRank = moduleRankById.get(parentId) ?? Number.POSITIVE_INFINITY;
      if (candidate.rank <= parentRank + 6) continue;
    }

    selected.push(candidate.symbol.id);
    selectedSet.add(candidate.symbol.id);
    if (candidate.symbol.kind === "module") {
      moduleRankById.set(candidate.symbol.id, candidate.rank);
    }
  }

  if (selected.length > 0) {
    return selected;
  }

  return fallbackStageNodesByTerms(graph, stage);
}

function fallbackStageNodesByTerms(graph: ProjectGraph, stage: StageId): string[] {
  const terms = viewTerms(stage);
  return graph.symbols
    .filter((symbol) => isStageViewNodeCandidate(symbol))
    .map((symbol) => ({
      symbol,
      score: scoreByTerms(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.label.localeCompare(b.symbol.label))
    .slice(0, maxStageNodeCount(stage))
    .map((entry) => entry.symbol.id);
}

function collectStageEdgeRefs(
  graph: ProjectGraph,
  ctx: Context,
  nodeRefs: string[],
): string[] {
  if (nodeRefs.length === 0) return [];

  const visible = new Set(nodeRefs);
  const edgeRefs = new Set<string>();

  for (const relation of graph.relations) {
    if (relation.type === "contains") continue;
    if (relation.id.startsWith("process-edge:") || relation.id.startsWith("stub-edge:")) continue;

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
): boolean {
  if (view.id === "view:root") return false;
  if (view.id.startsWith("view:artifacts:") || view.id.startsWith("view:art-cat:")) return false;
  if (!owner) return false;
  if (owner.kind !== "group" && owner.kind !== "module" && owner.kind !== "class") return false;
  if (owner.id.startsWith("grp:domain:")) return false;
  if (owner.id === "grp:dir:__root__") return false;
  if (owner.id.startsWith("grp:art")) return false;
  if (owner.id === "grp:dir:constant" || owner.id.startsWith("mod:constant.")) return false;
  if (looksLikeArtifactCategory(viewText)) return false;
  if (/\bdata pipeline\b.*\boverview\b/.test(viewText)) return false;
  return true;
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
  const base = stage === "outputs" ? 10 : 12;
  return kind === "class" ? base - 1 : base;
}

function maxStageNodeCount(stage: StageId): number {
  return stage === "outputs" ? 7 : 6;
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
    outputs: 0,
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
    outputs: 7,
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
    case "outputs":
      return ["output", "result", "json", "csv", "table", "report"];
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
