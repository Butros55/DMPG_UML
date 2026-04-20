import type { DiagramView, ProjectGraph, Relation, Symbol } from "@dmpg/shared";
import type { DiagramArtifactMode } from "./diagramSettings";

type StageId =
  | "inputs"
  | "extract"
  | "transform"
  | "match"
  | "distribution"
  | "simulation";

type ArtifactGroupKind = "input" | "handoff" | "output";
type ArtifactScope = "input" | "generated";

interface ArtifactPreviewMeta {
  mode?: "single" | "cluster";
  stageId?: StageId;
  groupKind?: ArtifactGroupKind;
  category?: string;
}

interface ArtifactPreviewItem {
  label: string;
  paths: string[];
  artifactIds: string[];
  writeCount?: number | null;
  readCount?: number | null;
  producerIds: string[];
  consumerIds: string[];
  producers: string[];
  consumers: string[];
  producerStages: StageId[];
  consumerStages: StageId[];
  category?: string;
  groupKind?: ArtifactGroupKind;
}

interface ArtifactStageSummary {
  producerStages: StageId[];
  consumerStages: StageId[];
}

interface ExpandedArtifactCluster {
  memberNodeIds: string[];
  syntheticRelations: Relation[];
  symbolOverrides: Map<string, Symbol>;
}

export interface ArtifactViewResolution {
  nodeRefs: string[];
  relations: Relation[];
  hiddenSymbolIds: Set<string>;
  symbolOverrides: Map<string, Symbol>;
}

export interface ArtifactViewModes {
  input: DiagramArtifactMode;
  generated: DiagramArtifactMode;
}

const PREVIEW_META_PREFIX = "@preview ";
const PREVIEW_ITEM_PREFIX = "@item ";

const STAGE_PACKAGE_BY_ID: Record<StageId, string> = {
  inputs: "proc:pkg:inputs",
  extract: "proc:pkg:extract",
  transform: "proc:pkg:transform",
  match: "proc:pkg:match",
  distribution: "proc:pkg:distribution",
  simulation: "proc:pkg:simulation",
};

const STAGE_ID_BY_PACKAGE_ID = new Map<string, StageId>(
  Object.entries(STAGE_PACKAGE_BY_ID).map(([stageId, packageId]) => [packageId, stageId as StageId]),
);
const INPUT_STAGE_PACKAGE_ID = STAGE_PACKAGE_BY_ID.inputs;

export function isArtifactLikeSymbol(symbol: Pick<Symbol, "kind" | "umlType">): boolean {
  return (
    symbol.kind === "external" ||
    symbol.umlType === "artifact" ||
    symbol.umlType === "database" ||
    symbol.umlType === "component" ||
    symbol.umlType === "note" ||
    symbol.umlType === "external"
  );
}

export function resolveArtifactView(
  graph: ProjectGraph,
  view: DiagramView,
  modes: ArtifactViewModes,
): ArtifactViewResolution {
  if (
    modes.input === "grouped" &&
    modes.generated === "grouped" &&
    !shouldHideInputStagePackage(view, modes)
  ) {
    return {
      nodeRefs: [...view.nodeRefs],
      relations: [...graph.relations],
      hiddenSymbolIds: new Set<string>(),
      symbolOverrides: new Map<string, Symbol>(),
    };
  }

  const symbolById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const relationsBySymbolId = buildRelationsBySymbolId(graph.relations);
  const relationKeySet = new Set(
    graph.relations.map((relation) => `${relation.source}|${relation.target}|${relation.type}`),
  );
  const hiddenSymbolIds = new Set<string>();
  const nextNodeRefs: string[] = [];
  const seenNodeIds = new Set<string>();
  const syntheticRelations: Relation[] = [];
  const symbolOverrides = new Map<string, Symbol>();

  for (const nodeRef of view.nodeRefs) {
    const symbol = symbolById.get(nodeRef);
    if (!symbol) continue;

    const mode = artifactModeForSymbol(symbol, relationsBySymbolId, modes);
    if (mode === "hidden") {
      hiddenSymbolIds.add(nodeRef);
      continue;
    }

    if (mode === "individual") {
      const expanded = expandArtifactClusterSymbol(graph, symbol, relationKeySet);
      if (expanded) {
        hiddenSymbolIds.add(nodeRef);
        for (const memberNodeId of expanded.memberNodeIds) {
          if (seenNodeIds.has(memberNodeId)) continue;
          nextNodeRefs.push(memberNodeId);
          seenNodeIds.add(memberNodeId);
        }
        syntheticRelations.push(...expanded.syntheticRelations);
        for (const [memberNodeId, override] of expanded.symbolOverrides.entries()) {
          symbolOverrides.set(memberNodeId, override);
        }
        continue;
      }
    }

    if (!seenNodeIds.has(nodeRef)) {
      nextNodeRefs.push(nodeRef);
      seenNodeIds.add(nodeRef);
    }
  }

  if (shouldHideInputStagePackage(view, modes)) {
    hiddenSymbolIds.add(INPUT_STAGE_PACKAGE_ID);
  }

  const resolvedRelations = [...graph.relations, ...syntheticRelations];
  const resolvedRelationKeySet = new Set(
    resolvedRelations.map((relation) => `${relation.source}|${relation.target}|${relation.type}`),
  );
  if (hiddenSymbolIds.has(INPUT_STAGE_PACKAGE_ID)) {
    syntheticRelations.push(
      ...buildStageBypassRelations(INPUT_STAGE_PACKAGE_ID, resolvedRelations, resolvedRelationKeySet),
    );
  }

  const relations = [
    ...graph.relations.filter(
      (relation) => !hiddenSymbolIds.has(relation.source) && !hiddenSymbolIds.has(relation.target),
    ),
    ...syntheticRelations,
  ].filter((relation) => !hiddenSymbolIds.has(relation.source) && !hiddenSymbolIds.has(relation.target));

  return {
    nodeRefs: nextNodeRefs.filter((nodeRef) => !hiddenSymbolIds.has(nodeRef)),
    relations,
    hiddenSymbolIds,
    symbolOverrides,
  };
}

