import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { DiagramView, ProjectGraph, Relation, RelationType, Symbol } from "@dmpg/shared";
import type { DiagramLabelMode } from "./diagramSettings";
import type { SequenceActivationBar, UmlNodeData } from "./components/UmlNode";

const SEQUENCE_RELATION_TYPES: RelationType[] = [
  "calls",
  "instantiates",
  "reads",
  "writes",
  "uses_config",
];

const FRAME_LEFT = 28;
const FRAME_TOP = 22;
const FRAME_PADDING_X = 42;
const FRAME_PADDING_Y = 18;
const FRAME_BOTTOM_PADDING = 12;
const HEADER_HEIGHT = 70;
const MESSAGE_Y_OFFSET = 8;
const MESSAGE_ROW_MIN_HEIGHT = 34;
const MESSAGE_ROW_PADDING_Y = 14;
const MESSAGE_LABEL_LINE_HEIGHT = 16;
const MESSAGE_LABEL_CHAR_WIDTH = 6.4;
const MESSAGE_LABEL_MIN_WIDTH = 92;
const MESSAGE_LABEL_MAX_WIDTH = 224;
const MESSAGE_LABEL_SELF_WIDTH = 132;
const MESSAGE_LABEL_MAX_LINES = 3;
const MIN_LIFELINE_HEIGHT = 168;
const PARTICIPANT_MIN_WIDTH = 124;
const PARTICIPANT_MAX_WIDTH = 160;
const PARTICIPANT_GAP = 78;
const PARTICIPANT_LEFT_MARGIN = 48;
const PARTICIPANT_TOP_MARGIN = 52;
const ACTIVATION_HALF_HEIGHT = 12;
const ACTIVATION_GAP = 8;
const SEQUENCE_ACTIVATION_WIDTH = 10;
const SELF_CALL_VERTICAL_GAP = 12;
const MAX_SEQUENCE_MESSAGES = 20;
const MAX_SEQUENCE_PARTICIPANTS = 8;

type SequenceParticipantRole =
  | "actor"
  | "package"
  | "object"
  | "artifact"
  | "database"
  | "component";

type RawSequenceMessage = {
  relation: Relation;
  sourceParticipantId: string;
  targetParticipantId: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  file: string;
  line: number;
  sortIndex: number;
  label?: string;
  descriptor: SequenceLabelDescriptor;
  isSelfCall: boolean;
  isCreateMessage: boolean;
};

type SequenceMessage = {
  id: string;
  relationIds: string[];
  relationType: RelationType;
  sourceParticipantId: string;
  targetParticipantId: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  file: string;
  line: number;
  sortIndex: number;
  label?: string;
  count: number;
  descriptors: SequenceLabelDescriptor[];
  signalScore: number;
  isSelfCall: boolean;
  isCreateMessage: boolean;
};

type SequenceLabelDescriptor = {
  action: string;
  object?: string;
  text?: string;
  mergeKey: string;
  objectFamily: string;
  signal: number;
  generic: boolean;
};

type SequenceParticipantMeta = {
  symbol: Symbol;
  role: SequenceParticipantRole;
  laneKind: "internal" | "external" | "artifact";
  displayLabel: string;
  fullLabel?: string;
  subtitle: string;
  childViewId?: string;
  lifelineOffset: number;
  firstMessageIndex: number;
};

type SequenceParticipantStats = {
  firstMessageIndex: number;
  firstInvolvementIndex: number;
  firstIncomingCreateIndex: number | null;
};

type SequenceEdgeKind = "sync" | "async" | "create" | "self";

type SequenceParticipantLayout = {
  x: number;
  width: number;
  centerX: number;
};

type SequenceMessageLayout = {
  top: number;
  centerY: number;
  bottom: number;
  height: number;
  labelWidth: number;
  labelLineCount: number;
  labelText?: string;
};

type SequenceProjectionSeed = {
  symbolById: Map<string, Symbol>;
  messages: SequenceMessage[];
  displayBaseParticipantIds: string[];
  extraParticipantOrder: Map<string, number>;
};

export function isPackageSequenceView(
  view: DiagramView | null | undefined,
  graph?: Pick<ProjectGraph, "views"> | null,
): boolean {
  if (!view || view.scope !== "group" || !view.parentViewId) return false;
  if (view.parentViewId === "view:root") return true;

  const parentView = graph?.views.find((entry) => entry.id === view.parentViewId);
  return parentView?.scope === "root";
}

export function buildPackageSequenceDiagram(params: {
  graph: ProjectGraph;
  view: DiagramView;
  visibleViewNodeRefs: string[];
  hiddenSymbolIds: Set<string>;
  symbolOverrides: Map<string, Symbol>;
  relationFilters: Record<RelationType, boolean>;
  labelsMode: DiagramLabelMode;
  selectedSymbolId: string | null;
  selectedEdgeId: string | null;
}): { nodes: Node[]; edges: Edge[] } {
  const {
    graph,
    view,
    visibleViewNodeRefs,
    hiddenSymbolIds,
    symbolOverrides,
    relationFilters,
    labelsMode,
    selectedSymbolId,
    selectedEdgeId,
  } = params;

  const symbolById = new Map<string, Symbol>(graph.symbols.map((symbol) => [symbol.id, symbol]));
  for (const [symbolId, symbol] of symbolOverrides.entries()) {
    symbolById.set(symbolId, symbol);
  }

  const stageSeed = buildStageSequenceProjectionSeed({
    graph,
    view,
    visibleViewNodeRefs,
    hiddenSymbolIds,
    symbolById,
    relationFilters,
    labelsMode,
  });
  if (stageSeed) {
    return buildSequenceProjectionElements({
      view,
      selectedSymbolId,
      selectedEdgeId,
      ...stageSeed,
    });
  }

  const parentMap = new Map<string, string | undefined>(graph.symbols.map((symbol) => [symbol.id, symbol.parentId]));
  const ancestorIndex = buildAncestorIndex(parentMap);
  const baseParticipantIds = visibleViewNodeRefs.filter((id) => !hiddenSymbolIds.has(id));
  const collapseArtifactsAggressively = baseParticipantIds.length > 4;
  const {
    participantAliases,
    syntheticSymbols,
    displayBaseParticipantIds,
  } = buildBaseParticipantAliases(baseParticipantIds, symbolById);
  for (const syntheticSymbol of syntheticSymbols.values()) {
    symbolById.set(syntheticSymbol.id, syntheticSymbol);
  }
  const baseParticipantSet = new Set(baseParticipantIds);
  const displayBaseParticipantSet = new Set(displayBaseParticipantIds);
  const baseParticipantOrder = new Map(displayBaseParticipantIds.map((participantId, index) => [participantId, index]));

  const rawMessages: RawSequenceMessage[] = [];
  const extraParticipantOrder = new Map<string, number>();

  for (const [sortIndex, relation] of graph.relations.entries()) {
    if (!relationFilters[relation.type]) continue;
    if (!SEQUENCE_RELATION_TYPES.includes(relation.type)) continue;

    const sourceInternal = findNearestVisibleAncestor(relation.source, baseParticipantSet, ancestorIndex);
    const targetInternal = findNearestVisibleAncestor(relation.target, baseParticipantSet, ancestorIndex);
    const sourceParticipantId = sourceInternal ?? resolveExternalParticipantId(
      relation.source,
      baseParticipantSet,
      hiddenSymbolIds,
      ancestorIndex,
      symbolById,
    );
    const targetParticipantId = targetInternal ?? resolveExternalParticipantId(
      relation.target,
      baseParticipantSet,
      hiddenSymbolIds,
      ancestorIndex,
      symbolById,
    );

    const normalizedSourceParticipantId = normalizeParticipantId(
      sourceParticipantId,
      participantAliases,
      symbolById,
      collapseArtifactsAggressively,
    );
    const normalizedTargetParticipantId = normalizeParticipantId(
      targetParticipantId,
      participantAliases,
      symbolById,
      collapseArtifactsAggressively,
    );

    if (!normalizedSourceParticipantId || !normalizedTargetParticipantId) continue;
    if (!sourceInternal && !targetInternal) continue;

    const sourceSymbol = symbolById.get(relation.source);
    const targetSymbol = symbolById.get(relation.target);
    const evidence = relation.evidence?.[0];
    const descriptor = buildBaseSequenceMessageDescriptor(
      relation,
      sourceSymbol,
      targetSymbol,
      labelsMode,
    );

    rawMessages.push({
      relation,
      sourceParticipantId: normalizedSourceParticipantId,
      targetParticipantId: normalizedTargetParticipantId,
      sourceSymbolId: relation.source,
      targetSymbolId: relation.target,
      label: descriptor.text,
      descriptor,
      file: evidence?.file ?? sourceSymbol?.location?.file ?? targetSymbol?.location?.file ?? "",
      line: evidence?.startLine ?? Number.MAX_SAFE_INTEGER,
      sortIndex,
      isSelfCall: normalizedSourceParticipantId === normalizedTargetParticipantId,
      isCreateMessage: relation.type === "instantiates",
    });

    if (!displayBaseParticipantSet.has(normalizedSourceParticipantId) && !extraParticipantOrder.has(normalizedSourceParticipantId)) {
      extraParticipantOrder.set(normalizedSourceParticipantId, extraParticipantOrder.size);
    }
    if (!displayBaseParticipantSet.has(normalizedTargetParticipantId) && !extraParticipantOrder.has(normalizedTargetParticipantId)) {
      extraParticipantOrder.set(normalizedTargetParticipantId, extraParticipantOrder.size);
    }
  }

  rawMessages.sort((left, right) => {
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    if (left.line !== right.line) return left.line - right.line;
    return left.sortIndex - right.sortIndex;
  });

  const crowdedAliases = buildCrowdedParticipantAliases({
    rawMessages,
    displayBaseParticipantSet,
    symbolById,
  });
  for (const syntheticSymbol of crowdedAliases.syntheticSymbols.values()) {
    symbolById.set(syntheticSymbol.id, syntheticSymbol);
  }
  if (crowdedAliases.participantAliases.size > 0) {
    for (const message of rawMessages) {
      const aliasedSource = crowdedAliases.participantAliases.get(message.sourceParticipantId);
      const aliasedTarget = crowdedAliases.participantAliases.get(message.targetParticipantId);
      if (aliasedSource) {
        message.sourceParticipantId = aliasedSource;
      }
      if (aliasedTarget) {
        message.targetParticipantId = aliasedTarget;
      }
      message.isSelfCall = message.sourceParticipantId === message.targetParticipantId;
    }
  }

  const messages = summarizeSequenceMessages(compactSequenceMessages(rawMessages, labelsMode));
  return buildSequenceProjectionElements({
    view,
    symbolById,
    messages,
    displayBaseParticipantIds,
    extraParticipantOrder,
    selectedSymbolId,
    selectedEdgeId,
  });
}