function shouldHideInputStagePackage(view: DiagramView, modes: ArtifactViewModes): boolean {
  return modes.input !== "hidden" && view.nodeRefs.includes(INPUT_STAGE_PACKAGE_ID);
}

function artifactModeForSymbol(
  symbol: Symbol,
  relationsBySymbolId: Map<string, Relation[]>,
  modes: ArtifactViewModes,
): DiagramArtifactMode | null {
  const scope = classifyArtifactScope(symbol, relationsBySymbolId);
  if (!scope) return null;
  return scope === "input" ? modes.input : modes.generated;
}

function classifyArtifactScope(
  symbol: Symbol,
  relationsBySymbolId: Map<string, Relation[]>,
): ArtifactScope | null {
  if (!isArtifactLikeSymbol(symbol)) return null;

  if (symbol.id.startsWith("proc:input:")) return "input";
  if (symbol.id.startsWith("proc:output:")) return "generated";

  const previewLines = symbol.preview?.lines ?? [];
  const meta = parsePreviewMeta(previewLines);
  const items = parsePreviewItems(previewLines);

  if (meta?.groupKind === "input") return "input";
  if (meta?.groupKind === "handoff" || meta?.groupKind === "output") return "generated";
  if (items.some((item) => item.groupKind === "handoff" || item.groupKind === "output")) return "generated";
  if (items.some((item) => item.groupKind === "input")) return "input";
  if (meta?.category === "libraries-imports" || items.some((item) => item.category === "libraries-imports")) {
    return "input";
  }

  const previewStages = summarizePreviewStages(meta, items);
  if (previewStages.producerStages.length > 0) return "generated";
  if (previewStages.consumerStages.length > 0) return "input";
  if (meta?.stageId === "inputs") return "input";
  if (meta?.stageId) return "generated";

  const relationStages = summarizeRelationStages(symbol.id, relationsBySymbolId);
  const hasImportConsumers = (relationsBySymbolId.get(symbol.id) ?? []).some(
    (relation) => relation.type === "imports" && relation.target === symbol.id,
  );
  if (hasImportConsumers) return "input";
  if (relationStages.producerStages.length > 0) return "generated";
  if (relationStages.consumerStages.length > 0) return "input";

  return symbol.id.startsWith("proc:artifact:") ? "generated" : null;
}

function summarizePreviewStages(meta: ArtifactPreviewMeta | null, items: ArtifactPreviewItem[]): ArtifactStageSummary {
  const producerStages = unique(items.flatMap((item) => item.producerStages));
  const consumerStages = unique(items.flatMap((item) => item.consumerStages));

  if (producerStages.length === 0 && meta?.stageId && meta.stageId !== "inputs") {
    producerStages.push(meta.stageId);
  }

  return { producerStages, consumerStages };
}

function summarizeRelationStages(symbolId: string, relationsBySymbolId: Map<string, Relation[]>): ArtifactStageSummary {
  const producerStages: StageId[] = [];
  const consumerStages: StageId[] = [];

  for (const relation of relationsBySymbolId.get(symbolId) ?? []) {
    if (relation.type === "writes" && relation.target === symbolId) {
      const stageId = STAGE_ID_BY_PACKAGE_ID.get(relation.source);
      if (stageId) producerStages.push(stageId);
    }
    if (relation.type === "reads" && relation.source === symbolId) {
      const stageId = STAGE_ID_BY_PACKAGE_ID.get(relation.target);
      if (stageId) consumerStages.push(stageId);
    }
  }

  return {
    producerStages: unique(producerStages),
    consumerStages: unique(consumerStages),
  };
}

function expandArtifactClusterSymbol(
  graph: ProjectGraph,
  symbol: Symbol,
  relationKeySet: Set<string>,
): ExpandedArtifactCluster | null {
  if (!isClusterArtifactSymbol(symbol)) return null;

  const meta = parsePreviewMeta(symbol.preview?.lines ?? []);
  const items = parsePreviewItems(symbol.preview?.lines ?? []);
  if ((meta?.mode ?? "cluster") !== "cluster" || items.length === 0) {
    return null;
  }

  const memberNodeIds: string[] = [];
  const syntheticRelations: Relation[] = [];
  const symbolOverrides = new Map<string, Symbol>();

  for (const item of items) {
    const memberSymbol = resolveArtifactSymbol(graph, item);
    if (!memberSymbol) continue;

    memberNodeIds.push(memberSymbol.id);
    symbolOverrides.set(memberSymbol.id, buildExpandedArtifactSymbol(memberSymbol, item, meta));
    for (const relation of buildSyntheticClusterRelations(symbol.id, memberSymbol.id, item, meta, relationKeySet)) {
      syntheticRelations.push(relation);
    }
  }

  return memberNodeIds.length > 0
    ? {
        memberNodeIds: unique(memberNodeIds),
        syntheticRelations,
        symbolOverrides,
      }
    : null;
}

function isClusterArtifactSymbol(symbol: Pick<Symbol, "id" | "tags" | "preview">): boolean {
  const previewLines = symbol.preview?.lines ?? [];
  return (
    symbol.id.startsWith("proc:artifact-cluster:") ||
    symbol.id.startsWith("proc:artgrp:") ||
    symbol.id.startsWith("proc:output:") ||
    symbol.tags?.includes("artifact-cluster") === true ||
    symbol.tags?.includes("artifact-group") === true ||
    previewLines.some((line) => line.startsWith(PREVIEW_META_PREFIX) && line.includes("\"mode\":\"cluster\""))
  );
}

function parsePreviewMeta(lines: string[]): ArtifactPreviewMeta | null {
  const line = lines.find((entry) => entry.startsWith(PREVIEW_META_PREFIX));
  if (!line) return null;

  try {
    const payload = JSON.parse(line.slice(PREVIEW_META_PREFIX.length)) as Record<string, unknown>;
    return {
      mode: payload.mode === "single" || payload.mode === "cluster" ? payload.mode : undefined,
      stageId: isStageId(payload.stageId) ? payload.stageId : undefined,
      groupKind: isArtifactGroupKind(payload.groupKind) ? payload.groupKind : undefined,
      category: typeof payload.category === "string" ? payload.category : undefined,
    };
  } catch {
    return null;
  }
}

function parsePreviewItems(lines: string[]): ArtifactPreviewItem[] {
  const items: ArtifactPreviewItem[] = [];
  for (const line of lines) {
    if (!line.startsWith(PREVIEW_ITEM_PREFIX)) continue;
    try {
      const payload = JSON.parse(line.slice(PREVIEW_ITEM_PREFIX.length)) as Record<string, unknown>;
      const label = typeof payload.label === "string" ? payload.label.trim() : "";
      if (!label) continue;
      items.push({
        label,
        paths: normalizeStringArray(payload.paths),
        artifactIds: normalizeStringArray(payload.artifactIds),
        writeCount: typeof payload.writeCount === "number" ? payload.writeCount : null,
        readCount: typeof payload.readCount === "number" ? payload.readCount : null,
        producerIds: normalizeStringArray(payload.producerIds),
        consumerIds: normalizeStringArray(payload.consumerIds),
        producers: normalizeStringArray(payload.producers),
        consumers: normalizeStringArray(payload.consumers),
        producerStages: normalizeStageArray(payload.producerStages),
        consumerStages: normalizeStageArray(payload.consumerStages),
        category: typeof payload.category === "string" ? payload.category : undefined,
        groupKind: isArtifactGroupKind(payload.groupKind) ? payload.groupKind : undefined,
      });
    } catch {
      continue;
    }
  }
  return items;
}