function buildSequenceProjectionElements(params: SequenceProjectionSeed & {
  view: DiagramView;
  selectedSymbolId: string | null;
  selectedEdgeId: string | null;
}): { nodes: Node[]; edges: Edge[] } {
  const {
    view,
    symbolById,
    messages,
    displayBaseParticipantIds,
    extraParticipantOrder,
    selectedSymbolId,
    selectedEdgeId,
  } = params;
  const participantStats = collectParticipantStats(messages);
  const displayBaseParticipantSet = new Set(displayBaseParticipantIds);
  const baseParticipantOrder = new Map(displayBaseParticipantIds.map((participantId, index) => [participantId, index]));
  const initiatingActorParticipantId = resolveInitiatingActorParticipantId(
    messages,
    symbolById,
    displayBaseParticipantSet,
  );

  const usedParticipantIds = new Set<string>();
  for (const message of messages) {
    usedParticipantIds.add(message.sourceParticipantId);
    usedParticipantIds.add(message.targetParticipantId);
  }

  const sequenceParticipantMeta = new Map<string, SequenceParticipantMeta>();
  const knownParticipantIds = usedParticipantIds.size > 0 ? Array.from(usedParticipantIds) : displayBaseParticipantIds;
  for (const participantId of knownParticipantIds) {
    const symbol = symbolById.get(participantId);
    if (!symbol) continue;
    const displayLabel = shortDisplayName(symbol);
    const isInternalParticipant = isInternalSequenceParticipant(symbol, displayBaseParticipantSet.has(participantId));
    const role = classifyParticipantRole(
      symbol,
      isInternalParticipant,
      participantId === initiatingActorParticipantId,
    );
    const stats = participantStats.get(participantId);
    sequenceParticipantMeta.set(participantId, {
      symbol,
      role,
      laneKind: classifyLaneKind(symbol, isInternalParticipant),
      displayLabel,
      fullLabel: displayLabel === symbol.label ? undefined : symbol.label,
      subtitle: participantSubtitle(symbol, role),
      childViewId: isInternalParticipant ? symbol.childViewId : undefined,
      lifelineOffset: 0,
      firstMessageIndex: stats?.firstMessageIndex ?? Number.MAX_SAFE_INTEGER,
    });
  }

  const orderedParticipantIds = orderParticipants({
    usedParticipantIds,
    sequenceParticipantMeta,
    baseParticipantOrder,
    extraParticipantOrder,
  });

  const participantIndex = new Map(
    orderedParticipantIds.map((participantId, index) => [participantId, index]),
  );

  const participantLayouts = buildSequenceParticipantLayouts(orderedParticipantIds, sequenceParticipantMeta);
  const messageLayouts = buildSequenceMessageLayouts({
    messages,
    participantLayouts,
  });
  for (const participantId of orderedParticipantIds) {
    const meta = sequenceParticipantMeta.get(participantId);
    if (!meta) continue;
    meta.lifelineOffset = resolveLifelineOffset(participantStats.get(participantId), messageLayouts);
  }
  const lastMessageLayout = messageLayouts[messageLayouts.length - 1];
  const lifelineHeight = Math.max(
    MIN_LIFELINE_HEIGHT,
    (lastMessageLayout?.bottom ?? (HEADER_HEIGHT + MESSAGE_Y_OFFSET)) - HEADER_HEIGHT + 58,
  );
  const portsByParticipant = new Map<string, UmlNodeData["dynamicPorts"]>();
  const activationsByParticipant = new Map<string, SequenceActivationBar[]>();

  messages.forEach((message, index) => {
    const layout = messageLayouts[index];
    const sourceIndex = participantIndex.get(message.sourceParticipantId);
    const targetIndex = participantIndex.get(message.targetParticipantId);
    if (sourceIndex == null || targetIndex == null || !layout) return;

    const sourceLayout = participantLayouts.get(message.sourceParticipantId);
    const targetLayout = participantLayouts.get(message.targetParticipantId);
    if (!sourceLayout || !targetLayout) return;

    const y = layout.centerY;
    if (message.isSelfCall) {
      const selfPorts = portsByParticipant.get(message.sourceParticipantId) ?? [];
      selfPorts.push({
        id: `seq-src:${message.id}`,
        x: resolveSequenceLifelineAnchorX(sourceLayout.width, "EAST"),
        y,
        side: "EAST",
        type: "source",
      });
      selfPorts.push({
        id: `seq-tgt:${message.id}`,
        x: resolveSequenceLifelineAnchorX(sourceLayout.width, "EAST", 1),
        y: y + SELF_CALL_VERTICAL_GAP,
        side: "EAST",
        type: "target",
      });
      portsByParticipant.set(message.sourceParticipantId, selfPorts);

      pushActivationBar(
        activationsByParticipant,
        message.sourceParticipantId,
        Math.max(sequenceParticipantMeta.get(message.sourceParticipantId)?.lifelineOffset ?? 0, y - HEADER_HEIGHT - ACTIVATION_HALF_HEIGHT),
        ACTIVATION_HALF_HEIGHT * 2,
      );
      pushActivationBar(
        activationsByParticipant,
        message.sourceParticipantId,
        Math.max(sequenceParticipantMeta.get(message.sourceParticipantId)?.lifelineOffset ?? 0, y - HEADER_HEIGHT - 6),
        ACTIVATION_HALF_HEIGHT * 2 + 10,
        1,
      );
      return;
    }

    const sourceSide = sourceIndex < targetIndex ? "EAST" : "WEST";
    const targetSide = sourceIndex < targetIndex ? "WEST" : "EAST";
    const sourcePorts = portsByParticipant.get(message.sourceParticipantId) ?? [];
    const targetPorts = portsByParticipant.get(message.targetParticipantId) ?? [];
    sourcePorts.push({
      id: `seq-src:${message.id}`,
      x: resolveSequenceLifelineAnchorX(sourceLayout.width, sourceSide),
      y,
      side: sourceSide,
      type: "source",
    });
    targetPorts.push({
      id: `seq-tgt:${message.id}`,
      x: resolveSequenceLifelineAnchorX(targetLayout.width, targetSide),
      y,
      side: targetSide,
      type: "target",
    });
    portsByParticipant.set(message.sourceParticipantId, sourcePorts);
    portsByParticipant.set(message.targetParticipantId, targetPorts);

    pushActivationBar(
      activationsByParticipant,
      message.sourceParticipantId,
      Math.max(sequenceParticipantMeta.get(message.sourceParticipantId)?.lifelineOffset ?? 0, y - HEADER_HEIGHT - ACTIVATION_HALF_HEIGHT),
      ACTIVATION_HALF_HEIGHT * 2,
    );
    pushActivationBar(
      activationsByParticipant,
      message.targetParticipantId,
      Math.max(sequenceParticipantMeta.get(message.targetParticipantId)?.lifelineOffset ?? 0, y - HEADER_HEIGHT - ACTIVATION_HALF_HEIGHT),
      ACTIVATION_HALF_HEIGHT * 2,
    );
  });

  const frameWidth = Math.max(
    480,
    resolveSequenceFrameWidth(orderedParticipantIds, participantLayouts),
  );
  const frameHeight = Math.max(
    260,
    PARTICIPANT_TOP_MARGIN + HEADER_HEIGHT + lifelineHeight + FRAME_BOTTOM_PADDING,
  );

  const nodes: Node[] = [{
    id: `sequence-frame:${view.id}`,
    type: "sequenceFrame",
    draggable: false,
    selectable: false,
    deletable: false,
    position: { x: FRAME_LEFT, y: FRAME_TOP },
    style: { width: frameWidth, height: frameHeight },
    data: {
      label: `sd ${view.title}`,
      kind: "group",
      symbolId: `sequence-frame:${view.id}`,
      sequenceSubtitle: "Static interaction projection",
    } satisfies UmlNodeData,
    className: "sequence-frame-node",
  }];

  nodes.push(...orderedParticipantIds.flatMap((participantId, index) => {
    const meta = sequenceParticipantMeta.get(participantId);
    const layout = participantLayouts.get(participantId);
    if (!meta || !layout) return [];
    return [{
      id: participantId,
      type: "sequenceParticipant",
      selected: participantId === selectedSymbolId,
      draggable: false,
      position: {
        x: layout.x,
        y: PARTICIPANT_TOP_MARGIN,
      },
      style: {
        width: layout.width,
      },
      data: {
        label: meta.displayLabel,
        kind: meta.symbol.kind,
        umlType: meta.symbol.umlType,
        symbolId: participantId,
        childViewId: meta.childViewId,
        location: meta.symbol.location,
        sequenceLaneKind: meta.laneKind,
        sequenceParticipantRole: meta.role,
        sequenceSubtitle: meta.subtitle,
        sequenceFullLabel: meta.fullLabel,
        sequenceParticipantWidth: layout.width,
        sequenceLifelineHeight: lifelineHeight,
        sequenceLifelineOffset: resolveLifelineOffset(participantStats.get(participantId), messageLayouts),
        sequenceActivationBars: mergeActivationBars(activationsByParticipant.get(participantId) ?? []),
        dynamicPorts: portsByParticipant.get(participantId) ?? [],
      } satisfies UmlNodeData,
      className: displayBaseParticipantSet.has(participantId) ? undefined : "sequence-node--outside",
    } satisfies Node];
  }));

  const participantNodeIdSet = new Set(nodes.map((node) => node.id));
  const selectedParticipantId = selectedSymbolId && participantNodeIdSet.has(selectedSymbolId)
    ? selectedSymbolId
    : null;

  const edges: Edge[] = messages.flatMap((message, index) => {
    const layout = messageLayouts[index];
    if (!participantNodeIdSet.has(message.sourceParticipantId) || !participantNodeIdSet.has(message.targetParticipantId)) {
      return [];
    }
    if (!layout) return [];

    const isSelectedConnection = !!selectedParticipantId &&
      (message.sourceParticipantId === selectedParticipantId || message.targetParticipantId === selectedParticipantId);
    const edgeVisibilityClass = selectedParticipantId
      ? isSelectedConnection
        ? " edge-related edge-related--active"
        : " edge-related edge-related--dim"
      : "";

    const sourceIndex = participantIndex.get(message.sourceParticipantId) ?? 0;
    const targetIndex = participantIndex.get(message.targetParticipantId) ?? 0;
    const sourceHandle = `seq-src:${message.id}`;
    const targetHandle = `seq-tgt:${message.id}`;
    const sourcePosition = message.isSelfCall
      ? Position.Right
      : sourceIndex < targetIndex ? Position.Right : Position.Left;
    const targetPosition = message.isSelfCall
      ? Position.Right
      : sourceIndex < targetIndex ? Position.Left : Position.Right;
    const edgeKind = resolveSequenceEdgeKind(message);
    const markerEnd = edgeKind === "async"
      ? { type: MarkerType.Arrow, color: "#334155", width: 16, height: 16 }
      : edgeKind === "create"
        ? { type: MarkerType.ArrowClosed, color: "#e56b6f", width: 18, height: 18 }
        : edgeKind === "self"
          ? { type: MarkerType.ArrowClosed, color: "#475569", width: 16, height: 16 }
          : { type: MarkerType.ArrowClosed, color: "#1f2937", width: 18, height: 18 };
    const label = layout.labelText;

    return [{
      id: message.id,
      source: message.sourceParticipantId,
      target: message.targetParticipantId,
      selected: selectedEdgeId === message.id || (selectedEdgeId !== null && message.relationIds.includes(selectedEdgeId)),
      sourceHandle,
      targetHandle,
      sourcePosition,
      targetPosition,
      type: "elk",
      label,
      animated: false,
      markerEnd,
      className: `sequence-message-edge sequence-message-edge--${edgeKind}${edgeVisibilityClass}`,
      style: { strokeWidth: edgeKind === "create" ? 2 : 1.85 },
      data: {
        relationIds: message.relationIds,
        relationType: message.relationType,
        fallbackEdgeType: "straight",
        hideFallback: false,
        sequenceKind: edgeKind,
        sequenceLabelWidth: layout.labelWidth,
        sequenceLabelLineCount: layout.labelLineCount,
      },
    }];
  });

  return { nodes, edges };
}

function buildStageSequenceProjectionSeed(params: {
  graph: ProjectGraph;
  view: DiagramView;
  visibleViewNodeRefs: string[];
  hiddenSymbolIds: Set<string>;
  symbolById: Map<string, Symbol>;
  relationFilters: Record<RelationType, boolean>;
  labelsMode: DiagramLabelMode;
}): SequenceProjectionSeed | null {
  const {
    graph,
    view,
    visibleViewNodeRefs,
    hiddenSymbolIds,
    symbolById,
    relationFilters,
    labelsMode,
  } = params;

  const stageSymbol = graph.symbols.find((symbol) =>
    symbol.id.startsWith("proc:pkg:") && symbol.childViewId === view.id,
  );
  if (!stageSymbol) return null;
  symbolById.set(stageSymbol.id, stageSymbol);

  const internalNodeSet = new Set(visibleViewNodeRefs.filter((nodeId) => !hiddenSymbolIds.has(nodeId)));
  const messages: SequenceMessage[] = [];
  let sortIndex = 0;

  const processRelations = graph.relations.filter((relation) =>
    relationFilters[relation.type] && SEQUENCE_RELATION_TYPES.includes(relation.type),
  );

  const incoming = processRelations
    .filter((relation) => relation.target === stageSymbol.id)
    .sort(compareSequenceRelationEvidence(symbolById));
  const outgoing = processRelations
    .filter((relation) => relation.source === stageSymbol.id)
    .sort(compareSequenceRelationEvidence(symbolById));

  for (const relation of incoming) {
    messages.push(buildStageProcessSequenceMessage({
      relation,
      stageSymbol,
      symbolById,
      labelsMode,
      sortIndex: sortIndex++,
    }));
  }

  const hasProcessArtifactOutputs = outgoing.some((relation) => isProcessArtifactId(relation.target));
  const groupedInternal = buildGroupedStageMessages({
    graph,
    view,
    stageSymbol,
    internalNodeSet,
    symbolById,
    relationFilters,
    labelsMode,
    skipWrites: hasProcessArtifactOutputs,
  });
  for (const message of groupedInternal) {
    messages.push({ ...message, sortIndex: sortIndex++ });
  }

  for (const relation of outgoing) {
    messages.push(buildStageProcessSequenceMessage({
      relation,
      stageSymbol,
      symbolById,
      labelsMode,
      sortIndex: sortIndex++,
    }));
  }

  const downstreamArtifactMessages = buildDownstreamArtifactMessages({
    processRelations,
    outgoing,
    stageSymbol,
    symbolById,
    labelsMode,
    startSortIndex: sortIndex,
  });
  messages.push(...downstreamArtifactMessages);

  if (messages.length === 0) {
    return null;
  }

  const dedupedMessages = dedupeStageMessages(messages)
    .sort((left, right) => left.sortIndex - right.sortIndex)
    .slice(0, MAX_SEQUENCE_MESSAGES);

  const extraParticipantOrder = new Map<string, number>();
  for (const message of dedupedMessages) {
    for (const participantId of [message.sourceParticipantId, message.targetParticipantId]) {
      if (participantId === stageSymbol.id) continue;
      if (!extraParticipantOrder.has(participantId)) {
        extraParticipantOrder.set(participantId, extraParticipantOrder.size);
      }
    }
  }

  return {
    symbolById,
    messages: dedupedMessages,
    displayBaseParticipantIds: [stageSymbol.id],
    extraParticipantOrder,
  };
}

function buildStageProcessSequenceMessage(params: {
  relation: Relation;
  stageSymbol: Symbol;
  symbolById: Map<string, Symbol>;
  labelsMode: DiagramLabelMode;
  sortIndex: number;
}): SequenceMessage {
  const { relation, stageSymbol, symbolById, labelsMode, sortIndex } = params;
  const sourceSymbol = symbolById.get(relation.source);
  const targetSymbol = symbolById.get(relation.target);
  const descriptor = inferProcessSequenceDescriptor(relation, sourceSymbol, targetSymbol);
  const evidence = relation.evidence?.[0];

  return {
    id: relation.id,
    relationIds: [relation.id],
    relationType: relation.type,
    sourceParticipantId: relation.source,
    targetParticipantId: relation.target,
    sourceSymbolId: relation.source,
    targetSymbolId: relation.target,
    file: evidence?.file ?? sourceSymbol?.location?.file ?? targetSymbol?.location?.file ?? "",
    line: evidence?.startLine ?? Number.MAX_SAFE_INTEGER,
    sortIndex,
    label: pipelineTruncateSequenceMessageLabel(descriptor.text, labelsMode),
    count: 1,
    descriptors: [descriptor],
    signalScore: descriptor.signal,
    isSelfCall: relation.source === relation.target,
    isCreateMessage: relation.type === "instantiates",
  };
}

function buildGroupedStageMessages(params: {
  graph: ProjectGraph;
  view: DiagramView;
  stageSymbol: Symbol;
  internalNodeSet: Set<string>;
  symbolById: Map<string, Symbol>;
  relationFilters: Record<RelationType, boolean>;
  labelsMode: DiagramLabelMode;
  skipWrites: boolean;
}): SequenceMessage[] {
  const {
    graph,
    view,
    stageSymbol,
    internalNodeSet,
    symbolById,
    relationFilters,
    labelsMode,
    skipWrites,
  } = params;

  type GroupSeed = {
    relationType: RelationType;
    sourceParticipantId: string;
    targetParticipantId: string;
    relations: Relation[];
  };

  const groups = new Map<string, GroupSeed>();
  for (const relation of graph.relations) {
    if (!relationFilters[relation.type]) continue;
    if (!["reads", "writes", "instantiates"].includes(relation.type)) continue;
    if (relation.id.startsWith("stub-edge:") || relation.id.startsWith("process-edge:")) continue;

    const sourceInternal = internalNodeSet.has(relation.source);
    const targetInternal = internalNodeSet.has(relation.target);
    if (sourceInternal === targetInternal) continue;

    if (relation.type === "writes" && skipWrites) continue;

    const externalSymbolId = sourceInternal ? relation.target : relation.source;
    const externalSymbol = symbolById.get(externalSymbolId);
    const participantId = resolveStageExternalParticipantId(symbolById, externalSymbolId, externalSymbol, relation.type);

    let sourceParticipantId = stageSymbol.id;
    let targetParticipantId = participantId;
    if (relation.type === "reads" && sourceInternal) {
      sourceParticipantId = participantId;
      targetParticipantId = stageSymbol.id;
    } else if (relation.type === "reads" && targetInternal) {
      sourceParticipantId = participantId;
      targetParticipantId = stageSymbol.id;
    } else if (relation.type === "instantiates") {
      sourceParticipantId = stageSymbol.id;
      targetParticipantId = participantId;
    }

    const groupKey = `${relation.type}:${sourceParticipantId}:${targetParticipantId}`;
    const current = groups.get(groupKey);
    if (current) {
      current.relations.push(relation);
    } else {
      groups.set(groupKey, {
        relationType: relation.type,
        sourceParticipantId,
        targetParticipantId,
        relations: [relation],
      });
    }
  }

  return [...groups.values()]
    .map((group) => buildGroupedStageSequenceMessage({
      group,
      viewTitle: view.title,
      stageSymbol,
      symbolById,
      labelsMode,
    }))
    .filter((message): message is SequenceMessage => !!message);
}

function buildGroupedStageSequenceMessage(params: {
  group: {
    relationType: RelationType;
    sourceParticipantId: string;
    targetParticipantId: string;
    relations: Relation[];
  };
  viewTitle: string;
  stageSymbol: Symbol;
  symbolById: Map<string, Symbol>;
  labelsMode: DiagramLabelMode;
}): SequenceMessage | null {
  const { group, viewTitle, stageSymbol, symbolById, labelsMode } = params;
  const relations = [...group.relations].sort(compareSequenceRelationEvidence(symbolById));
  const firstRelation = relations[0];
  if (!firstRelation) return null;

  const externalSymbolId = group.sourceParticipantId === stageSymbol.id
    ? group.targetParticipantId
    : group.sourceParticipantId;
  const externalSymbol = symbolById.get(externalSymbolId);
  const label = buildGroupedStageLabel({
    relations,
    relationType: group.relationType,
    viewTitle,
    externalSymbol,
    labelsMode,
  });
  const descriptor = createSequenceDescriptor(
    group.relationType === "instantiates"
      ? "Create"
      : group.relationType === "writes"
        ? inferStageWriteAction(viewTitle)
        : "Load",
    label.replace(/^[A-Z][a-z]+\s+/, ""),
    { signal: 5, generic: false },
  );
  const evidence = firstRelation.evidence?.[0];

  return {
    id: firstRelation.id,
    relationIds: relations.map((relation) => relation.id),
    relationType: group.relationType,
    sourceParticipantId: group.sourceParticipantId,
    targetParticipantId: group.targetParticipantId,
    sourceSymbolId: firstRelation.source,
    targetSymbolId: firstRelation.target,
    file: evidence?.file ?? symbolById.get(firstRelation.source)?.location?.file ?? symbolById.get(firstRelation.target)?.location?.file ?? "",
    line: evidence?.startLine ?? Number.MAX_SAFE_INTEGER,
    sortIndex: firstRelation.evidence?.[0]?.startLine ?? Number.MAX_SAFE_INTEGER,
    label,
    count: relations.length,
    descriptors: [descriptor],
    signalScore: descriptor.signal,
    isSelfCall: false,
    isCreateMessage: group.relationType === "instantiates",
  };
}