function resolveArtifactSymbol(graph: ProjectGraph, item: ArtifactPreviewItem): Symbol | null {
  const explicitArtifactId = item.artifactIds.find((artifactId) =>
    graph.symbols.some((symbol) => symbol.id === artifactId),
  );
  if (explicitArtifactId) {
    return graph.symbols.find((symbol) => symbol.id === explicitArtifactId) ?? null;
  }

  const exactLabel = graph.symbols.find((symbol) => symbol.label === item.label);
  return exactLabel ?? null;
}

function buildExpandedArtifactSymbol(
  baseSymbol: Symbol,
  item: ArtifactPreviewItem,
  meta: ArtifactPreviewMeta | null,
): Symbol {
  const producerStages = item.producerStages.length > 0
    ? item.producerStages
    : meta?.stageId && meta.stageId !== "inputs"
      ? [meta.stageId]
      : [];
  const previewLines = [
    `${PREVIEW_META_PREFIX}${JSON.stringify({
      mode: "single",
      stageId: producerStages[0] ?? meta?.stageId,
      groupKind: item.groupKind ?? meta?.groupKind,
      category: item.category,
    })}`,
    `${PREVIEW_ITEM_PREFIX}${JSON.stringify({
      label: item.label || baseSymbol.label,
      paths: item.paths,
      artifactIds: item.artifactIds.length > 0 ? item.artifactIds : [baseSymbol.id],
      writeCount: item.writeCount ?? null,
      readCount: item.readCount ?? null,
      producerIds: item.producerIds,
      consumerIds: item.consumerIds,
      producers: item.producers,
      consumers: item.consumers,
      producerStages: unique(producerStages),
      consumerStages: unique(item.consumerStages),
      category: item.category,
      groupKind: item.groupKind ?? meta?.groupKind,
    })}`,
  ];

  return {
    ...baseSymbol,
    label: item.label || baseSymbol.label,
    parentId: undefined,
    preview: { lines: previewLines },
  };
}

function buildSyntheticClusterRelations(
  clusterId: string,
  artifactId: string,
  item: ArtifactPreviewItem,
  meta: ArtifactPreviewMeta | null,
  relationKeySet: Set<string>,
): Relation[] {
  const relations: Relation[] = [];
  const explicitProducerIds = unique(item.producerIds.filter(Boolean));
  const explicitConsumerIds = unique(item.consumerIds.filter(Boolean));
  const producerStages = item.producerStages.length > 0
    ? item.producerStages
    : meta?.stageId && meta.stageId !== "inputs"
      ? [meta.stageId]
      : [];
  const consumerStages = item.consumerStages.filter((stageId) => !producerStages.includes(stageId));

  if (item.category === "libraries-imports") {
    for (const source of explicitProducerIds) {
      if (source === artifactId) continue;
      const key = `${source}|${artifactId}|imports`;
      if (relationKeySet.has(key)) continue;
      relations.push({
        id: `virtual:artifact:${sanitizeId(clusterId)}:${sanitizeId(artifactId)}:import:${sanitizeId(source)}`,
        type: "imports",
        source,
        target: artifactId,
        label: "imports",
        confidence: 1,
      });
    }
    for (const producerStage of unique(producerStages)) {
      const source = STAGE_PACKAGE_BY_ID[producerStage];
      if (!source || source === artifactId) continue;
      const key = `${source}|${artifactId}|imports`;
      if (relationKeySet.has(key)) continue;
      relations.push({
        id: `virtual:artifact:${sanitizeId(clusterId)}:${sanitizeId(artifactId)}:import-stage:${producerStage}`,
        type: "imports",
        source,
        target: artifactId,
        label: "imports",
        confidence: 1,
      });
    }
    return relations;
  }

  for (const source of explicitProducerIds) {
    if (source === artifactId) continue;
    const key = `${source}|${artifactId}|writes`;
    if (relationKeySet.has(key)) continue;
    relations.push({
      id: `virtual:artifact:${sanitizeId(clusterId)}:${sanitizeId(artifactId)}:write:${sanitizeId(source)}`,
      type: "writes",
      source,
      target: artifactId,
      label: writeLabelForCategory(item.category),
      confidence: 1,
    });
  }

  for (const target of explicitConsumerIds) {
    if (target === artifactId) continue;
    const key = `${artifactId}|${target}|reads`;
    if (relationKeySet.has(key)) continue;
    relations.push({
      id: `virtual:artifact:${sanitizeId(clusterId)}:${sanitizeId(artifactId)}:read:${sanitizeId(target)}`,
      type: "reads",
      source: artifactId,
      target,
      label: readLabelForCategory(item.category, meta?.stageId ?? item.consumerStages[0] ?? "extract"),
      confidence: 1,
    });
  }

  for (const producerStage of unique(producerStages)) {
    const relationType = "writes";
    const source = STAGE_PACKAGE_BY_ID[producerStage];
    if (!source || source === artifactId) continue;
    const key = `${source}|${artifactId}|${relationType}`;
    if (relationKeySet.has(key)) continue;
    relations.push({
      id: `virtual:artifact:${sanitizeId(clusterId)}:${sanitizeId(artifactId)}:write:${producerStage}`,
      type: relationType,
      source,
      target: artifactId,
      label: writeLabelForCategory(item.category),
      confidence: 1,
    });
  }

  for (const consumerStage of unique(consumerStages)) {
    const relationType = "reads";
    const target = STAGE_PACKAGE_BY_ID[consumerStage];
    if (!target || target === artifactId) continue;
    const key = `${artifactId}|${target}|${relationType}`;
    if (relationKeySet.has(key)) continue;
    relations.push({
      id: `virtual:artifact:${sanitizeId(clusterId)}:${sanitizeId(artifactId)}:read:${consumerStage}`,
      type: relationType,
      source: artifactId,
      target,
      label: readLabelForCategory(item.category, consumerStage),
      confidence: 1,
    });
  }

  return relations;
}