function buildGroupedStageLabel(params: {
  relations: Relation[];
  relationType: RelationType;
  viewTitle: string;
  externalSymbol: Symbol | undefined;
  labelsMode: DiagramLabelMode;
}): string {
  const { relations, relationType, viewTitle, externalSymbol, labelsMode } = params;
  const meaningful = relations
    .map((relation) => pipelineSanitizeSequenceLabel(relation.label))
    .filter((label) => label.length > 0 && !pipelineIsGenericSequenceLabel(label));
  if (meaningful.length > 0) {
    return pipelineTruncateSequenceMessageLabel(pipelineSummarizeSequenceObjects(meaningful), labelsMode) ?? meaningful[0]!;
  }

  const objects = relations
    .map((relation) => humanizeSequenceObjectLabel(externalSymbol?.label ?? relation.target, relation.type))
    .filter((value): value is string => !!value);
  const objectText = objects.length > 0
    ? pipelineSummarizeSequenceObjects(objects)
    : relationType === "writes"
      ? inferStageOutputObject(viewTitle)
      : "reference data";

  const action = relationType === "instantiates"
    ? "Create"
    : relationType === "writes"
      ? inferStageWriteAction(viewTitle)
      : "Load";
  return pipelineTruncateSequenceMessageLabel(pipelineBuildSequenceText(action, objectText), labelsMode)
    ?? pipelineBuildSequenceText(action, objectText);
}

function buildDownstreamArtifactMessages(params: {
  processRelations: Relation[];
  outgoing: Relation[];
  stageSymbol: Symbol;
  symbolById: Map<string, Symbol>;
  labelsMode: DiagramLabelMode;
  startSortIndex: number;
}): SequenceMessage[] {
  const { processRelations, outgoing, stageSymbol, symbolById, labelsMode, startSortIndex } = params;
  const artifactIds = new Set(outgoing.filter((relation) => isProcessArtifactId(relation.target)).map((relation) => relation.target));
  let offset = 0;
  return processRelations
    .filter((relation) => artifactIds.has(relation.source) && relation.target !== stageSymbol.id)
    .sort(compareSequenceRelationEvidence(symbolById))
    .map((relation) => buildStageProcessSequenceMessage({
      relation,
      stageSymbol,
      symbolById,
      labelsMode,
      sortIndex: startSortIndex + offset++,
    }));
}

function resolveStageExternalParticipantId(
  symbolById: Map<string, Symbol>,
  symbolId: string,
  symbol: Symbol | undefined,
  relationType: RelationType,
): string {
  if (symbolId.startsWith("proc:")) return symbolId;
  const preferredParticipantId = resolveSpecificStageExternalParticipantId(symbolId, symbolById);
  if (preferredParticipantId) {
    return preferredParticipantId;
  }

  const normalized = (symbol?.label ?? symbolId).toLowerCase();
  if (relationType === "writes") {
    return ensureStageBucketSymbol(symbolById, "sequence-stage-bucket:supporting-artifacts", "Supporting Artifacts", "artifact");
  }
  if (normalized.includes("druid") || normalized.includes("mes") || normalized.includes("database") || normalized.includes("sql")) {
    return ensureStageBucketSymbol(symbolById, "sequence-stage-bucket:data-sources", "Datenquellen", "component");
  }
  return ensureStageBucketSymbol(symbolById, "sequence-stage-bucket:data-files", "Data Files", "package");
}

function resolveSpecificStageExternalParticipantId(
  symbolId: string,
  symbolById: Map<string, Symbol>,
): string | null {
  let currentId: string | undefined = symbolId;
  let classCandidateId: string | null = null;
  let depth = 0;

  while (currentId && depth < 12) {
    const candidate = symbolById.get(currentId);
    if (!candidate) break;

    if (
      isArtifactLikeSymbol(candidate) ||
      candidate.kind === "group" ||
      candidate.kind === "package" ||
      candidate.kind === "module" ||
      candidate.umlType === "package"
    ) {
      return currentId;
    }
    if (candidate.kind === "class" && !classCandidateId) {
      classCandidateId = currentId;
    }

    currentId = candidate.parentId;
    depth += 1;
  }

  if (classCandidateId) {
    return classCandidateId;
  }
  return symbolById.has(symbolId) ? symbolId : null;
}

function ensureStageBucketSymbol(
  symbolById: Map<string, Symbol>,
  id: string,
  label: string,
  umlType: Symbol["umlType"],
): string {
  if (!symbolById.has(id)) {
    symbolById.set(id, {
      id,
      label,
      kind: "external",
      umlType,
      tags: ["sequence-stage-bucket"],
    });
  }
  return id;
}