function buildRelationsBySymbolId(relations: Relation[]): Map<string, Relation[]> {
  const relationsBySymbolId = new Map<string, Relation[]>();

  for (const relation of relations) {
    const sourceRelations = relationsBySymbolId.get(relation.source) ?? [];
    sourceRelations.push(relation);
    relationsBySymbolId.set(relation.source, sourceRelations);

    const targetRelations = relationsBySymbolId.get(relation.target) ?? [];
    targetRelations.push(relation);
    relationsBySymbolId.set(relation.target, targetRelations);
  }

  return relationsBySymbolId;
}

function buildStageBypassRelations(
  hiddenSymbolId: string,
  relations: Relation[],
  relationKeySet: Set<string>,
): Relation[] {
  const incomingRelations = relations.filter(
    (relation) => relation.target === hiddenSymbolId && relation.type !== "contains",
  );
  const outgoingRelations = relations.filter(
    (relation) => relation.source === hiddenSymbolId && relation.type !== "contains",
  );
  const bypassRelations: Relation[] = [];

  for (const incoming of incomingRelations) {
    for (const outgoing of outgoingRelations) {
      if (incoming.source === outgoing.target) continue;

      const type = incoming.type === outgoing.type ? incoming.type : outgoing.type;
      const key = `${incoming.source}|${outgoing.target}|${type}`;
      if (relationKeySet.has(key)) continue;

      relationKeySet.add(key);
      bypassRelations.push({
        id: `virtual:bypass:${sanitizeId(hiddenSymbolId)}:${sanitizeId(incoming.source)}:${sanitizeId(outgoing.target)}:${type}`,
        type,
        source: incoming.source,
        target: outgoing.target,
        label: selectBypassRelationLabel(incoming, outgoing),
        confidence: Math.min(incoming.confidence ?? 1, outgoing.confidence ?? 1),
      });
    }
  }

  return bypassRelations;
}

function selectBypassRelationLabel(incoming: Relation, outgoing: Relation): string | undefined {
  return isGenericRelationLabel(incoming.label, incoming.type)
    ? outgoing.label ?? incoming.label
    : incoming.label ?? outgoing.label;
}

function isGenericRelationLabel(label: string | undefined, relationType: Relation["type"]): boolean {
  if (!label) return true;
  const normalized = label.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === relationType ||
    normalized === "reads" ||
    normalized === "writes" ||
    normalized === "writes to" ||
    normalized === "imports" ||
    normalized === "calls"
  );
}

function writeLabelForCategory(category?: string): string {
  if (category === "json" || category === "binary") return "persists";
  if (category === "arrival") return "creates";
  return "writes";
}

function readLabelForCategory(category: string | undefined, stage: StageId): string {
  if (category === "json" || category === "binary") return "loads";
  if (stage === "simulation") return "consumes";
  return "reads";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeStageArray(value: unknown): StageId[] {
  return normalizeStringArray(value).filter(isStageId);
}

function isStageId(value: unknown): value is StageId {
  return (
    value === "inputs" ||
    value === "extract" ||
    value === "transform" ||
    value === "match" ||
    value === "distribution" ||
    value === "simulation"
  );
}

function isArtifactGroupKind(value: unknown): value is ArtifactGroupKind {
  return value === "input" || value === "handoff" || value === "output";
}

function unique<TValue>(values: TValue[]): TValue[] {
  return [...new Set(values)];
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]+/g, "_");
}