function dedupeStageMessages(messages: SequenceMessage[]): SequenceMessage[] {
  const seen = new Set<string>();
  const deduped: SequenceMessage[] = [];
  for (const message of messages) {
    const key = `${message.sourceParticipantId}|${message.targetParticipantId}|${message.label}|${message.relationType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }
  return deduped;
}

function compareSequenceRelationEvidence(symbolById: Map<string, Symbol>) {
  return (left: Relation, right: Relation) => {
    const leftEvidence = left.evidence?.[0];
    const rightEvidence = right.evidence?.[0];
    const leftFile = leftEvidence?.file ?? symbolById.get(left.source)?.location?.file ?? symbolById.get(left.target)?.location?.file ?? "";
    const rightFile = rightEvidence?.file ?? symbolById.get(right.source)?.location?.file ?? symbolById.get(right.target)?.location?.file ?? "";
    if (leftFile !== rightFile) return leftFile.localeCompare(rightFile);
    const leftLine = leftEvidence?.startLine ?? Number.MAX_SAFE_INTEGER;
    const rightLine = rightEvidence?.startLine ?? Number.MAX_SAFE_INTEGER;
    return leftLine - rightLine;
  };
}

function isProcessArtifactId(symbolId: string): boolean {
  return symbolId.startsWith("proc:artifact");
}

function inferStageWriteAction(viewTitle: string): string {
  const normalized = viewTitle.toLowerCase();
  if (normalized.includes("distribution") || normalized.includes("persistence")) return "Persist";
  if (normalized.includes("simulation")) return "Publish";
  return "Write";
}

function inferStageOutputObject(viewTitle: string): string {
  const normalized = viewTitle.toLowerCase();
  if (normalized.includes("extract")) return "prepared extraction tables";
  if (normalized.includes("matching") || normalized.includes("filter")) return "matching outputs";
  if (normalized.includes("distribution") || normalized.includes("persistence")) return "distribution outputs";
  if (normalized.includes("simulation")) return "simulation outputs";
  return "stage outputs";
}

function buildAncestorIndex(parentMap: Map<string, string | undefined>): Map<string, string[]> {
  const cache = new Map<string, string[]>();

  function visit(symbolId: string): string[] {
    const cached = cache.get(symbolId);
    if (cached) return cached;

    const chain = [symbolId];
    let current = parentMap.get(symbolId);
    let depth = 0;
    while (current && depth < 24) {
      chain.push(current);
      current = parentMap.get(current);
      depth += 1;
    }
    cache.set(symbolId, chain);
    return chain;
  }

  for (const symbolId of parentMap.keys()) {
    visit(symbolId);
  }

  return cache;
}

function findNearestVisibleAncestor(
  symbolId: string,
  visibleIds: Set<string>,
  ancestorIndex: Map<string, string[]>,
): string | null {
  const chain = ancestorIndex.get(symbolId);
  if (!chain) return null;
  for (const ancestorId of chain) {
    if (visibleIds.has(ancestorId)) return ancestorId;
  }
  return null;
}

function resolveExternalParticipantId(
  symbolId: string,
  baseParticipantSet: Set<string>,
  hiddenSymbolIds: Set<string>,
  ancestorIndex: Map<string, string[]>,
  symbolById: Map<string, Symbol>,
): string | null {
  const chain = ancestorIndex.get(symbolId);
  if (!chain) return null;

  let preferredParticipantId: string | null = null;
  for (const ancestorId of chain) {
    if (baseParticipantSet.has(ancestorId)) return null;
    if (hiddenSymbolIds.has(ancestorId)) continue;
    const symbol = symbolById.get(ancestorId);
    if (!symbol) continue;
    if (shouldSkipExternalSequenceSymbol(symbol)) continue;
    if (symbol.kind === "group" || symbol.kind === "package" || symbol.umlType === "package") {
      preferredParticipantId = ancestorId;
      continue;
    }
    if (isArtifactLikeSymbol(symbol) || isStructuralSequenceSymbol(symbol)) {
      preferredParticipantId = ancestorId;
    }
  }

  return preferredParticipantId;
}

function shouldSkipExternalSequenceSymbol(symbol: Symbol): boolean {
  return symbol.id.startsWith("stub:");
}

function buildBaseParticipantAliases(
  baseParticipantIds: string[],
  symbolById: Map<string, Symbol>,
): {
  participantAliases: Map<string, string>;
  syntheticSymbols: Map<string, Symbol>;
  displayBaseParticipantIds: string[];
} {
  const participantAliases = new Map<string, string>();
  const syntheticSymbols = new Map<string, Symbol>();
  const collapsibleArtifactIds = baseParticipantIds.filter((participantId) => {
    const symbol = symbolById.get(participantId);
    return !!symbol && shouldCollapseVisibleArtifactParticipant(symbol);
  });

  if (collapsibleArtifactIds.length > 2) {
    for (const participantId of collapsibleArtifactIds) {
      const symbol = symbolById.get(participantId);
      if (!symbol) continue;
      const syntheticSymbol = buildSyntheticArtifactParticipant(symbol);
      participantAliases.set(participantId, syntheticSymbol.id);
      if (!syntheticSymbols.has(syntheticSymbol.id)) {
        syntheticSymbols.set(syntheticSymbol.id, syntheticSymbol);
      }
    }
  }

  return {
    participantAliases,
    syntheticSymbols,
    displayBaseParticipantIds: dedupeParticipantIds(
      baseParticipantIds.map((participantId) => participantAliases.get(participantId) ?? participantId),
    ),
  };
}

function shouldCollapseVisibleArtifactParticipant(symbol: Symbol): boolean {
  return isArtifactLikeSymbol(symbol) || symbol.kind === "external";
}

function buildSyntheticArtifactParticipant(symbol: Symbol): Symbol {
  const bucket = resolveArtifactBucket(symbol);
  return {
    id: `sequence-bucket:${bucket.id}`,
    label: bucket.label,
    kind: "external",
    umlType: bucket.umlType,
    tags: ["sequence-bucket"],
  };
}

function resolveArtifactBucket(symbol: Symbol): { id: string; label: string; umlType: Symbol["umlType"] } {
  const normalizedLabel = symbol.label.toLowerCase();

  if (normalizedLabel.includes("libraries") || normalizedLabel.includes("imports")) {
    return { id: "libraries-imports", label: "Libraries / Imports", umlType: "package" };
  }
  if (normalizedLabel.includes("data files")) {
    return { id: "data-files", label: "Data Files", umlType: "package" };
  }
  if (normalizedLabel.includes("transform")) {
    return { id: "transformations", label: "Transformations", umlType: "package" };
  }
  if (normalizedLabel.includes("types") || normalizedLabel.includes("models")) {
    return { id: "types-models", label: "Types / Models", umlType: "package" };
  }
  if (normalizedLabel.includes("i/o") || normalizedLabel.includes("operations")) {
    return { id: "io-operations", label: "I/O Operations", umlType: "package" };
  }
  if (symbol.umlType === "database" || /\b(db|sql|database)\b/.test(normalizedLabel)) {
    return { id: "databases", label: "Databases", umlType: "database" };
  }
  if (symbol.umlType === "component" || /\b(api|service|source)\b/.test(normalizedLabel)) {
    return { id: "external-systems", label: "External Systems", umlType: "component" };
  }
  if (/\.(csv|xlsx|xls|tsv)$/.test(normalizedLabel) || normalizedLabel.includes("table") || normalizedLabel.startsWith("df_")) {
    return { id: "tabular-artifacts", label: "Tabular Artifacts", umlType: "artifact" };
  }
  if (normalizedLabel.includes(".json") || normalizedLabel.includes("json")) {
    return { id: "json-artifacts", label: "JSON Artifacts", umlType: "artifact" };
  }
  if (normalizedLabel.includes(".pkl") || normalizedLabel.includes(".pickle") || normalizedLabel.includes(".parquet")) {
    return { id: "binary-artifacts", label: "Binary Artifacts", umlType: "artifact" };
  }

  return { id: "other-artifacts", label: "Other Artifacts", umlType: "artifact" };
}

function dedupeParticipantIds(participantIds: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const participantId of participantIds) {
    if (seen.has(participantId)) continue;
    seen.add(participantId);
    deduped.push(participantId);
  }
  return deduped;
}

function buildCrowdedParticipantAliases(params: {
  rawMessages: RawSequenceMessage[];
  displayBaseParticipantSet: Set<string>;
  symbolById: Map<string, Symbol>;
}): {
  participantAliases: Map<string, string>;
  syntheticSymbols: Map<string, Symbol>;
} {
  const { rawMessages, displayBaseParticipantSet, symbolById } = params;
  const usedParticipantIds = dedupeParticipantIds(rawMessages.flatMap((message) => [
    message.sourceParticipantId,
    message.targetParticipantId,
  ]));

  if (usedParticipantIds.length <= MAX_SEQUENCE_PARTICIPANTS) {
    return { participantAliases: new Map(), syntheticSymbols: new Map() };
  }

  const externalParticipantIds = usedParticipantIds.filter((participantId) => !displayBaseParticipantSet.has(participantId));
  const allowedExternalParticipants = Math.max(1, MAX_SEQUENCE_PARTICIPANTS - displayBaseParticipantSet.size);
  if (externalParticipantIds.length <= allowedExternalParticipants) {
    return { participantAliases: new Map(), syntheticSymbols: new Map() };
  }

  const messageLoad = new Map<string, { count: number; firstIndex: number }>();
  rawMessages.forEach((message, index) => {
    for (const participantId of [message.sourceParticipantId, message.targetParticipantId]) {
      if (displayBaseParticipantSet.has(participantId)) continue;
      const current = messageLoad.get(participantId);
      if (current) {
        current.count += 1;
        current.firstIndex = Math.min(current.firstIndex, index);
      } else {
        messageLoad.set(participantId, { count: 1, firstIndex: index });
      }
    }
  });

  const sortedExternalIds = [...externalParticipantIds].sort((leftId, rightId) => {
    const leftSymbol = symbolById.get(leftId);
    const rightSymbol = symbolById.get(rightId);
    const leftPriority = crowdedParticipantPriority(leftSymbol);
    const rightPriority = crowdedParticipantPriority(rightSymbol);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    const leftLoad = messageLoad.get(leftId);
    const rightLoad = messageLoad.get(rightId);
    const countDiff = (rightLoad?.count ?? 0) - (leftLoad?.count ?? 0);
    if (countDiff !== 0) return countDiff;

    const firstDiff = (leftLoad?.firstIndex ?? Number.MAX_SAFE_INTEGER) - (rightLoad?.firstIndex ?? Number.MAX_SAFE_INTEGER);
    if (firstDiff !== 0) return firstDiff;

    return leftId.localeCompare(rightId);
  });

  const keepExternalCount = Math.max(0, allowedExternalParticipants - 1);
  const keepExternalIds = new Set(sortedExternalIds.slice(0, keepExternalCount));
  const collapsedExternalIds = sortedExternalIds.filter((participantId) => !keepExternalIds.has(participantId));
  if (collapsedExternalIds.length === 0) {
    return { participantAliases: new Map(), syntheticSymbols: new Map() };
  }

  const syntheticSymbol = buildCrowdedSupportParticipant(collapsedExternalIds, symbolById);
  const participantAliases = new Map<string, string>();
  for (const participantId of collapsedExternalIds) {
    participantAliases.set(participantId, syntheticSymbol.id);
  }

  return {
    participantAliases,
    syntheticSymbols: new Map([[syntheticSymbol.id, syntheticSymbol]]),
  };
}

function crowdedParticipantPriority(symbol: Symbol | undefined): number {
  if (!symbol) return 99;
  const normalizedLabel = symbol.label.toLowerCase();

  if (
    symbol.umlType === "database" ||
    symbol.umlType === "component" ||
    normalizedLabel.includes("datenquellen") ||
    normalizedLabel.includes("data source") ||
    normalizedLabel.includes("simulation")
  ) {
    return 0;
  }
  if (normalizedLabel.includes("data files") || normalizedLabel.includes("imports") || normalizedLabel.includes("libraries")) {
    return 1;
  }
  if (normalizedLabel.includes("transform") || normalizedLabel.includes("types") || normalizedLabel.includes("models")) {
    return 2;
  }
  return 3;
}

function buildCrowdedSupportParticipant(
  participantIds: string[],
  symbolById: Map<string, Symbol>,
): Symbol {
  const symbols = participantIds
    .map((participantId) => symbolById.get(participantId))
    .filter((symbol): symbol is Symbol => !!symbol);
  const systemLikeCount = symbols.filter((symbol) => {
    const normalizedLabel = symbol.label.toLowerCase();
    return (
      symbol.umlType === "database" ||
      symbol.umlType === "component" ||
      normalizedLabel.includes("datenquellen") ||
      normalizedLabel.includes("data source") ||
      normalizedLabel.includes("simulation")
    );
  }).length;

  const useSystemsBucket = systemLikeCount >= Math.ceil(symbols.length / 2);
  return {
    id: useSystemsBucket ? "sequence-bucket:supporting-systems" : "sequence-bucket:supporting-artifacts",
    label: useSystemsBucket ? "Supporting Systems" : "Supporting Artifacts",
    kind: "external",
    umlType: useSystemsBucket ? "component" : "artifact",
    tags: ["sequence-bucket", "sequence-crowded"],
  };
}

function normalizeParticipantId(
  participantId: string | null,
  participantAliases: Map<string, string>,
  symbolById: Map<string, Symbol>,
  collapseArtifactsAggressively: boolean,
): string | null {
  if (!participantId) return null;
  const aliasedId = participantAliases.get(participantId) ?? participantId;
  if (!collapseArtifactsAggressively) return aliasedId;

  const symbol = symbolById.get(aliasedId);
  if (!symbol || !shouldCollapseCrowdedSequenceParticipant(symbol)) {
    return aliasedId;
  }

  const syntheticSymbol = buildSyntheticArtifactParticipant(symbol);
  if (!symbolById.has(syntheticSymbol.id)) {
    symbolById.set(syntheticSymbol.id, syntheticSymbol);
  }
  return syntheticSymbol.id;
}

function shouldCollapseCrowdedSequenceParticipant(symbol: Symbol): boolean {
  return shouldCollapseVisibleArtifactParticipant(symbol) || symbol.id.includes(":art-cat:");
}

function isStructuralSequenceSymbol(symbol: Symbol): boolean {
  return (
    symbol.kind === "group" ||
    symbol.kind === "package" ||
    symbol.kind === "module" ||
    symbol.kind === "class" ||
    symbol.kind === "external"
  );
}

function isArtifactLikeSymbol(symbol: Symbol): boolean {
  return (
    symbol.kind === "external" ||
    symbol.umlType === "artifact" ||
    symbol.umlType === "database" ||
    symbol.umlType === "component" ||
    symbol.umlType === "note"
  );
}

function shortDisplayName(symbol: Symbol): string {
  const label = symbol.label.trim();
  if (!label) return symbol.id;
  if (label.includes("/") || label.includes("\\")) {
    const parts = label.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1]?.trim() ?? label;
  }
  if (symbol.kind === "module" || symbol.kind === "class" || symbol.kind === "function" || symbol.kind === "method") {
    const segments = label.split(/[.:]/);
    return segments[segments.length - 1]?.trim() ?? label;
  }
  return label;
}

function participantSubtitle(symbol: Symbol, role: SequenceParticipantRole): string {
  if (role === "actor") return "";
  if (symbol.umlType) return symbol.umlType;
  return symbol.kind;
}

function classifyLaneKind(symbol: Symbol, isInternal: boolean): "internal" | "external" | "artifact" {
  if (isInternal) return "internal";
  if (isArtifactLikeSymbol(symbol)) return "artifact";
  return "external";
}

function resolveInitiatingActorParticipantId(
  messages: SequenceMessage[],
  symbolById: Map<string, Symbol>,
  displayBaseParticipantSet: Set<string>,
): string | null {
  for (const message of messages) {
    const symbol = symbolById.get(message.sourceParticipantId);
    if (!symbol) continue;
    const isInternalParticipant = isInternalSequenceParticipant(
      symbol,
      displayBaseParticipantSet.has(message.sourceParticipantId),
    );
    if (isInternalParticipant) continue;
    if (isArtifactLikeSymbol(symbol)) continue;
    if (symbol.umlType === "database" || symbol.umlType === "component") continue;
    return message.sourceParticipantId;
  }
  return null;
}

function isInternalSequenceParticipant(symbol: Symbol, isVisibleBaseParticipant: boolean): boolean {
  if (!isVisibleBaseParticipant) return false;
  if (isArtifactLikeSymbol(symbol) || symbol.kind === "external") return false;
  return true;
}

function classifyParticipantRole(
  symbol: Symbol,
  isInternal: boolean,
  shouldRenderAsActor = false,
): SequenceParticipantRole {
  if (shouldRenderAsActor) return "actor";
  if (symbol.umlType === "package" || symbol.kind === "group" || symbol.kind === "package") return "package";
  if (symbol.umlType === "database") return "database";
  if (symbol.umlType === "component") return "component";
  if (isArtifactLikeSymbol(symbol)) return "artifact";
  if (!isInternal && symbol.kind === "external") return "actor";
  return "object";
}

function buildBaseSequenceMessageDescriptor(
  relation: Relation,
  sourceSymbol: Symbol | undefined,
  targetSymbol: Symbol | undefined,
  labelsMode: DiagramLabelMode,
): SequenceLabelDescriptor {
  if (labelsMode === "off") {
    return {
      action: "",
      mergeKey: relation.type,
      objectFamily: relation.type,
      signal: 0,
      generic: true,
    };
  }

  const explicitLabel = pipelineSanitizeSequenceLabel(relation.label);
  if (explicitLabel && !pipelineIsGenericSequenceLabel(explicitLabel)) {
    const explicitParts = pipelineSplitSequenceLabel(explicitLabel);
    return {
      action: explicitParts.action,
      object: explicitParts.object,
      text: pipelineTruncateSequenceMessageLabel(explicitLabel, labelsMode),
      mergeKey: explicitParts.mergeKey,
      objectFamily: explicitParts.objectFamily,
      signal: explicitParts.object ? 5 : 4,
      generic: false,
    };
  }

  const inferred = inferProcessAwareSequenceLabelFromRelation(relation, sourceSymbol, targetSymbol);
  const text = pipelineBuildSequenceText(inferred.action, inferred.object);
  return {
    ...inferred,
    text: pipelineTruncateSequenceMessageLabel(text, labelsMode),
  };
}

function pipelineSanitizeSequenceLabel(label: string | null | undefined): string {
  return (label ?? "")
    .replace(/\s+/g, " ")
    .replace(/[_]+/g, " ")
    .trim();
}

function pipelineIsGenericSequenceLabel(label: string): boolean {
  const normalized = pipelineSanitizeSequenceLabel(label).toLowerCase();
  if (!normalized) return true;
  return /^(?:\d+\s*x?\s*)?(?:calls?|reads?|writes?|imports?|instantiates?|creates?|config|uses config|persists?|consumes?)(?:\s+(?:csv|xlsx|xls|json|pickle|pkl))?$/.test(normalized);
}

function pipelineSplitSequenceLabel(label: string): Omit<SequenceLabelDescriptor, "signal" | "generic" | "text"> {
  const normalized = pipelineSanitizeSequenceLabel(label);
  const parts = normalized.match(/^(call|create|load|read|write|persist|apply|hand off|handoff|pass|publish|collect|query|request|consume|use|config)\s+(.+)$/i);
  if (!parts) {
    return {
      action: "",
      object: normalized,
      mergeKey: normalized.toLowerCase(),
      objectFamily: normalizeSequenceObjectFamily(normalized),
    };
  }

  const action = normalizeSequenceAction(parts[1] ?? "");
  const object = pipelineSanitizeSequenceLabel(parts[2]);
  return {
    action,
    object,
    mergeKey: `${action}:${normalizeSequenceObjectFamily(object)}`,
    objectFamily: normalizeSequenceObjectFamily(object),
  };
}

function pipelineTruncateSequenceMessageLabel(label: string | undefined, labelsMode: DiagramLabelMode): string | undefined {
  if (!label) return undefined;
  return truncateLabel(label, labelsMode === "compact" ? 40 : 92);
}

function inferProcessAwareSequenceLabelFromRelation(
  relation: Relation,
  sourceSymbol: Symbol | undefined,
  targetSymbol: Symbol | undefined,
): SequenceLabelDescriptor {
  if (relation.id.startsWith("process-edge:")) {
    return inferProcessSequenceDescriptor(relation, sourceSymbol, targetSymbol);
  }

  const targetLabel = targetSymbol?.label ?? relation.target;
  const sourceLabel = sourceSymbol?.label ?? relation.source;
  const object = humanizeSequenceObjectLabel(targetLabel, relation.type);

  switch (relation.type) {
    case "instantiates":
      return createSequenceDescriptor("Create", object, { signal: 5, generic: false });
    case "reads":
      return createSequenceDescriptor("Load", object || humanizeSequenceObjectLabel(sourceLabel, relation.type), {
        signal: object ? 5 : 3,
        generic: !object,
      });
    case "writes":
      return createSequenceDescriptor(inferWriteAction(targetLabel), object, {
        signal: object ? 5 : 3,
        generic: !object,
      });
    case "uses_config":
      return createSequenceDescriptor("Apply", object || "configuration", {
        signal: object ? 4 : 3,
        generic: !object,
      });
    case "calls":
    default: {
      const action = inferCallAction(targetLabel);
      const fallbackObject = humanizeSequenceObjectLabel(sourceLabel, relation.type);
      return createSequenceDescriptor(action, object || fallbackObject, {
        signal: object ? 4 : 2,
        generic: !object,
      });
    }
  }
}

function inferProcessSequenceDescriptor(
  relation: Relation,
  sourceSymbol: Symbol | undefined,
  targetSymbol: Symbol | undefined,
): SequenceLabelDescriptor {
  const label = pipelineSanitizeSequenceLabel(relation.label);
  const targetId = relation.target;
  const sourceId = relation.source;
  const targetLabel = targetSymbol?.label ?? relation.target;
  const sourceLabel = sourceSymbol?.label ?? relation.source;

  if (sourceId.startsWith("proc:input:database-import")) {
    return createSequenceDescriptor("Import", "database records", { signal: 5, generic: false });
  }
  if (sourceId.startsWith("proc:input:file-imports")) {
    return createSequenceDescriptor("Load", "file imports", { signal: 5, generic: false });
  }
  if (sourceId.startsWith("proc:input:external-sources")) {
    return createSequenceDescriptor("Collect", "external feeds", { signal: 5, generic: false });
  }
  if (relation.id.includes("process-edge:pipeline:")) {
    const object = humanizePipelineFlowObject(label || targetLabel || sourceLabel);
    const action = sourceId.startsWith("proc:pkg:") ? "Hand off" : "Receive";
    return createSequenceDescriptor(action, object, { signal: 5, generic: false });
  }
  if (sourceId.startsWith("proc:artifact") || targetId.startsWith("proc:artifact")) {
    const object = humanizeProcessArtifactObject(label, targetLabel, sourceLabel);
    if (targetId.startsWith("proc:artifact")) {
      return createSequenceDescriptor(inferWriteAction(label || targetLabel), object, { signal: 5, generic: false });
    }
    return createSequenceDescriptor("Load", object, { signal: 5, generic: false });
  }
  if (targetId.startsWith("proc:output:")) {
    return createSequenceDescriptor("Publish", humanizeProcessArtifactObject(label, targetLabel, sourceLabel), {
      signal: 5,
      generic: false,
    });
  }
  if (label && !pipelineIsGenericSequenceLabel(label)) {
    const parts = pipelineSplitSequenceLabel(label);
    return {
      ...parts,
      text: label,
      signal: parts.object ? 5 : 4,
      generic: false,
    };
  }
  return createSequenceDescriptor(
    relation.type === "writes" ? "Write" : relation.type === "reads" ? "Load" : "Hand off",
    humanizePipelineFlowObject(label || targetLabel || sourceLabel),
    { signal: 4, generic: false },
  );
}

function pipelineBuildSequenceText(action: string, object: string | undefined): string {
  if (!object) return action;
  if (!action) return object;
  return `${action} ${object}`;
}

function pipelineShouldMergeSequenceDescriptors(
  relationType: RelationType,
  previous: SequenceLabelDescriptor,
  current: SequenceLabelDescriptor,
): boolean {
  if (previous.mergeKey === current.mergeKey) return true;
  if (relationType === "instantiates") {
    return previous.objectFamily === current.objectFamily;
  }
  if (previous.action === current.action && previous.objectFamily === current.objectFamily) {
    return true;
  }
  return false;
}

function pipelineSummarizeSequenceDescriptors(
  descriptors: SequenceLabelDescriptor[],
  labelsMode: DiagramLabelMode,
): string | undefined {
  const unique = dedupeSequenceDescriptors(descriptors)
    .filter((descriptor) => !!descriptor.text);

  if (unique.length === 0) return undefined;
  if (unique.length === 1) return pipelineTruncateSequenceMessageLabel(unique[0]?.text, labelsMode);

  const commonAction = unique.every((descriptor) => descriptor.action === unique[0]?.action)
    ? unique[0]?.action ?? ""
    : "";
  const objects = unique
    .map((descriptor) => descriptor.object)
    .filter((value): value is string => !!value);

  if (commonAction && objects.length > 0) {
    return pipelineTruncateSequenceMessageLabel(
      pipelineBuildSequenceText(commonAction, pipelineSummarizeSequenceObjects(objects)),
      labelsMode,
    );
  }

  const preview = unique
    .slice(0, 2)
    .map((descriptor) => descriptor.text)
    .filter((value): value is string => !!value)
    .join(" / ");
  const suffix = unique.length > 2 ? ` +${unique.length - 2} more` : "";
  return pipelineTruncateSequenceMessageLabel(`${preview}${suffix}`, labelsMode);
}

function dedupeSequenceDescriptors(descriptors: SequenceLabelDescriptor[]): SequenceLabelDescriptor[] {
  const seen = new Set<string>();
  const deduped: SequenceLabelDescriptor[] = [];
  for (const descriptor of descriptors) {
    const key = descriptor.mergeKey || descriptor.text || `${descriptor.action}:${descriptor.objectFamily}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(descriptor);
  }
  return deduped;
}

function pipelineSummarizeSequenceObjects(objects: string[]): string {
  const unique = Array.from(new Set(objects.map((value) => pipelineSanitizeSequenceLabel(value)).filter(Boolean)));
  if (unique.length === 0) return "multiple steps";
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique[0]}, ${unique[1]} +${unique.length - 2} more`;
}

function createSequenceDescriptor(
  action: string,
  object: string | undefined,
  options: { signal?: number; generic?: boolean } = {},
): SequenceLabelDescriptor {
  const normalizedAction = normalizeSequenceAction(action);
  const normalizedObject = object ? pipelineSanitizeSequenceLabel(object) : undefined;
  return {
    action: normalizedAction,
    object: normalizedObject,
    text: pipelineBuildSequenceText(normalizedAction, normalizedObject),
    mergeKey: `${normalizedAction}:${normalizeSequenceObjectFamily(normalizedObject ?? normalizedAction)}`,
    objectFamily: normalizeSequenceObjectFamily(normalizedObject ?? normalizedAction),
    signal: options.signal ?? (normalizedObject ? 4 : 2),
    generic: options.generic ?? !normalizedObject,
  };
}

function normalizeSequenceAction(action: string): string {
  const normalized = pipelineSanitizeSequenceLabel(action).toLowerCase();
  switch (normalized) {
    case "handoff":
      return "Hand off";
    case "persist":
      return "Persist";
    case "config":
    case "use":
      return "Apply";
    case "call":
      return "Run";
    default:
      return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
  }
}

function normalizeSequenceObjectFamily(value: string): string {
  return pipelineSanitizeSequenceLabel(value).toLowerCase();
}

function inferCallAction(targetLabel: string): string {
  const normalized = pipelineSanitizeSequenceLabel(targetLabel).toLowerCase();
  if (normalized.includes("read csv") || normalized.includes("read excel")) return "Load";
  if (normalized.includes("dataframe")) return "Create";
  if (normalized.includes("to datetime")) return "Normalize";
  if (normalized.includes("astype")) return "Cast";
  if (normalized.includes("connector")) return "Query";
  if (normalized.includes("filter")) return "Apply";
  return "Run";
}

function inferWriteAction(targetLabel: string): string {
  const normalized = pipelineSanitizeSequenceLabel(targetLabel).toLowerCase();
  if (normalized.includes("json") || normalized.includes("pickle") || normalized.includes("persist")) {
    return "Persist";
  }
  if (normalized.includes("result") || normalized.includes("output")) {
    return "Publish";
  }
  return "Write";
}

function humanizePipelineFlowObject(label: string): string {
  const normalized = pipelineSanitizeSequenceLabel(label).toLowerCase();
  if (!normalized) return "pipeline data";
  if (normalized.includes("source records")) return "source records";
  if (normalized.includes("prepared data")) return "prepared data";
  if (normalized.includes("normalized entities")) return "normalized entities";
  if (normalized.includes("matched") || normalized.includes("filtered")) return "matched and filtered data";
  if (normalized.includes("distribution")) return "distribution inputs";
  return normalized.replace(/\//g, " and ");
}

function humanizeProcessArtifactObject(label: string, targetLabel: string, sourceLabel: string): string {
  const combined = `${label} ${targetLabel} ${sourceLabel}`.toLowerCase();
  if (combined.includes("arrival")) return "arrival tables";
  if (combined.includes("simulation")) return "simulation results";
  if (combined.includes("distribution") || combined.includes("kde")) return "distribution outputs";
  if (combined.includes("json")) return "JSON artifacts";
  if (combined.includes("pickle") || combined.includes("pkl")) return "binary artifacts";
  if (combined.includes("csv") || combined.includes("xlsx") || combined.includes("xls")) {
    if (combined.includes("extract")) return "extracted tables";
    return "tabular outputs";
  }
  return humanizeSequenceObjectLabel(targetLabel || sourceLabel, "writes") || "artifacts";
}

function humanizeSequenceObjectLabel(label: string, relationType: RelationType): string | undefined {
  const raw = pipelineSanitizeSequenceLabel(label);
  const normalized = raw.toLowerCase().replace(/\\/g, "/");
  if (!normalized) return undefined;

  if (normalized.includes("material cluster") || normalized.includes("cluster zuordnung")) return "material mapping";
  if (normalized.includes("route")) return "route data";
  if (normalized.includes("wegrezept") || normalized.includes("recipe")) return "recipe data";
  if (normalized.includes("auftrag") || normalized.includes("order")) return "order overview";
  if (normalized.includes("arrival")) return "arrival data";
  if (normalized.includes("simulation")) return "simulation results";
  if (normalized.includes("distribution") || normalized.includes("kde")) return "distribution outputs";
  if (normalized.includes("druid")) return relationType === "instantiates" ? "Druid connector" : "Druid records";
  if (normalized.includes("mes")) return relationType === "instantiates" ? "MES connector" : "MES records";
  if (normalized.includes("dataframe")) return "DataFrame";
  if (normalized.includes("to datetime")) return "timestamps";
  if (normalized.includes("astype")) return "column types";
  if (normalized.includes("filter")) return "filter rules";
  if (/\.(csv|xlsx|xls|tsv)$/.test(normalized) || /\b(csv|xlsx|xls|tsv)\b/.test(normalized)) {
    return relationType === "writes" ? "data files" : "input files";
  }
  if (normalized.includes("json")) return "JSON artifacts";
  if (normalized.includes("pickle") || normalized.includes("pkl")) return "binary artifacts";

  const basename = shortBasename(raw);
  if (!basename) return undefined;
  return basename.replace(/\.[a-z0-9]+$/i, "");
}

function shortBasename(label: string): string {
  const normalized = label.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

function compactSequenceMessages(
  rawMessages: RawSequenceMessage[],
  labelsMode: DiagramLabelMode,
): SequenceMessage[] {
  const compacted: SequenceMessage[] = [];

  for (const message of rawMessages) {
    const previous = compacted[compacted.length - 1];
    if (previous && canMergeSequenceMessages(previous, message)) {
      previous.relationIds.push(message.relation.id);
      previous.count += 1;
      previous.descriptors.push(message.descriptor);
      previous.signalScore = Math.max(previous.signalScore, message.descriptor.signal);
      previous.label = buildCompactedSequenceMessageLabel(previous, labelsMode);
      continue;
    }

    compacted.push({
      id: message.relation.id,
      relationIds: [message.relation.id],
      relationType: message.relation.type,
      sourceParticipantId: message.sourceParticipantId,
      targetParticipantId: message.targetParticipantId,
      sourceSymbolId: message.sourceSymbolId,
      targetSymbolId: message.targetSymbolId,
      file: message.file,
      line: message.line,
      sortIndex: message.sortIndex,
      label: message.label,
      count: 1,
      descriptors: [message.descriptor],
      signalScore: message.descriptor.signal,
      isSelfCall: message.isSelfCall,
      isCreateMessage: message.isCreateMessage,
    });
  }

  return compacted;
}

function canMergeSequenceMessages(previous: SequenceMessage, current: RawSequenceMessage): boolean {
  if (
    previous.sourceParticipantId !== current.sourceParticipantId ||
    previous.targetParticipantId !== current.targetParticipantId ||
    previous.relationType !== current.relation.type ||
    previous.isSelfCall !== current.isSelfCall
  ) {
    return false;
  }

  const previousDescriptor = previous.descriptors[previous.descriptors.length - 1];
  if (!previousDescriptor) return true;
  return pipelineShouldMergeSequenceDescriptors(previous.relationType, previousDescriptor, current.descriptor);
}

function buildCompactedSequenceMessageLabel(
  previous: SequenceMessage,
  labelsMode: DiagramLabelMode,
): string | undefined {
  if (labelsMode === "off") return undefined;
  return pipelineSummarizeSequenceDescriptors(previous.descriptors, labelsMode);
}

function summarizeSequenceMessages(messages: SequenceMessage[]): SequenceMessage[] {
  if (messages.length <= MAX_SEQUENCE_MESSAGES) return messages;

  const selectedIds = new Set<string>();
  const selected: SequenceMessage[] = [];

  const keep = (message: SequenceMessage) => {
    if (selectedIds.has(message.id)) return;
    selectedIds.add(message.id);
    selected.push(message);
  };

  for (const message of messages) {
    if (message.signalScore >= 5) {
      keep(message);
    }
  }

  const seenSelfCalls = new Set<string>();
  for (const message of messages) {
    if (!message.isSelfCall) continue;
    if (seenSelfCalls.has(message.sourceParticipantId)) continue;
    seenSelfCalls.add(message.sourceParticipantId);
    keep(message);
  }

  for (const message of messages) {
    if (message.relationType !== "calls") {
      keep(message);
    }
  }

  const seenCallPairs = new Set<string>();
  for (const message of messages) {
    if (message.relationType !== "calls" || message.isSelfCall) continue;
    const pairKey = `${message.sourceParticipantId}|${message.targetParticipantId}|${message.descriptors[0]?.mergeKey ?? message.id}`;
    if (seenCallPairs.has(pairKey)) continue;
    seenCallPairs.add(pairKey);
    keep(message);
  }

  if (selected.length < MAX_SEQUENCE_MESSAGES) {
    for (const message of messages) {
      if (selectedIds.has(message.id)) continue;
      keep(message);
      if (selected.length >= MAX_SEQUENCE_MESSAGES) break;
    }
  }

  return messages.filter((message) => selectedIds.has(message.id)).slice(0, MAX_SEQUENCE_MESSAGES);
}

function collectParticipantStats(messages: SequenceMessage[]): Map<string, SequenceParticipantStats> {
  const stats = new Map<string, SequenceParticipantStats>();

  const touch = (participantId: string, messageIndex: number, incomingCreate: boolean) => {
    const existing = stats.get(participantId) ?? {
      firstMessageIndex: messageIndex,
      firstInvolvementIndex: messageIndex,
      firstIncomingCreateIndex: null,
    };
    existing.firstMessageIndex = Math.min(existing.firstMessageIndex, messageIndex);
    existing.firstInvolvementIndex = Math.min(existing.firstInvolvementIndex, messageIndex);
    if (incomingCreate) {
      existing.firstIncomingCreateIndex = existing.firstIncomingCreateIndex == null
        ? messageIndex
        : Math.min(existing.firstIncomingCreateIndex, messageIndex);
    }
    stats.set(participantId, existing);
  };

  messages.forEach((message, index) => {
    touch(message.sourceParticipantId, index, false);
    touch(message.targetParticipantId, index, message.isCreateMessage && !message.isSelfCall);
  });

  return stats;
}

function buildSequenceParticipantLayouts(
  orderedParticipantIds: string[],
  metaByParticipant: Map<string, SequenceParticipantMeta>,
): Map<string, SequenceParticipantLayout> {
  const layouts = new Map<string, SequenceParticipantLayout>();
  let currentX = PARTICIPANT_LEFT_MARGIN;

  for (const participantId of orderedParticipantIds) {
    const meta = metaByParticipant.get(participantId);
    if (!meta) continue;
    const width = estimateParticipantWidth(meta);
    layouts.set(participantId, {
      x: currentX,
      width,
      centerX: currentX + width / 2,
    });
    currentX += width + PARTICIPANT_GAP;
  }

  return layouts;
}

function resolveSequenceFrameWidth(
  orderedParticipantIds: string[],
  participantLayouts: Map<string, SequenceParticipantLayout>,
): number {
  const lastParticipantId = orderedParticipantIds[orderedParticipantIds.length - 1];
  if (!lastParticipantId) {
    return PARTICIPANT_LEFT_MARGIN + PARTICIPANT_MIN_WIDTH + FRAME_PADDING_X;
  }
  const lastLayout = participantLayouts.get(lastParticipantId);
  if (!lastLayout) {
    return PARTICIPANT_LEFT_MARGIN + PARTICIPANT_MIN_WIDTH + FRAME_PADDING_X;
  }
  return lastLayout.x + lastLayout.width + FRAME_PADDING_X;
}

function buildSequenceMessageLayouts(params: {
  messages: SequenceMessage[];
  participantLayouts: Map<string, SequenceParticipantLayout>;
}): SequenceMessageLayout[] {
  const { messages, participantLayouts } = params;
  const layouts: SequenceMessageLayout[] = [];
  let currentTop = HEADER_HEIGHT + MESSAGE_Y_OFFSET;

  messages.forEach((message, index) => {
    const sourceLayout = participantLayouts.get(message.sourceParticipantId);
    const targetLayout = participantLayouts.get(message.targetParticipantId);
    const labelText = prefixMessageIndex(index, message.label);
    const labelWidth = resolveSequenceLabelWidth(message, sourceLayout, targetLayout);
    const labelLineCount = estimateWrappedLabelLineCount(labelText, labelWidth);
    const rowHeight = Math.max(
      MESSAGE_ROW_MIN_HEIGHT,
      MESSAGE_ROW_PADDING_Y + labelLineCount * MESSAGE_LABEL_LINE_HEIGHT,
    );
    const centerY = currentTop + rowHeight / 2;
    layouts.push({
      top: currentTop,
      centerY,
      bottom: currentTop + rowHeight,
      height: rowHeight,
      labelWidth,
      labelLineCount,
      labelText,
    });
    currentTop += rowHeight;
  });

  return layouts;
}

function resolveSequenceLabelWidth(
  message: SequenceMessage,
  sourceLayout: SequenceParticipantLayout | undefined,
  targetLayout: SequenceParticipantLayout | undefined,
): number {
  if (!sourceLayout || !targetLayout) {
    return MESSAGE_LABEL_MIN_WIDTH;
  }
  if (message.isSelfCall) {
    return MESSAGE_LABEL_SELF_WIDTH;
  }

  const corridorWidth = Math.abs(targetLayout.centerX - sourceLayout.centerX) - 36;
  return clampNumber(corridorWidth, MESSAGE_LABEL_MIN_WIDTH, MESSAGE_LABEL_MAX_WIDTH);
}

function resolveSequenceLifelineAnchorX(
  layoutWidth: number,
  side: "EAST" | "WEST",
  depth = 0,
): number {
  const centerX = layoutWidth / 2;
  const halfActivationWidth = SEQUENCE_ACTIVATION_WIDTH / 2;
  const nestedOffset = depth * 8;
  return centerX + nestedOffset + (side === "EAST" ? halfActivationWidth : -halfActivationWidth);
}

function estimateWrappedLabelLineCount(label: string | undefined, maxWidth: number): number {
  if (!label?.trim()) return 1;

  const maxCharsPerLine = Math.max(12, Math.floor((maxWidth - 16) / MESSAGE_LABEL_CHAR_WIDTH));
  const normalizedLines = label
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) return 1;

  let totalLines = 0;
  for (const line of normalizedLines) {
    totalLines += estimateLogicalLineCount(line, maxCharsPerLine);
  }

  return clampNumber(totalLines, 1, MESSAGE_LABEL_MAX_LINES);
}

function estimateLogicalLineCount(line: string, maxCharsPerLine: number): number {
  const words = line.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return 1;

  let lines = 1;
  let currentLength = 0;
  for (const word of words) {
    const normalizedWordLength = Math.max(1, Math.ceil(word.length * (/[A-Z]/.test(word) ? 1.04 : 1)));
    if (currentLength === 0) {
      currentLength = normalizedWordLength;
      lines += Math.max(0, Math.ceil(normalizedWordLength / maxCharsPerLine) - 1);
      currentLength = Math.min(currentLength, maxCharsPerLine);
      continue;
    }

    if (currentLength + 1 + normalizedWordLength <= maxCharsPerLine) {
      currentLength += 1 + normalizedWordLength;
      continue;
    }

    lines += 1;
    lines += Math.max(0, Math.ceil(normalizedWordLength / maxCharsPerLine) - 1);
    currentLength = Math.min(normalizedWordLength, maxCharsPerLine);
  }

  return lines;
}

function estimateParticipantWidth(meta: SequenceParticipantMeta): number {
  if (meta.role === "actor") {
    return 108;
  }

  const baseLabel = meta.fullLabel ?? meta.displayLabel;
  const labelLength = baseLabel.trim().length;
  const subtitleLength = meta.subtitle.trim().length;
  const estimated = 88 + Math.max(labelLength * 4.9, subtitleLength * 2.8);
  return clampNumber(Math.round(estimated), PARTICIPANT_MIN_WIDTH, PARTICIPANT_MAX_WIDTH);
}

function resolveLifelineOffset(
  stats: SequenceParticipantStats | undefined,
  messageLayouts: SequenceMessageLayout[],
): number {
  if (!stats || stats.firstIncomingCreateIndex == null) return 0;
  if (stats.firstIncomingCreateIndex !== stats.firstInvolvementIndex) return 0;
  const layout = messageLayouts[stats.firstIncomingCreateIndex];
  if (!layout) return 0;
  return Math.max(0, layout.centerY - HEADER_HEIGHT - 10);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function orderParticipants(params: {
  usedParticipantIds: Set<string>;
  sequenceParticipantMeta: Map<string, SequenceParticipantMeta>;
  baseParticipantOrder: Map<string, number>;
  extraParticipantOrder: Map<string, number>;
}): string[] {
  const { usedParticipantIds, sequenceParticipantMeta, baseParticipantOrder, extraParticipantOrder } = params;
  const candidateIds = usedParticipantIds.size > 0
    ? Array.from(usedParticipantIds)
    : Array.from(sequenceParticipantMeta.keys());

  return candidateIds.sort((left, right) => {
    const leftMeta = sequenceParticipantMeta.get(left);
    const rightMeta = sequenceParticipantMeta.get(right);
    if (!leftMeta || !rightMeta) return left.localeCompare(right);

    const categoryDiff = participantCategoryRank(leftMeta) - participantCategoryRank(rightMeta);
    if (categoryDiff !== 0) return categoryDiff;

    if (leftMeta.firstMessageIndex !== rightMeta.firstMessageIndex) {
      return leftMeta.firstMessageIndex - rightMeta.firstMessageIndex;
    }

    const leftBaseIndex = baseParticipantOrder.get(left);
    const rightBaseIndex = baseParticipantOrder.get(right);
    if (leftBaseIndex != null && rightBaseIndex != null && leftBaseIndex !== rightBaseIndex) {
      return leftBaseIndex - rightBaseIndex;
    }
    if (leftBaseIndex != null && rightBaseIndex == null) return -1;
    if (leftBaseIndex == null && rightBaseIndex != null) return 1;

    const leftExtraIndex = extraParticipantOrder.get(left);
    const rightExtraIndex = extraParticipantOrder.get(right);
    if (leftExtraIndex != null && rightExtraIndex != null && leftExtraIndex !== rightExtraIndex) {
      return leftExtraIndex - rightExtraIndex;
    }

    return leftMeta.displayLabel.localeCompare(rightMeta.displayLabel);
  });
}

function participantCategoryRank(meta: SequenceParticipantMeta): number {
  if (meta.role === "actor") return 0;
  if (meta.laneKind === "internal") return 1;
  if (meta.role === "package") return 2;
  if (meta.role === "component" || meta.role === "database") return 3;
  return 4;
}

function resolveSequenceEdgeKind(message: SequenceMessage): SequenceEdgeKind {
  if (message.isSelfCall) return "self";
  if (message.isCreateMessage) return "create";
  if (message.relationType === "calls") return "sync";
  return "async";
}

function prefixMessageIndex(index: number, label: string | undefined): string | undefined {
  if (!label) return `${index + 1}`;
  return `${index + 1}. ${label}`;
}

function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function pushActivationBar(
  activationsByParticipant: Map<string, SequenceActivationBar[]>,
  participantId: string,
  top: number,
  height: number,
  depth = 0,
) {
  const bars = activationsByParticipant.get(participantId) ?? [];
  bars.push({ top, height, depth });
  activationsByParticipant.set(participantId, bars);
}

function mergeActivationBars(bars: SequenceActivationBar[]): SequenceActivationBar[] {
  if (bars.length <= 1) return bars;

  const byDepth = new Map<number, SequenceActivationBar[]>();
  for (const bar of bars) {
    const depth = bar.depth ?? 0;
    const depthBars = byDepth.get(depth) ?? [];
    depthBars.push(bar);
    byDepth.set(depth, depthBars);
  }

  const merged: SequenceActivationBar[] = [];
  for (const [depth, depthBars] of byDepth.entries()) {
    const sorted = [...depthBars].sort((left, right) => left.top - right.top);
    const localMerged: SequenceActivationBar[] = [sorted[0]!];
    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index]!;
      const previous = localMerged[localMerged.length - 1]!;
      const previousBottom = previous.top + previous.height;
      if (current.top <= previousBottom + ACTIVATION_GAP) {
        previous.height = Math.max(previous.height, current.top + current.height - previous.top);
        continue;
      }
      localMerged.push({ ...current });
    }
    localMerged.forEach((bar) => merged.push({ ...bar, depth }));
  }

  return merged.sort((left, right) =>
    left.top - right.top || (left.depth ?? 0) - (right.depth ?? 0),
  );
}
