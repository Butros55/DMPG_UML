import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useAppStore } from "../store";
import {
  UmlNode,
  UmlClassNode,
  UmlFunctionNode,
  UmlArtifactNode,
  UmlGroupNode,
  SequenceParticipantNode,
  SequenceFrameNode,
} from "./UmlNode";
import { ElkEdge } from "./ElkEdge";
import { SymbolHoverCard } from "./SymbolHoverCard";
import { setHoverInteractionBlocked } from "./hoverCardController";
import { layoutNodes, type EdgeRoute, type PortInfo } from "../layout";
import { exportDiagramAsHtml, exportProjectAsHtml } from "../exportHtml";
import { exportProjectPackage } from "../projectTransfer";
import type { UmlNodeData } from "./UmlNode";
import type { ProjectedEdge, Relation, RelationType, Symbol as Sym } from "@dmpg/shared";
import { projectEdgesForView } from "@dmpg/shared";
import {
  EDGE_ANIMATED_BY_RELATION,
  EDGE_CLASS_BY_RELATION,
  RELATION_VERBS,
  type DiagramArtifactMode,
  type DiagramEdgeType,
  type DiagramLabelMode,
} from "../diagramSettings";
import { resolveArtifactView } from "../artifactVisibility";
import {
  isUmlClassifierSymbol,
  toClassProjectionRelation,
} from "../classDiagramProjection";
import { buildArtifactPreview } from "../artifactPreview";
import { isManagedProcessLayoutViewId } from "../viewNavigation";
import { buildEdgeContextSequenceDiagram, buildPackageSequenceDiagram } from "../sequenceDiagram";
import { edgeMarkerEndForRelation, edgeMarkerStartForRelation } from "../umlMarkers";

const nodeTypes = {
  uml: UmlNode,
  umlClass: UmlClassNode,
  umlFunction: UmlFunctionNode,
  umlArtifact: UmlArtifactNode,
  umlGroup: UmlGroupNode,
  sequenceParticipant: SequenceParticipantNode,
  sequenceFrame: SequenceFrameNode,
};

const edgeTypes = {
  elk: ElkEdge,
};

const proOptions = { hideAttribution: true };

/**
 * UML-compliant SVG marker definitions.
 *
 * React Flow only ships plain arrow + closed arrow markers, which is not
 * enough for a real UML class diagram. This component renders a hidden SVG
 * whose `<defs>` contain the shapes UML needs: a hollow triangle for
 * inheritance/realization, hollow and filled diamonds for aggregation /
 * composition, an open "V" arrowhead for dependencies, and a solid arrow for
 * instantiation. Plain associations intentionally have no marker.
 *
 * Edges reference these markers via `url(#uml-...-...)` in markerEnd/markerStart.
 */
function UmlMarkerDefs() {
  return (
    <svg
      aria-hidden
      width={0}
      height={0}
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {/* Hollow triangle — generalization / inheritance. */}
        <marker
          id="uml-inherits-triangle"
          viewBox="0 0 14 14"
          refX="13"
          refY="7"
          markerWidth="14"
          markerHeight="14"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L13,7 L1,13 z" fill="#ffffff" stroke="#d6b14d" strokeWidth="1.4" />
        </marker>

        {/* Hollow triangle — realization (interface implementation). */}
        <marker
          id="uml-realizes-triangle"
          viewBox="0 0 14 14"
          refX="13"
          refY="7"
          markerWidth="14"
          markerHeight="14"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L13,7 L1,13 z" fill="#ffffff" stroke="#8da0ff" strokeWidth="1.4" />
        </marker>

        {/* Hollow diamond — aggregation. */}
        <marker
          id="uml-aggregation-diamond"
          viewBox="0 0 18 10"
          refX="17"
          refY="5"
          markerWidth="18"
          markerHeight="10"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,5 L9,1 L17,5 L9,9 z" fill="#ffffff" stroke="#a79df0" strokeWidth="1.4" />
        </marker>

        {/* Filled diamond — composition. */}
        <marker
          id="uml-composition-diamond"
          viewBox="0 0 18 10"
          refX="17"
          refY="5"
          markerWidth="18"
          markerHeight="10"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,5 L9,1 L17,5 L9,9 z" fill="#a79df0" stroke="#a79df0" strokeWidth="1.4" />
        </marker>

        {/* Open stick arrow — dependency / uses. */}
        <marker
          id="uml-dependency-arrow"
          viewBox="0 0 14 14"
          refX="12"
          refY="7"
          markerWidth="14"
          markerHeight="14"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M1,1 L12,7 L1,13"
            fill="none"
            stroke="#8a94b0"
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </marker>

        {/* Solid closed arrow — instantiates. */}
        <marker
          id="uml-instantiates-arrow"
          viewBox="0 0 12 12"
          refX="11"
          refY="6"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L11,6 L1,11 z" fill="#6c8cff" stroke="#6c8cff" strokeWidth="1" />
        </marker>
      </defs>
    </svg>
  );
}

const INPUT_ARTIFACT_MODE_ORDER: DiagramArtifactMode[] = ["hidden", "grouped", "individual"];
const ARTIFACT_MODE_ORDER: DiagramArtifactMode[] = ["hidden", "grouped", "individual"];
const OUTPUT_ARTIFACT_MODE_TEXT: Record<DiagramArtifactMode, string> = {
  hidden: "Aus",
  grouped: "Gruppiert",
  individual: "Einzeln",
};
const INPUT_ARTIFACT_MODE_TEXT: Record<DiagramArtifactMode, string> = {
  hidden: "Aus",
  grouped: "Gruppiert",
  individual: "Einzeln",
};

function nextArtifactMode(
  currentMode: DiagramArtifactMode,
  order: readonly DiagramArtifactMode[],
): DiagramArtifactMode {
  const currentIndex = order.indexOf(currentMode);
  return order[(currentIndex + 1) % order.length] ?? order[0] ?? "grouped";
}

function artifactControlLabel(
  prefix: string,
  mode: DiagramArtifactMode,
  labels: Record<DiagramArtifactMode, string>,
): string {
  return `${prefix}: ${labels[mode]}`;
}

function positionFromHandle(handle: string): Position {
  const normalized = handle.toLowerCase();
  if (normalized.includes("right") || normalized.includes("east")) return Position.Right;
  if (normalized.includes("left") || normalized.includes("west")) return Position.Left;
  if (normalized.includes("north") || normalized.includes("top")) return Position.Top;
  if (normalized.includes("south") || normalized.includes("bottom")) return Position.Bottom;
  return Position.Bottom;
}

/** Attach layout geometry onto edges.
 *  Dynamic handles are still kept disabled for stability, but routed ELK
 *  paths can be attached and rendered via the custom "elk" edge type. */
function withLayoutGeometry(
  edges: Edge[],
  _handleMap: Map<string, { sourceHandle: string; targetHandle: string }>,
  routeMap: Map<string, EdgeRoute>,
  useElkRoutes: boolean,
  fallbackEdgeType: DiagramEdgeType,
  hideFallback = false,
): Edge[] {
  return edges.map((edge) => {
    const elkRoute = useElkRoutes ? routeMap.get(edge.id) : undefined;
    return {
      ...edge,
      type: useElkRoutes ? "elk" : fallbackEdgeType,
      data: {
        ...(edge.data as Record<string, unknown> | undefined),
        elkRoute,
        fallbackEdgeType,
        hideFallback: useElkRoutes && hideFallback,
      },
    };
  });
}

/** Attach dynamic port data from layout result onto node.data */
function attachDynamicPorts(
  nodes: Node[],
  portsByNode: Map<string, PortInfo[]>,
): Node[] {
  return nodes.map((n) => {
    const ports = portsByNode.get(n.id) ?? [];
    const nextData = { ...(n.data as Record<string, unknown>) };
    if (ports.length > 0) {
      nextData.dynamicPorts = ports;
    } else if ("dynamicPorts" in nextData) {
      delete nextData.dynamicPorts;
    }
    return {
      ...n,
      data: nextData,
    };
  });
}

type PreparedProjectedEdge = {
  key: string;
  source: string;
  target: string;
  type: RelationType;
  count: number;
  label?: string;
  relationIds: string[];
  className: string;
  animated: boolean;
  confidence: number;
  typeCounts: Partial<Record<RelationType, number>>;
  /** UML multiplicity/role annotations (class-diagram mode). */
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceRole?: string;
  targetRole?: string;
};

function toTypeCounts(
  relationIds: string[],
  relationMap: Map<string, Relation>,
): Partial<Record<RelationType, number>> {
  const counts: Partial<Record<RelationType, number>> = {};
  for (const relationId of relationIds) {
    const rel = relationMap.get(relationId);
    if (!rel) continue;
    counts[rel.type] = (counts[rel.type] ?? 0) + 1;
  }
  return counts;
}

function dominantType(
  typeCounts: Partial<Record<RelationType, number>>,
  fallback: RelationType,
): RelationType {
  let best = fallback;
  let bestCount = -1;
  for (const [type, count] of Object.entries(typeCounts) as Array<[RelationType, number]>) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

function edgeLabelForMode(
  mode: DiagramLabelMode,
  typeCounts: Partial<Record<RelationType, number>>,
  totalCount: number,
  dominant: RelationType,
  fallbackLabel?: string,
): string | undefined {
  if (mode === "off") return undefined;

  const entries = Object.entries(typeCounts)
    .filter((entry): entry is [RelationType, number] => entry[1] > 0);
  if (entries.length === 0) return undefined;

  if (mode === "compact") {
    if (totalCount > 1) return `${totalCount}x`;
    return RELATION_VERBS[dominant] ?? dominant;
  }

  if (totalCount === 1) {
    return fallbackLabel?.trim() || RELATION_VERBS[dominant] || dominant;
  }

  if (entries.length === 1) {
    return `${totalCount}x ${RELATION_VERBS[dominant] ?? dominant}`;
  }

  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count}x ${RELATION_VERBS[type] ?? type}`)
    .join(", ");
}

function toPreparedEdges(
  projected: ProjectedEdge[],
  relationMap: Map<string, Relation>,
  relationFilters: Record<RelationType, boolean>,
  labelsMode: DiagramLabelMode,
  aggregate: boolean,
): PreparedProjectedEdge[] {
  const prepared: PreparedProjectedEdge[] = [];

  for (const pe of projected) {
    const visibleRelationIds = pe.relationIds.filter((relationId) => {
      const rel = relationMap.get(relationId);
      return !!rel && relationFilters[rel.type];
    });
    if (visibleRelationIds.length === 0) continue;

    if (!aggregate) {
      for (const relationId of visibleRelationIds) {
        const rel = relationMap.get(relationId);
        if (!rel) continue;
        const typeCounts: Partial<Record<RelationType, number>> = { [rel.type]: 1 };
        prepared.push({
          key: `${pe.source}|${pe.target}|${rel.type}|${relationId}`,
          source: pe.source,
          target: pe.target,
          type: rel.type,
          count: 1,
          relationIds: [relationId],
          className: EDGE_CLASS_BY_RELATION[rel.type],
          animated: EDGE_ANIMATED_BY_RELATION[rel.type],
          label: edgeLabelForMode(labelsMode, typeCounts, 1, rel.type, rel.label),
          confidence: rel.confidence ?? pe.confidence ?? 1,
          typeCounts,
          sourceMultiplicity: rel.sourceMultiplicity,
          targetMultiplicity: rel.targetMultiplicity,
          sourceRole: rel.sourceRole,
          targetRole: rel.targetRole,
        });
      }
      continue;
    }

    const typeCounts = toTypeCounts(visibleRelationIds, relationMap);
    const dominant = dominantType(typeCounts, pe.type);
    const typeEntryCount = Object.values(typeCounts).filter(Boolean).length;
    const lowConfidenceClass = (pe.confidence ?? 1) < 0.9 ? " edge-low-confidence" : "";
    const multiClass = typeEntryCount > 1 ? " edge-multi" : "";
    const animated = Object.entries(typeCounts).some(([type, count]) =>
      (count ?? 0) > 0 && EDGE_ANIMATED_BY_RELATION[type as RelationType],
    );

    prepared.push({
      key: pe.key,
      source: pe.source,
      target: pe.target,
      type: dominant,
      count: visibleRelationIds.length,
      relationIds: visibleRelationIds,
      className: `${EDGE_CLASS_BY_RELATION[dominant]}${multiClass}${lowConfidenceClass}`,
      animated,
      label: edgeLabelForMode(labelsMode, typeCounts, visibleRelationIds.length, dominant, pe.label),
      confidence: pe.confidence ?? 1,
      typeCounts,
      sourceMultiplicity: pe.sourceMultiplicity,
      targetMultiplicity: pe.targetMultiplicity,
      sourceRole: pe.sourceRole,
      targetRole: pe.targetRole,
    });
  }

  return prepared;
}

function neighborhoodNodeIds(rootId: string, edges: PreparedProjectedEdge[], depth: number): Set<string> {
  const seen = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);

  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.source) && !seen.has(edge.target)) {
        seen.add(edge.target);
        next.add(edge.target);
      }
      if (frontier.has(edge.target) && !seen.has(edge.source)) {
        seen.add(edge.source);
        next.add(edge.source);
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  return seen;
}

function clearScheduledTimeout(ref: { current: ReturnType<typeof setTimeout> | null }) {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

function clearScheduledFrame(ref: { current: number | null }) {
  if (ref.current !== null) {
    cancelAnimationFrame(ref.current);
    ref.current = null;
  }
}

function resolveManualLayoutState(params: {
  autoLayout: boolean;
  currentViewId: string | null;
  currentViewIgnoresManualLayout: boolean;
  view: { manualLayout?: boolean } | null;
  manualLayoutViewIds: Set<string>;
}) {
  const manualLayoutAllowed = !params.autoLayout && !params.currentViewIgnoresManualLayout;
  const persistedManualLayout = manualLayoutAllowed && !!params.view?.manualLayout;
  const localManualLayoutOverride =
    manualLayoutAllowed &&
    !!params.currentViewId &&
    params.manualLayoutViewIds.has(params.currentViewId);

  return {
    persistedManualLayout,
    localManualLayoutOverride,
    effectiveManualLayout: persistedManualLayout || localManualLayoutOverride,
  };
}

function summarizeRouteReason(params: {
  autoLayout: boolean;
  effectiveManualLayout: boolean;
  routeMode: "elk" | "fallback" | "mixed" | "none";
  edgeCount: number;
  elkRouteCount: number;
  layoutReady: boolean;
  layoutError: string | null;
}): string {
  if (params.edgeCount === 0) return "no edges in current view";
  if (!params.autoLayout) {
    return params.effectiveManualLayout ? "manual layout active" : "auto-layout disabled";
  }
  if (params.layoutError) return "ELK layout failed";
  if (!params.layoutReady || params.routeMode === "none") return "waiting for ELK layout";
  if (params.routeMode === "elk") return "ELK routing active";
  if (params.routeMode === "mixed") return `ELK routes incomplete (${params.elkRouteCount}/${params.edgeCount})`;
  if (params.routeMode === "fallback") return "ELK route data unavailable";
  return "waiting for ELK layout";
}

export function Canvas() {
  const graph = useAppStore((s) => s.graph);
  const scanStatus = useAppStore((s) => s.scanStatus);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const projectionMode = useAppStore((s) => s.projectionMode);
  const sequenceContext = useAppStore((s) => s.sequenceContext);
  const reviewHighlight = useAppStore((s) => s.reviewHighlight);
  const clearReviewHighlight = useAppStore((s) => s.clearReviewHighlight);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const openSequenceContext = useAppStore((s) => s.openSequenceContext);
  const viewUiSnapshots = useAppStore((s) => s.viewUiSnapshots);
  const viewRestoreViewId = useAppStore((s) => s.viewRestoreViewId);
  const viewRestoreSeq = useAppStore((s) => s.viewRestoreSeq ?? 0);
  const addSymbolToGraph = useAppStore((s) => s.addSymbolToGraph);
  const addRelation = useAppStore((s) => s.addRelation);
  const updateRelation = useAppStore((s) => s.updateRelation);
  const updateRelations = useAppStore((s) => s.updateRelations);
  const removeSymbol = useAppStore((s) => s.removeSymbol);
  const removeRelations = useAppStore((s) => s.removeRelations);
  const removeRelation = useAppStore((s) => s.removeRelation);
  const saveNodePositions = useAppStore((s) => s.saveNodePositions);
  const clearManualLayoutFlags = useAppStore((s) => s.clearManualLayoutFlags);
  const diagramSettings = useAppStore((s) => s.diagramSettings);
  const layoutVersion = useAppStore((s) => s.diagramLayoutVersion);
  const updateDiagramSettings = useAppStore((s) => s.updateDiagramSettings);
  const isAutoLayoutActive = diagramSettings.autoLayout;
  const nodesDraggable = !isAutoLayoutActive;
  const scanProgressText = scanStatus.total && scanStatus.current
    ? `${scanStatus.current}/${scanStatus.total} LLM-Batches`
    : scanStatus.phase;
  const showScanLoadingOverlay = scanStatus.running;
  const showScanIdleOverlay = !graph && !scanStatus.running && !!scanStatus.projectPath;
  const scanWarnings = scanStatus.warnings ?? [];

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const [layoutPass, setLayoutPass] = useState(0); // reactive mirror of layoutPassRef for effects
  const reactFlowInstance = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodesInitialized = useNodesInitialized();
  const layoutRef = useRef(false);
  const layoutPassRef = useRef(0); // 0 = idle, 1 = first pass done, 2 = second pass done
  const prevLayoutKeyRef = useRef<string>("");
  const layoutFingerprintRef = useRef<string>("");
  const layoutRunIdRef = useRef(0);
  const lastResolvedLayoutVersionRef = useRef(layoutVersion);
  const lastLayoutTriggerRef = useRef<string>("initial");
  const lastElkErrorRef = useRef<string | null>(null);
  const prevLayoutFingerprintPartsRef = useRef<{
    viewId: string | null;
    autoLayout: boolean;
    nodeFingerprint: string;
    edgeFingerprint: string;
  } | null>(null);
  const manualLayoutViewIdsRef = useRef<Set<string>>(new Set());
  const suppressNextGraphResetRef = useRef(false);
  const appliedViewRestoreSeqRef = useRef(0);
  const appliedViewFitSeqRef = useRef(0);
  const firstPassFitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secondPassFitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusApplyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewFitFrameRef = useRef<number | null>(null);
  const viewRestoreFrameRef = useRef<number | null>(null);
  const viewFitFrameRef = useRef<number | null>(null);
  const viewportPersistTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const currentViewSnapshot = currentViewId ? viewUiSnapshots[currentViewId] ?? null : null;
  const pendingRestoreForCurrentView =
    !!currentViewId &&
    viewRestoreViewId === currentViewId &&
    viewRestoreSeq > appliedViewRestoreSeqRef.current;
  const persistCurrentViewport = useCallback((expectedViewId?: string | null) => {
    const liveState = useAppStore.getState();
    const liveCurrentViewId = liveState.currentViewId;
    if (!liveCurrentViewId) return;
    if (expectedViewId && expectedViewId !== liveCurrentViewId) return;
    const viewport = reactFlowInstance.getViewport();
    liveState.saveCurrentViewSnapshot({
      viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    });
  }, [reactFlowInstance]);
  const scheduleViewportPersist = useCallback((delayMs: number, expectedViewId: string | null = currentViewId) => {
    if (!expectedViewId) return;
    const timer = setTimeout(() => {
      viewportPersistTimersRef.current.delete(timer);
      persistCurrentViewport(expectedViewId);
    }, delayMs);
    viewportPersistTimersRef.current.add(timer);
  }, [currentViewId, persistCurrentViewport]);

  const canApplyLayoutResult = useCallback((expectedViewId: string | null, layoutRunId: number, layoutKey?: string) => {
    if (!expectedViewId) return false;
    if (layoutRunId !== layoutRunIdRef.current) return false;
    if (useAppStore.getState().currentViewId !== expectedViewId) return false;
    if (layoutKey && prevLayoutKeyRef.current !== layoutKey) return false;
    return true;
  }, []);

  useEffect(() => {
    return () => {
      clearScheduledTimeout(firstPassFitTimeoutRef);
      clearScheduledTimeout(secondPassFitTimeoutRef);
      clearScheduledTimeout(focusApplyTimeoutRef);
      clearScheduledTimeout(focusHighlightTimeoutRef);
      clearScheduledFrame(reviewFitFrameRef);
      clearScheduledFrame(viewRestoreFrameRef);
      clearScheduledFrame(viewFitFrameRef);
      for (const timer of viewportPersistTimersRef.current) {
        clearTimeout(timer);
      }
      viewportPersistTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (suppressNextGraphResetRef.current) {
      suppressNextGraphResetRef.current = false;
      return;
    }
    manualLayoutViewIdsRef.current.clear();
    setIsNodeDragActive(false);
  }, [graph]);

  useEffect(() => {
    if (!isAutoLayoutActive) return;
    manualLayoutViewIdsRef.current.clear();
    setIsNodeDragActive(false);
  }, [isAutoLayoutActive]);

  useEffect(() => {
    if (!isAutoLayoutActive || !graph) return;
    const hasPersistedManualLayout = graph.views.some(
      (view) => !!view.manualLayout && !isManagedProcessLayoutViewId(view.id),
    );
    if (!hasPersistedManualLayout) return;
    clearManualLayoutFlags();
  }, [clearManualLayoutFlags, graph, isAutoLayoutActive]);

  // Dynamic port handle mapping from ELK layout (persists across layout passes)
  const edgeHandlesRef = useRef<Map<string, { sourceHandle: string; targetHandle: string }>>(new Map());
  const edgeRoutesRef = useRef<Map<string, EdgeRoute>>(new Map());

  const dynamicPortState = useMemo(() => {
    const nodeIds: string[] = [];
    const signatureParts: string[] = [];

    for (const node of nodes) {
      const ports = (node.data as UmlNodeData).dynamicPorts ?? [];
      if (ports.length === 0) continue;
      nodeIds.push(node.id);
      signatureParts.push(
        `${node.id}:${ports
          .map((port) => `${port.id}:${port.side}:${port.type}:${port.x.toFixed(1)}:${port.y.toFixed(1)}`)
          .join(",")}`,
      );
    }

    signatureParts.sort();
    nodeIds.sort();
    return {
      nodeIds,
      signature: signatureParts.join("|"),
    };
  }, [nodes]);

  useEffect(() => {
    if (dynamicPortState.nodeIds.length === 0) return;
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(dynamicPortState.nodeIds);
    });
    return () => cancelAnimationFrame(frame);
  }, [dynamicPortState.signature, updateNodeInternals]);

  // Node hover highlighting — dims unrelated edges
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [isNodeDragActive, setIsNodeDragActive] = useState(false);

  const currentView = useMemo(
    () => (graph && currentViewId ? graph.views.find((view) => view.id === currentViewId) ?? null : null),
    [graph, currentViewId],
  );
  const isSequenceView = useMemo(() => projectionMode === "sequence", [projectionMode]);
  const currentViewPersistedViewport = isSequenceView ? null : currentViewSnapshot?.viewport ?? null;
  const currentViewIgnoresManualLayout = useMemo(
    () => !!currentViewId && (isManagedProcessLayoutViewId(currentViewId) || isSequenceView),
    [currentViewId, isSequenceView],
  );

  // AI analysis highlight
  const aiHighlightId = useAppStore((s) => s.aiAnalysis?.highlightSymbolId ?? null);
  const highlightSeq = useAppStore((s) => s.aiAnalysis?.highlightSeq ?? 0);
  const aiRunning = useAppStore((s) => s.aiAnalysis?.running ?? false);
  const aiPhase = useAppStore((s) => s.aiAnalysis?.phase ?? "");
  const aiThought = useAppStore((s) => s.aiAnalysis?.thought ?? null);
  const aiWorkingSymbolId = useAppStore((s) => s.aiAnalysis?.aiWorkingSymbolId ?? null);
  const aiNavPaused = useAppStore((s) => s.aiAnalysis?.navPaused ?? false);
  const acknowledgeAiNavigationSettled = useAppStore((s) => s.acknowledgeAiNavigationSettled);

  // Edge label editing state
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState("");
  const [editingEdgePos, setEditingEdgePos] = useState<{ x: number; y: number } | null>(null);
  const [editingRelationIds, setEditingRelationIds] = useState<string[]>([]);

  // Connect type dialog state
  const [connectDialog, setConnectDialog] = useState<{ source: string; target: string } | null>(null);
  const [connectType, setConnectType] = useState<string>("calls");
  const CONNECT_TYPES = [
    "imports",
    "contains",
    "calls",
    "reads",
    "writes",
    "inherits",
    "uses_config",
    "instantiates",
    "association",
    "aggregation",
    "composition",
  ] as const;
  const cycleInputArtifactMode = useCallback(() => {
    updateDiagramSettings({
      inputArtifactMode: nextArtifactMode(diagramSettings.inputArtifactMode, INPUT_ARTIFACT_MODE_ORDER),
    });
  }, [diagramSettings.inputArtifactMode, updateDiagramSettings]);
  const cycleGeneratedArtifactMode = useCallback(() => {
    updateDiagramSettings({
      generatedArtifactMode: nextArtifactMode(diagramSettings.generatedArtifactMode, ARTIFACT_MODE_ORDER),
    });
  }, [diagramSettings.generatedArtifactMode, updateDiagramSettings]);

  useEffect(() => {
    return () => {
      setHoverInteractionBlocked(false);
    };
  }, []);

  // Build nodes/edges from current view using edge projection
  const { viewNodes, viewEdges, renderMode } = useMemo(() => {
    if (!graph || !currentViewId) {
      return { viewNodes: [] as Node[], viewEdges: [] as Edge[], renderMode: "standard" as const };
    }

    const view = graph.views.find((v) => v.id === currentViewId);
    if (!view) {
      return { viewNodes: [] as Node[], viewEdges: [] as Edge[], renderMode: "standard" as const };
    }

    const scope = (view as any).scope as string | undefined;
    const resolvedArtifactView = resolveArtifactView(graph, view, {
      input: diagramSettings.inputArtifactMode,
      generated: diagramSettings.generatedArtifactMode,
    });
    const symbolOverrides = resolvedArtifactView.symbolOverrides;
    const hiddenSymbolIds = resolvedArtifactView.hiddenSymbolIds;
    // Projection mode is explicitly controlled by the UI switch.
    const isExplicitSequenceProjection = projectionMode === "sequence";
    const isClassProjection = projectionMode === "class";

    // In UML class mode, keep UML classifiers only: real classes/interfaces and
    // module classifiers. Functions and methods render inside compartments.
    const symbolById = new Map<string, Sym>();
    for (const sym of graph.symbols) symbolById.set(sym.id, sym);
    const isUmlClassifierSymbolId = (id: string): boolean => {
      return isUmlClassifierSymbol(symbolById.get(id));
    };

    const baseVisibleNodeRefs = resolvedArtifactView.nodeRefs.filter((id) => !hiddenSymbolIds.has(id));
    const visibleViewNodeRefs = isClassProjection
      ? baseVisibleNodeRefs.filter(isUmlClassifierSymbolId)
      : baseVisibleNodeRefs;
    const visibleViewNodeRefSet = new Set(visibleViewNodeRefs);

    // For class diagrams, Python calls/imports are displayed as UML dependencies.
    const visibleRelations = resolvedArtifactView.relations
      .filter((rel) => !hiddenSymbolIds.has(rel.source) && !hiddenSymbolIds.has(rel.target))
      .map((rel) => isClassProjection ? toClassProjectionRelation(rel) : rel)
      .filter((rel): rel is Relation => Boolean(rel));
    const relationMap = new Map(visibleRelations.map((rel) => [rel.id, rel]));

    if (isExplicitSequenceProjection) {
      const sequenceDiagram =
        sequenceContext && sequenceContext.originViewId === view.id
          ? buildEdgeContextSequenceDiagram({
              graph,
              view,
              sourceSymbolId: sequenceContext.sourceSymbolId,
              targetSymbolId: sequenceContext.targetSymbolId,
              relationFilters: diagramSettings.relationFilters,
              labelsMode: diagramSettings.labels,
              selectedSymbolId,
              selectedEdgeId,
            })
          : buildPackageSequenceDiagram({
              graph,
              view,
              visibleViewNodeRefs,
              hiddenSymbolIds,
              symbolOverrides,
              relationFilters: diagramSettings.relationFilters,
              labelsMode: diagramSettings.labels,
              selectedSymbolId,
              selectedEdgeId,
            });
      return {
        viewNodes: sequenceDiagram.nodes,
        viewEdges: sequenceDiagram.edges,
        renderMode: "sequence" as const,
      };
    }

    const badgeRelations = visibleRelations;
    const persistentReviewNodeIds = reviewHighlight.viewId === view.id
      ? reviewHighlight.nodeIds.filter((id) => visibleViewNodeRefSet.has(id))
      : [];
    const previewReviewNodeIds = reviewHighlight.previewNodeIds.filter((id) => visibleViewNodeRefSet.has(id));
    const effectiveReviewNodeIds = previewReviewNodeIds.length > 0
      ? previewReviewNodeIds
      : persistentReviewNodeIds;
    const effectiveReviewNodeIdSet = new Set(effectiveReviewNodeIds);
    const previewReviewNodeIdSet = new Set(previewReviewNodeIds);
    const hasReviewFocus = effectiveReviewNodeIdSet.size > 0;

    // Pre-compute relation badges per symbol: which relation types touch each symbol?
    // Badges are directional: "out:<type>" for source, "in:<type>" for target
    const relBadgeMap = new Map<string, Set<string>>();
    for (const rel of badgeRelations) {
      if (rel.type === "contains") continue;
      if (!diagramSettings.relationFilters[rel.type]) continue;
      const srcSet = relBadgeMap.get(rel.source) ?? new Set();
      srcSet.add(`out:${rel.type}`);
      relBadgeMap.set(rel.source, srcSet);
      const tgtSet = relBadgeMap.get(rel.target) ?? new Set();
      tgtSet.add(`in:${rel.type}`);
      relBadgeMap.set(rel.target, tgtSet);
    }

    const allNodes: Node[] = visibleViewNodeRefs.map((symId, i) => {
      const sym = symbolOverrides.get(symId) ?? graph.symbols.find((s) => s.id === symId);
      if (!sym) return null;
      const artifactPreview = buildArtifactPreview(sym);
      const childViewId = sym.childViewId && sym.childViewId !== view.id ? sym.childViewId : undefined;

      const savedPos = view.nodePositions?.find((p) => p.symbolId === symId);

      // Choose node type based on symbol kind and view scope.
      // In class-projection mode we always render proper UML class boxes,
      // so the ad-hoc scope checks are bypassed for classes/interfaces.
      let nodeType = "uml";
      if (isClassProjection && (sym.kind === "class" || sym.kind === "interface" || sym.kind === "module")) {
        nodeType = "umlClass";
      } else if (sym.umlType === "database" || sym.umlType === "artifact" || sym.umlType === "component" || sym.umlType === "note") {
        nodeType = "umlArtifact";
      } else if (sym.umlType === "package") {
        nodeType = "umlGroup";
      } else if (sym.kind === "group") nodeType = "umlGroup";
      else if (sym.kind === "external") nodeType = "umlArtifact";
      else if (sym.kind === "class" && (scope === "group" || scope === "module")) nodeType = "umlClass";
      else if (sym.kind === "module" && scope === "group") nodeType = "umlGroup";
      else if (sym.kind === "function" || sym.kind === "method") nodeType = "umlFunction";

      // Gather children for class nodes (show members inline)
      const children = (sym.kind === "class" || sym.kind === "interface")
        ? graph.symbols.filter((s) => s.parentId === sym.id && !hiddenSymbolIds.has(s.id))
        : isClassProjection && sym.kind === "module"
          ? graph.symbols.filter((s) =>
              s.parentId === sym.id &&
              !hiddenSymbolIds.has(s.id) &&
              (s.kind === "function" || s.kind === "method" || s.kind === "variable" || s.kind === "constant"),
            )
          : sym.kind === "module"
            ? graph.symbols.filter((s) => s.parentId === sym.id && !hiddenSymbolIds.has(s.id))
            : [];

      // Extra CSS classes
      const isDeadCode = sym.tags?.includes("dead-code");
      const nodeClasses: string[] = [];
      if (isDeadCode) nodeClasses.push("dead-code");
      if (hasReviewFocus) {
        if (effectiveReviewNodeIdSet.has(sym.id)) {
          nodeClasses.push("review-highlight");
          if (previewReviewNodeIdSet.has(sym.id)) {
            nodeClasses.push("review-highlight--preview");
          } else if (reviewHighlight.primaryNodeId === sym.id) {
            nodeClasses.push("review-highlight--primary");
          } else {
            nodeClasses.push("review-highlight--related");
          }
        } else {
          nodeClasses.push("review-dim");
        }
      }

      // Collect direct relation types for this symbol (for badge display)
      const directBadges = relBadgeMap.get(sym.id);
      // Also include badges from children (for group/module nodes)
      const childBadges = new Set<string>(directBadges ?? []);
      if (sym.kind === "group" || sym.kind === "module") {
        for (const child of children) {
          const cb = relBadgeMap.get(child.id);
          if (cb) cb.forEach((t) => childBadges.add(t));
        }
      }
      const relationBadges = Array.from(childBadges);

      return {
        id: sym.id,
        type: nodeType,
        selected: sym.id === selectedSymbolId,
        draggable: nodesDraggable,
        position: savedPos ? { x: savedPos.x, y: savedPos.y } : { x: i * 250, y: i * 120 },
        parentId: isClassProjection ? undefined : savedPos?.parentId,
        extent: isClassProjection ? undefined : savedPos?.extent,
        style: savedPos?.width || savedPos?.height
          ? {
              ...(savedPos.width ? { width: savedPos.width } : {}),
              ...(savedPos.height ? { height: savedPos.height } : {}),
            }
          : undefined,
        className: nodeClasses.join(" ") || undefined,
        data: {
          label: sym.label,
          kind: sym.kind,
          umlType: sym.umlType,
          stereotype: isClassProjection && sym.kind === "module" ? "module" : sym.stereotype,
          summary: sym.doc?.summary,
          symbolId: sym.id,
          childViewId,
          inputs: sym.doc?.inputs,
          outputs: sym.doc?.outputs,
          children,
          tags: sym.tags,
          relationBadges,
          location: sym.location,
          compactMode: diagramSettings.nodeCompactMode,
          labelsMode: diagramSettings.labels,
          artifactPreviewKind: diagramSettings.generatedArtifactMode === "individual" ? undefined : artifactPreview?.kind,
          artifactPreviewItemCount: artifactPreview?.itemCount ?? null,
          artifactPreviewGroupCount: artifactPreview?.groupCount ?? null,
        } satisfies UmlNodeData,
      } satisfies Node;
    }).filter(Boolean) as Node[];

    // Use edge projection instead of strict endpoint filtering
    const projected = projectEdgesForView(
      { ...view, nodeRefs: visibleViewNodeRefs },
      graph.symbols,
      visibleRelations,
      { bundleByType: isClassProjection },
    );
    const preparedEdges = toPreparedEdges(
      projected,
      relationMap,
      diagramSettings.relationFilters,
      diagramSettings.labels,
      diagramSettings.edgeAggregation,
    );

    const selectedInView =
      !hasReviewFocus &&
      !!selectedSymbolId &&
      allNodes.some((node) => node.id === selectedSymbolId);

    let visibleNodeIds: Set<string> | null = null;
    if (diagramSettings.focusMode && selectedInView && selectedSymbolId) {
      visibleNodeIds = neighborhoodNodeIds(
        selectedSymbolId,
        preparedEdges,
        Math.max(1, Math.round(diagramSettings.focusDepth)),
      );
    }

    const scopedNodes = visibleNodeIds
      ? allNodes.filter((node) => visibleNodeIds!.has(node.id))
      : allNodes;
    const scopedNodeIdSet = new Set(scopedNodes.map((node) => node.id));
    const scopedEdges = preparedEdges.filter((edge) =>
      scopedNodeIdSet.has(edge.source) && scopedNodeIdSet.has(edge.target),
    );

    // Detect bidirectional pairs: if both A→B and B→A exist, route the
    // "reverse" edge through Left/Right handles to avoid overlapping paths
    const edgeKeys = new Set(scopedEdges.map((pe) => `${pe.source}|${pe.target}`));
    const reverseSet = new Set<string>(); // keys that are the "reverse" direction
    for (const pe of scopedEdges) {
      const pair = `${pe.source}|${pe.target}`;
      const reverse = `${pe.target}|${pe.source}`;
      if (edgeKeys.has(reverse) && !reverseSet.has(reverse)) {
        // Mark the reverse direction (the one we encounter second) for alt routing
        reverseSet.add(pair);
      }
    }

    const hasSelectedNodeEmphasis =
      !hasReviewFocus &&
      !!selectedSymbolId &&
      scopedNodeIdSet.has(selectedSymbolId);

    const vEdges: Edge[] = scopedEdges.map((pe) => {
      const pair = `${pe.source}|${pe.target}`;
      const isReverse = reverseSet.has(pair);
      const sourceHandle = isReverse ? "out-right" : "out-bottom";
      const targetHandle = isReverse ? "in-left" : "in-top";
      const isSelectedConnection =
        hasSelectedNodeEmphasis &&
        selectedSymbolId !== null &&
        (pe.source === selectedSymbolId || pe.target === selectedSymbolId);
      const edgeVisibilityClass = hasSelectedNodeEmphasis
        ? isSelectedConnection
          ? " edge-related edge-related--active"
          : " edge-related edge-related--dim"
        : "";
      const isReviewConnected =
        hasReviewFocus &&
        (effectiveReviewNodeIdSet.has(pe.source) || effectiveReviewNodeIdSet.has(pe.target));
      const edgeReviewClass = hasReviewFocus
        ? isReviewConnected
          ? " edge-review-highlight"
          : " edge-review-dim"
        : "";
      return {
        id: pe.key,
        source: pe.source,
        target: pe.target,
        selected: selectedEdgeId === pe.key || (selectedEdgeId !== null && pe.relationIds.includes(selectedEdgeId)),
        sourceHandle,
        targetHandle,
        sourcePosition: positionFromHandle(sourceHandle),
        targetPosition: positionFromHandle(targetHandle),
        type: diagramSettings.edgeType,
        label: hasSelectedNodeEmphasis
          ? isSelectedConnection
            ? pe.label
            : undefined
          : pe.label,
        animated: pe.animated,
        markerStart: edgeMarkerStartForRelation(pe.type),
        markerEnd: edgeMarkerEndForRelation(pe.type),
        className: `${pe.className}${edgeVisibilityClass}${edgeReviewClass}`,
        style: { strokeWidth: diagramSettings.edgeStrokeWidth },
        data: {
          relationIds: pe.relationIds,
          relationType: pe.type,
          sourceMultiplicity: pe.sourceMultiplicity,
          targetMultiplicity: pe.targetMultiplicity,
          sourceRole: pe.sourceRole,
          targetRole: pe.targetRole,
          showUmlAnnotations: isClassProjection,
        },
      };
    });

    return { viewNodes: scopedNodes, viewEdges: vEdges, renderMode: "standard" as const };
  }, [
    graph,
    currentViewId,
    projectionMode,
    sequenceContext,
    diagramSettings,
    nodesDraggable,
    selectedEdgeId,
    selectedSymbolId,
    reviewHighlight.nodeIds,
    reviewHighlight.previewNodeIds,
    reviewHighlight.primaryNodeId,
    reviewHighlight.viewId,
  ]);

  useEffect(() => {
    const { persistedManualLayout, localManualLayoutOverride, effectiveManualLayout } = resolveManualLayoutState({
      autoLayout: isAutoLayoutActive,
      currentViewId,
      currentViewIgnoresManualLayout,
      view: currentView,
      manualLayoutViewIds: manualLayoutViewIdsRef.current,
    });
    const savedPositionCount = currentView?.nodePositions?.length ?? 0;
    const savedPositionIds = new Set((currentView?.nodePositions ?? []).map((position) => position.symbolId));
    const allHaveSavedPositions = viewNodes.length > 0 && viewNodes.every((node) => savedPositionIds.has(node.id));
    const renderedElkRouteCount = edges.filter((edge) => {
      const data = edge.data as { elkRoute?: EdgeRoute } | undefined;
      return !!data?.elkRoute;
    }).length;
    const awaitingStableElkRoutes =
      isAutoLayoutActive &&
      !lastElkErrorRef.current &&
      layoutPassRef.current < 2 &&
      renderedElkRouteCount === 0;
    const routeMode: "elk" | "fallback" | "mixed" | "none" =
      edges.length === 0
        ? "none"
        : isAutoLayoutActive && !layoutDone && renderedElkRouteCount === 0
          ? "none"
          : awaitingStableElkRoutes
            ? "none"
          : renderedElkRouteCount === 0
            ? "fallback"
            : renderedElkRouteCount === edges.length
              ? "elk"
              : "mixed";
    const dynamicPortCount = nodes.reduce((sum, node) =>
      sum + (((node.data as UmlNodeData).dynamicPorts ?? []).length), 0);

    useAppStore.getState().updateDebugDiagram({
      currentViewId,
      layoutKey: prevLayoutKeyRef.current,
      layoutFingerprint: layoutFingerprintRef.current,
      layoutPass: layoutPassRef.current,
      layoutRunId: layoutRunIdRef.current,
      nodesRendered: nodes.length,
      edgesRendered: edges.length,
      viewNodes: viewNodes.length,
      viewEdges: viewEdges.length,
      elkRouteCount: renderedElkRouteCount,
      edgeHandleCount: edgeHandlesRef.current.size,
      dynamicPortNodeCount: dynamicPortState.nodeIds.length,
      dynamicPortCount,
      routeMode,
      routeReason: summarizeRouteReason({
        autoLayout: isAutoLayoutActive,
        effectiveManualLayout,
        routeMode,
        edgeCount: edges.length,
        elkRouteCount: renderedElkRouteCount,
        layoutReady: layoutDone,
        layoutError: lastElkErrorRef.current,
      }),
      autoLayout: isAutoLayoutActive,
      nodesDraggable,
      dragActive: isNodeDragActive,
      persistedManualLayout,
      localManualLayoutOverride,
      manualLayoutActive: effectiveManualLayout,
      effectiveManualLayout,
      savedPositionCount,
      allHaveSavedPositions,
      lastLayoutTrigger: lastLayoutTriggerRef.current,
    });
  }, [
    currentView,
    currentViewId,
    currentViewIgnoresManualLayout,
    isAutoLayoutActive,
    dynamicPortState.nodeIds.length,
    edges,
    isNodeDragActive,
    layoutDone,
    nodesDraggable,
    nodes,
    viewEdges.length,
    viewNodes,
  ]);

  // Apply ELK layout — Pass 1 (estimate)
  // Only re-layout when the view or node set actually changes (not on position/data-only updates)
  useEffect(() => {
    clearScheduledTimeout(firstPassFitTimeoutRef);
    clearScheduledTimeout(secondPassFitTimeoutRef);
    const expectedViewId = currentViewId;

    if (viewNodes.length === 0) {
      layoutRunIdRef.current += 1;
      setNodes([]);
      setEdges([]);
      prevLayoutKeyRef.current = "";
      layoutFingerprintRef.current = "";
      prevLayoutFingerprintPartsRef.current = null;
      lastLayoutTriggerRef.current = "empty view";
      lastElkErrorRef.current = null;
      edgeHandlesRef.current = new Map();
      edgeRoutesRef.current = new Map();
      return;
    }

    // Build key from structure + size-affecting data (node IDs, input/output counts)
    // When AI analysis adds parameters/outputs to function nodes, the fingerprint
    // changes and ELK re-layout runs to prevent node overlaps.
    const nodeFingerprint = viewNodes
      .map((n) => {
        const d = n.data as UmlNodeData;
        return `${n.id}:${n.type}:${d.inputs?.length ?? 0}:${d.outputs?.length ?? 0}`;
      })
      .sort()
      .join(",");
    const edgeFingerprint = viewEdges
      .map((e) => {
        const relationType = (e.data as { relationType?: string } | undefined)?.relationType ?? "";
        return `${e.id}:${e.source}:${e.target}:${relationType}`;
      })
      .sort()
      .join(",");
    const layoutMode = renderMode === "sequence" ? "sequence" : (isAutoLayoutActive ? "auto" : "manual");
    const layoutFingerprint = `${currentViewId}|${layoutMode}|${nodeFingerprint}|${edgeFingerprint}`;
    const layoutKey = `${layoutFingerprint}|${layoutVersion}`;
    const sequenceLayoutRunId = layoutRunIdRef.current;

    if (renderMode === "sequence") {
      prevLayoutKeyRef.current = layoutKey;
      layoutFingerprintRef.current = layoutFingerprint;
      prevLayoutFingerprintPartsRef.current = {
        viewId: currentViewId,
        autoLayout: isAutoLayoutActive,
        nodeFingerprint,
        edgeFingerprint,
      };
      lastLayoutTriggerRef.current = "sequence projection";
      lastResolvedLayoutVersionRef.current = layoutVersion;
      lastElkErrorRef.current = null;
      edgeHandlesRef.current = new Map();
      edgeRoutesRef.current = new Map();
      setNodes(viewNodes);
      setEdges(viewEdges);
      layoutRef.current = false;
      layoutPassRef.current = 2;
      setLayoutPass(2);
      setLayoutDone(true);
      const liveState = useAppStore.getState();
      const pendingExplicitFit =
        !!expectedViewId &&
        liveState.viewFitViewId === expectedViewId &&
        (liveState.viewFitSeq ?? 0) > appliedViewFitSeqRef.current;
      if ((pendingRestoreForCurrentView && currentViewPersistedViewport) || liveState.focusNodeId || pendingExplicitFit) {
        return;
      }
      clearScheduledTimeout(firstPassFitTimeoutRef);
      clearScheduledTimeout(secondPassFitTimeoutRef);
      firstPassFitTimeoutRef.current = setTimeout(() => {
        firstPassFitTimeoutRef.current = null;
        if (!canApplyLayoutResult(expectedViewId, sequenceLayoutRunId, layoutKey)) return;
        reactFlowInstance.fitView({ padding: 0.06, duration: 320, maxZoom: 3.1 });
        scheduleViewportPersist(380, expectedViewId);
      }, 80);
      secondPassFitTimeoutRef.current = setTimeout(() => {
        secondPassFitTimeoutRef.current = null;
        if (!canApplyLayoutResult(expectedViewId, sequenceLayoutRunId, layoutKey)) return;
        reactFlowInstance.fitView({ padding: 0.15, duration: 280 });
        scheduleViewportPersist(420, expectedViewId);
      }, 820);
      return;
    }

    const isExplicitRelayout = layoutVersion !== lastResolvedLayoutVersionRef.current;
    const view = currentView;
    const { effectiveManualLayout } = resolveManualLayoutState({
      autoLayout: isAutoLayoutActive,
      currentViewId,
      currentViewIgnoresManualLayout,
      view,
      manualLayoutViewIds: manualLayoutViewIdsRef.current,
    });
    if (isExplicitRelayout) {
      manualLayoutViewIdsRef.current.clear();
    }
    const shouldRespectSavedPositions = effectiveManualLayout && !isExplicitRelayout;
    const shouldUseElkRoutes = isAutoLayoutActive;

    if (layoutKey === prevLayoutKeyRef.current) {
      // Node structure unchanged — update node data & edges without repositioning
      setNodes((prev) => {
        const viewNodeMap = new Map(viewNodes.map((vn) => [vn.id, vn]));
        return prev.map((n) => {
          const updated = viewNodeMap.get(n.id);
          if (!updated) return n;
          // Preserve dynamic ports from previous layout
          const prevPorts = (n.data as UmlNodeData).dynamicPorts;
          return {
            ...n,
            type: updated.type,
            selected: updated.selected,
            draggable: updated.draggable,
            parentId: updated.parentId,
            extent: updated.extent,
            style: n.style,
            // Do NOT overwrite position — keep ELK/user-dragged position from prev
            data: { ...updated.data, dynamicPorts: prevPorts },
            className: updated.className,
          };
        });
      });
      setEdges(
        withLayoutGeometry(
          viewEdges,
          edgeHandlesRef.current,
          edgeRoutesRef.current,
          shouldUseElkRoutes,
          diagramSettings.edgeType,
          false,
        ),
      );
      return;
    }
    const previousFingerprint = prevLayoutFingerprintPartsRef.current;
    let nextLayoutTrigger = "layout settings change";
    if (isExplicitRelayout) {
      nextLayoutTrigger = "explicit relayout";
    } else if (!previousFingerprint || previousFingerprint.viewId !== currentViewId) {
      nextLayoutTrigger = "view change";
    } else if (previousFingerprint.autoLayout !== isAutoLayoutActive) {
      nextLayoutTrigger = isAutoLayoutActive ? "auto-layout enabled" : "auto-layout disabled";
    } else if (previousFingerprint.nodeFingerprint !== nodeFingerprint) {
      nextLayoutTrigger = "node structure change";
    } else if (previousFingerprint.edgeFingerprint !== edgeFingerprint) {
      nextLayoutTrigger = "edge structure change";
    }
    layoutFingerprintRef.current = layoutFingerprint;
    prevLayoutFingerprintPartsRef.current = {
      viewId: currentViewId,
      autoLayout: isAutoLayoutActive,
      nodeFingerprint,
      edgeFingerprint,
    };
    lastLayoutTriggerRef.current = nextLayoutTrigger;
    prevLayoutKeyRef.current = layoutKey;
    lastResolvedLayoutVersionRef.current = layoutVersion;
    const layoutRunId = layoutRunIdRef.current + 1;
    layoutRunIdRef.current = layoutRunId;
    lastElkErrorRef.current = null;

    // Check which nodes have saved positions
    const savedMap = new Map(
      (view?.nodePositions ?? []).map((p) => [p.symbolId, p]),
    );
    const allHaveSavedPos = viewNodes.every((n) => savedMap.has(n.id));

    if (allHaveSavedPos && (!isAutoLayoutActive || shouldRespectSavedPositions)) {
      // Manual drag overrides keep persisted positions until the user explicitly re-applies layout.
      edgeHandlesRef.current = new Map();
      edgeRoutesRef.current = new Map();
      setNodes(viewNodes);
      setEdges(
        withLayoutGeometry(
          viewEdges,
          edgeHandlesRef.current,
          edgeRoutesRef.current,
          false,
          diagramSettings.edgeType,
          false,
        ),
      );
      layoutRef.current = false;
      layoutPassRef.current = 2;
      setLayoutPass(2);
      setLayoutDone(true);
      return;
    }

    // Need ELK layout for unsaved nodes
    setLayoutDone(false);
    layoutRef.current = false;
    layoutPassRef.current = 0;
    setLayoutPass(0);

    layoutNodes(
      viewNodes,
      viewEdges,
      diagramSettings.layout,
      diagramSettings.nodeCompactMode,
    ).then(({ nodes: laid, portsByNode, edgeHandles, routesByEdge }) => {
      if (!canApplyLayoutResult(expectedViewId, layoutRunId, layoutKey)) return;
      lastElkErrorRef.current = null;
      edgeHandlesRef.current = edgeHandles;
      edgeRoutesRef.current = shouldUseElkRoutes ? routesByEdge : new Map();
      // Manual drag overrides pin the saved positions; new nodes still receive layout positions.
      const positioned = laid.map((n) => {
        const saved = savedMap.get(n.id);
        return saved
          ? shouldRespectSavedPositions
            ? { ...n, position: { x: saved.x, y: saved.y } }
            : n
          : n;
      });
      setNodes(attachDynamicPorts(positioned, portsByNode));
      setEdges(
        withLayoutGeometry(
          viewEdges,
          edgeHandles,
          edgeRoutesRef.current,
          shouldUseElkRoutes,
          diagramSettings.edgeType,
          shouldUseElkRoutes,
        ),
      );
      layoutPassRef.current = 1;
      setLayoutPass(1);
      setLayoutDone(true);
    }).catch((error) => {
      if (!canApplyLayoutResult(expectedViewId, layoutRunId, layoutKey)) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Canvas] ELK layout failed during pass 1", error);
      lastElkErrorRef.current = message;
      edgeHandlesRef.current = new Map();
      edgeRoutesRef.current = new Map();
      setNodes(viewNodes);
      setEdges(
        withLayoutGeometry(
          viewEdges,
          edgeHandlesRef.current,
          edgeRoutesRef.current,
          false,
          diagramSettings.edgeType,
          false,
        ),
      );
      layoutRef.current = false;
      layoutPassRef.current = 2;
      setLayoutPass(2);
      setLayoutDone(true);
    });
  }, [
    canApplyLayoutResult,
    viewNodes,
    viewEdges,
    setNodes,
    setEdges,
    currentView,
    currentViewId,
    currentViewIgnoresManualLayout,
    layoutVersion,
    renderMode,
    isAutoLayoutActive,
    diagramSettings.edgeType,
    diagramSettings.layout,
    diagramSettings.nodeCompactMode,
    currentViewPersistedViewport,
    pendingRestoreForCurrentView,
    reactFlowInstance,
    scheduleViewportPersist,
  ]);

  // Pass 2: re-layout with measured sizes (React Flow measures after first render)
  useEffect(() => {
    if (layoutPassRef.current !== 1 || !layoutDone) return;
    // Check if any node has been measured by React Flow
    const hasMeasured = nodes.some((n) => n.measured?.width && n.measured?.height);
    if (!hasMeasured) return;

    layoutPassRef.current = 2; // prevent infinite loop
    setLayoutPass(2);
    const expectedViewId = currentViewId;
    const layoutRunId = layoutRunIdRef.current;
    const expectedLayoutKey = prevLayoutKeyRef.current;
    const view = currentView;
    const { effectiveManualLayout } = resolveManualLayoutState({
      autoLayout: isAutoLayoutActive,
      currentViewId,
      currentViewIgnoresManualLayout,
      view,
      manualLayoutViewIds: manualLayoutViewIdsRef.current,
    });
    const shouldRespectSavedPositions = effectiveManualLayout;
    const shouldUseElkRoutes = isAutoLayoutActive;

    // Preserve saved positions in pass 2 as well
    const savedMap = new Map(
      (view?.nodePositions ?? []).map((p) => [p.symbolId, p]),
    );

    layoutNodes(
      nodes,
      edges,
      diagramSettings.layout,
      diagramSettings.nodeCompactMode,
    ).then(({ nodes: laid, portsByNode, edgeHandles, routesByEdge }) => {
      if (!canApplyLayoutResult(expectedViewId, layoutRunId, expectedLayoutKey)) return;
      lastElkErrorRef.current = null;
      edgeHandlesRef.current = edgeHandles;
      edgeRoutesRef.current = shouldUseElkRoutes ? routesByEdge : new Map();
      const positioned = laid.map((n) => {
        const saved = savedMap.get(n.id);
        return saved
          ? shouldRespectSavedPositions
            ? { ...n, position: { x: saved.x, y: saved.y } }
            : n
          : n;
      });
      setNodes(attachDynamicPorts(positioned, portsByNode));
      setEdges((prev) =>
        withLayoutGeometry(
          prev,
          edgeHandles,
          edgeRoutesRef.current,
          shouldUseElkRoutes,
          diagramSettings.edgeType,
          false,
        ),
      );
      const liveState = useAppStore.getState();
      const pendingExplicitFit =
        !!expectedViewId &&
        liveState.viewFitViewId === expectedViewId &&
        (liveState.viewFitSeq ?? 0) > appliedViewFitSeqRef.current;
      if (!pendingRestoreForCurrentView && !currentViewPersistedViewport && !liveState.focusNodeId && !pendingExplicitFit) {
        clearScheduledTimeout(secondPassFitTimeoutRef);
        secondPassFitTimeoutRef.current = setTimeout(() => {
          secondPassFitTimeoutRef.current = null;
          if (!canApplyLayoutResult(expectedViewId, layoutRunId, expectedLayoutKey)) return;
          reactFlowInstance.fitView({ padding: 0.12, duration: 300 });
          scheduleViewportPersist(360, expectedViewId);
        }, 60);
      }
    }).catch((error) => {
      if (!canApplyLayoutResult(expectedViewId, layoutRunId, expectedLayoutKey)) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Canvas] ELK layout failed during pass 2", error);
      lastElkErrorRef.current = message;
      setLayoutDone(true);
    });
  }, [
    canApplyLayoutResult,
    nodes,
    edges,
    layoutDone,
    setNodes,
    reactFlowInstance,
    currentView,
    currentViewId,
    currentViewIgnoresManualLayout,
    isAutoLayoutActive,
    diagramSettings.edgeType,
    diagramSettings.layout,
    diagramSettings.nodeCompactMode,
    currentViewPersistedViewport,
    pendingRestoreForCurrentView,
    scheduleViewportPersist,
  ]);

  // Fit view after first layout pass
  useEffect(() => {
    if (layoutDone && !layoutRef.current) {
      layoutRef.current = true;
      const liveState = useAppStore.getState();
      const pendingExplicitFit =
        !!currentViewId &&
        liveState.viewFitViewId === currentViewId &&
        (liveState.viewFitSeq ?? 0) > appliedViewFitSeqRef.current;
      if ((pendingRestoreForCurrentView && currentViewPersistedViewport) || liveState.focusNodeId || pendingExplicitFit) {
        return;
      }
      const expectedViewId = currentViewId;
      const layoutRunId = layoutRunIdRef.current;
      const expectedLayoutKey = prevLayoutKeyRef.current;
      clearScheduledTimeout(firstPassFitTimeoutRef);
      firstPassFitTimeoutRef.current = setTimeout(() => {
        firstPassFitTimeoutRef.current = null;
        if (!canApplyLayoutResult(expectedViewId, layoutRunId, expectedLayoutKey)) return;
        reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
        scheduleViewportPersist(360, expectedViewId);
      }, 50);
    }
  }, [canApplyLayoutResult, currentViewId, currentViewPersistedViewport, layoutDone, pendingRestoreForCurrentView, reactFlowInstance, scheduleViewportPersist]);

  // AI highlight: When highlightSymbolId changes (or seq increments for same symbol),
  // flash the node if it exists in the current view. This is a lightweight visual cue;
  // the actual viewport navigation is driven by focusNodeId below.
  const prevHighlightSeqRef = useRef(0);
  useEffect(() => {
    if (!aiHighlightId || highlightSeq === prevHighlightSeqRef.current) return;
    prevHighlightSeqRef.current = highlightSeq;

    const el = document.querySelector(`[data-id="${aiHighlightId}"]`);
    if (el) {
      el.classList.remove("ai-flash");
      // Force reflow so re-adding the class re-triggers the animation
      void (el as HTMLElement).offsetWidth;
      el.classList.add("ai-flash");
      setTimeout(() => el.classList.remove("ai-flash"), 1500);
    }
  }, [aiHighlightId, highlightSeq]);

  // AI working node pulse: show animated border on the node LLM is currently analyzing
  const prevWorkingRef = useRef<string | null>(null);
  useEffect(() => {
    // Remove from previous
    if (prevWorkingRef.current && prevWorkingRef.current !== aiWorkingSymbolId) {
      const prev = document.querySelector(`[data-id="${prevWorkingRef.current}"]`);
      if (prev) prev.classList.remove("ai-working");
    }
    prevWorkingRef.current = aiWorkingSymbolId;
    if (!aiWorkingSymbolId) return;

    const el = document.querySelector(`[data-id="${aiWorkingSymbolId}"]`);
    if (el) {
      el.classList.add("ai-working");
    }
    return () => {
      if (aiWorkingSymbolId) {
        const el2 = document.querySelector(`[data-id="${aiWorkingSymbolId}"]`);
        if (el2) el2.classList.remove("ai-working");
      }
    };
  }, [aiWorkingSymbolId]);

  // Focus-navigate: zoom to a specific node after view switch & highlight it
  const focusNodeId = useAppStore((s) => s.focusNodeId);
  const focusSeq = useAppStore((s) => s.focusSeq ?? 0);
  const setFocusNode = useAppStore((s) => s.setFocusNode);
  const viewFitViewId = useAppStore((s) => s.viewFitViewId);
  const viewFitSeq = useAppStore((s) => s.viewFitSeq ?? 0);
  const focusAppliedRef = useRef<string | null>(null);
  const lastFocusSeqRef = useRef(0);
  const pendingFocusRef = useRef<string | null>(null);
  const focusRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedReviewSeqRef = useRef(0);

  const consumePendingViewFit = useCallback((expectedViewId: string | null) => {
    if (!expectedViewId) return;
    const liveState = useAppStore.getState();
    if (liveState.viewFitViewId === expectedViewId) {
      appliedViewFitSeqRef.current = Math.max(
        appliedViewFitSeqRef.current,
        liveState.viewFitSeq ?? 0,
      );
    }
    clearScheduledTimeout(firstPassFitTimeoutRef);
    clearScheduledTimeout(secondPassFitTimeoutRef);
    clearScheduledFrame(viewFitFrameRef);
    clearScheduledFrame(reviewFitFrameRef);
  }, []);

  const dismissFocusNavigation = useCallback(() => {
    if (!focusNodeId) return;
    clearScheduledTimeout(focusApplyTimeoutRef);
    clearScheduledTimeout(focusHighlightTimeoutRef);
    consumePendingViewFit(currentViewId);
    setFocusNode(null);
  }, [consumePendingViewFit, currentViewId, focusNodeId, setFocusNode]);

  // Core function to apply focus zoom + highlight
  const applyFocusZoom = useCallback((nodeId: string, expectedViewId: string | null) => {
    if (!expectedViewId || useAppStore.getState().currentViewId !== expectedViewId) return;
    consumePendingViewFit(expectedViewId);
    const isDeadCodeFocus = !!graph?.symbols.find(
      (s) => s.id === nodeId && (s.tags?.includes("dead-code") ?? false),
    );

    const node = reactFlowInstance.getInternalNode(nodeId);
    if (node) {
      const w = node.measured?.width ?? 200;
      const h = node.measured?.height ?? 100;
      const absPos = node.internals?.positionAbsolute ?? node.position ?? { x: 0, y: 0 };
      const cx = absPos.x + w / 2;
      const cy = absPos.y + h / 2;
      reactFlowInstance.setCenter(cx, cy, { zoom: 1.5, duration: 500 });
      scheduleViewportPersist(560, expectedViewId);
    } else {
      reactFlowInstance.fitView({
        nodes: [{ id: nodeId }],
        duration: 500,
        padding: 0.1,
        maxZoom: 2,
      });
      scheduleViewportPersist(560, expectedViewId);
    }
    clearScheduledTimeout(focusHighlightTimeoutRef);
    focusHighlightTimeoutRef.current = setTimeout(() => {
      focusHighlightTimeoutRef.current = null;
      const liveState = useAppStore.getState();
      if (liveState.currentViewId !== expectedViewId || liveState.focusNodeId !== nodeId) return;
      // Clear ALL previous focus highlights — only one node should be highlighted at a time
      document.querySelectorAll(".node-focus-highlight, .node-focus-highlight-dead").forEach((prev) => {
        prev.classList.remove("node-focus-highlight", "node-focus-highlight-dead");
      });

      const el = document.querySelector(`[data-id="${nodeId}"]`);
      if (el) {
        // Use ai-processing class during AI analysis, regular highlight otherwise
        const cls = aiRunning
          ? "ai-flash"
          : (isDeadCodeFocus ? "node-focus-highlight-dead" : "node-focus-highlight");
        el.classList.add(cls);
        if (cls === "ai-flash") {
          setTimeout(() => el.classList.remove("ai-flash"), 1500);
        }
      }
      acknowledgeAiNavigationSettled(nodeId);
    }, 520);
  }, [
    reactFlowInstance,
    aiRunning,
    acknowledgeAiNavigationSettled,
    consumePendingViewFit,
    graph,
    scheduleViewportPersist,
  ]);

  const scheduleFocusZoom = useCallback((nodeId: string, expectedViewId: string | null, delayMs: number) => {
    clearScheduledTimeout(focusApplyTimeoutRef);
    focusApplyTimeoutRef.current = setTimeout(() => {
      focusApplyTimeoutRef.current = null;
      const liveState = useAppStore.getState();
      if (!expectedViewId || liveState.currentViewId !== expectedViewId) return;
      if (liveState.focusNodeId !== nodeId) return;
      applyFocusZoom(nodeId, expectedViewId);
    }, delayMs);
  }, [applyFocusZoom]);

  const applyReviewFit = useCallback((nodeIds: string[]) => {
    const uniqueNodeIds = Array.from(new Set(nodeIds));
    if (uniqueNodeIds.length === 0) return;
    reactFlowInstance.fitView({
      nodes: uniqueNodeIds.map((id) => ({ id })),
      duration: 420,
      padding: uniqueNodeIds.length > 1 ? 0.22 : 0.14,
      maxZoom: uniqueNodeIds.length > 1 ? 1.4 : 1.8,
    });
  }, [reactFlowInstance]);

  // focusSeq changes drive re-navigation even to the same node (AI events)
  // No need for the old highlightSeq-based focusAppliedRef reset.

  // Main focus effect — tries immediately, retries if layout not ready
  useEffect(() => {
    if (!focusNodeId) {
      pendingFocusRef.current = null;
      return;
    }
    const isNewBySeq = focusSeq > lastFocusSeqRef.current;
    const isNewByNode = focusAppliedRef.current !== focusNodeId;
    if (!isNewBySeq && !isNewByNode) return;

    const exists = nodes.some((n) => n.id === focusNodeId);
    if (!exists || !layoutDone || layoutPass < 2 || !nodesInitialized) {
      // Layout not ready — store as pending and retry
      pendingFocusRef.current = focusNodeId;
      return;
    }

    // Layout is ready — apply focus
    focusAppliedRef.current = focusNodeId;
    lastFocusSeqRef.current = focusSeq;
    pendingFocusRef.current = null;
    scheduleFocusZoom(focusNodeId, currentViewId, 300);
  }, [currentViewId, focusNodeId, focusSeq, layoutDone, layoutPass, nodes, nodesInitialized, scheduleFocusZoom]);

  // Retry pending focus after layout pass 2 completes (also checks nodesInitialized)
  useEffect(() => {
    if (!layoutDone || layoutPass < 2 || !nodesInitialized) return;
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const isNewBySeq = focusSeq > lastFocusSeqRef.current;
    const isNewByNode = focusAppliedRef.current !== pending;
    if (!isNewBySeq && !isNewByNode) return;

    // Check node exists now that layout is done
    const exists = nodes.some((n) => n.id === pending);
    if (!exists) return;

    focusAppliedRef.current = pending;
    lastFocusSeqRef.current = focusSeq;
    pendingFocusRef.current = null;
    scheduleFocusZoom(pending, currentViewId, 300);
  }, [currentViewId, layoutDone, layoutPass, nodes, nodesInitialized, scheduleFocusZoom, focusSeq]);

  // Also retry with a timer for cases where layout deps don't trigger re-render
  useEffect(() => {
    const seqHandled = focusSeq <= lastFocusSeqRef.current;
    if (!focusNodeId || (focusAppliedRef.current === focusNodeId && seqHandled)) {
      if (focusRetryRef.current) { clearInterval(focusRetryRef.current); focusRetryRef.current = null; }
      return;
    }
    // Poll every 200ms for up to 3s waiting for layout to be ready
    let attempts = 0;
    focusRetryRef.current = setInterval(() => {
      attempts++;
      if (attempts > 15) { // 3s max
        if (focusRetryRef.current) clearInterval(focusRetryRef.current);
        focusRetryRef.current = null;
        pendingFocusRef.current = null;
        return;
      }
      if (layoutPassRef.current < 2) return; // still waiting for layout
      const id = pendingFocusRef.current ?? focusNodeId;
      const exists = nodes.some((n) => n.id === id);
      if (!exists) return;
      const seqDone = focusSeq <= lastFocusSeqRef.current;
      if (focusAppliedRef.current === id && seqDone) {
        if (focusRetryRef.current) clearInterval(focusRetryRef.current);
        focusRetryRef.current = null;
        return;
      }
      focusAppliedRef.current = id;
      lastFocusSeqRef.current = focusSeq;
      pendingFocusRef.current = null;
      if (focusRetryRef.current) clearInterval(focusRetryRef.current);
      focusRetryRef.current = null;
      scheduleFocusZoom(id, currentViewId, 100);
    }, 200);
    return () => {
      if (focusRetryRef.current) { clearInterval(focusRetryRef.current); focusRetryRef.current = null; }
    };
  }, [currentViewId, focusNodeId, focusSeq, nodes, scheduleFocusZoom]);

  useEffect(() => {
    if (reviewHighlight.seq <= appliedReviewSeqRef.current) return;

    if (!reviewHighlight.fitView || reviewHighlight.nodeIds.length === 0) {
      appliedReviewSeqRef.current = reviewHighlight.seq;
      return;
    }
    if (!reviewHighlight.viewId || reviewHighlight.viewId !== currentViewId) return;
    if (!layoutDone || layoutPass < 2 || !nodesInitialized) return;

    const visibleTargetIds = reviewHighlight.nodeIds.filter((id) => nodes.some((node) => node.id === id));
    appliedReviewSeqRef.current = reviewHighlight.seq;
    if (visibleTargetIds.length === 0) return;

    clearScheduledFrame(reviewFitFrameRef);
    reviewFitFrameRef.current = requestAnimationFrame(() => {
      reviewFitFrameRef.current = null;
      if (useAppStore.getState().currentViewId !== currentViewId) return;
      // Don't override an active focus zoom
      if (useAppStore.getState().focusNodeId) return;
      applyReviewFit(visibleTargetIds);
    });
  }, [
    applyReviewFit,
    currentViewId,
    layoutDone,
    layoutPass,
    nodes,
    nodesInitialized,
    reviewHighlight.fitView,
    reviewHighlight.nodeIds,
    reviewHighlight.seq,
    reviewHighlight.viewId,
  ]);

  useEffect(() => {
    if (!focusNodeId) {
      clearScheduledTimeout(focusApplyTimeoutRef);
      clearScheduledTimeout(focusHighlightTimeoutRef);
      document.querySelectorAll(".node-focus-highlight, .node-focus-highlight-dead").forEach((el) => {
        el.classList.remove("node-focus-highlight", "node-focus-highlight-dead");
      });
      focusAppliedRef.current = null;
      pendingFocusRef.current = null;
      return;
    }
  }, [focusNodeId]);

  useEffect(() => {
    if (viewRestoreSeq <= appliedViewRestoreSeqRef.current) return;
    if (!viewRestoreViewId || viewRestoreViewId !== currentViewId) return;
    if (!layoutDone || layoutPass < 2 || !nodesInitialized) return;

    appliedViewRestoreSeqRef.current = viewRestoreSeq;
    const viewport = currentViewPersistedViewport;
    if (!viewport) return;

    clearScheduledFrame(viewRestoreFrameRef);
    viewRestoreFrameRef.current = requestAnimationFrame(() => {
      viewRestoreFrameRef.current = null;
      if (useAppStore.getState().currentViewId !== currentViewId) return;
      void reactFlowInstance.setViewport(viewport, { duration: 320 });
      scheduleViewportPersist(380, currentViewId);
    });
  }, [
    currentViewId,
    currentViewPersistedViewport,
    layoutDone,
    layoutPass,
    nodesInitialized,
    reactFlowInstance,
    scheduleViewportPersist,
    viewRestoreSeq,
    viewRestoreViewId,
  ]);

  useEffect(() => {
    if (viewFitSeq <= appliedViewFitSeqRef.current) return;
    if (!viewFitViewId || viewFitViewId !== currentViewId) return;
    if (pendingRestoreForCurrentView && currentViewPersistedViewport) return;
    if (focusNodeId) {
      // Consume the viewFitSeq so no stale fitView fires after focus is cleared
      appliedViewFitSeqRef.current = viewFitSeq;
      return;
    }
    if (!layoutDone || !nodesInitialized || nodes.length === 0) return;
    // Wait for pass 2 — pass 1 uses estimated sizes; fitView would target wrong bounds
    if (layoutPass < 2) return;

    appliedViewFitSeqRef.current = viewFitSeq;
    clearScheduledFrame(viewFitFrameRef);
    viewFitFrameRef.current = requestAnimationFrame(() => {
      viewFitFrameRef.current = null;
      if (useAppStore.getState().currentViewId !== currentViewId) return;
      reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
      scheduleViewportPersist(360, currentViewId);
    });
  }, [
    currentViewId,
    focusNodeId,
    layoutDone,
    layoutPass,
    nodes.length,
    nodesInitialized,
    pendingRestoreForCurrentView,
    currentViewPersistedViewport,
    reactFlowInstance,
    scheduleViewportPersist,
    viewFitSeq,
    viewFitViewId,
  ]);

  // Clear focus highlight when user hovers over the focused node + edge hover highlighting
  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (focusNodeId && node.id === focusNodeId) {
        const el = document.querySelector(`[data-id="${focusNodeId}"]`);
        if (el) el.classList.remove("node-focus-highlight", "node-focus-highlight-dead");
        setFocusNode(null);
        focusAppliedRef.current = null;
      }
      // Edge hover highlighting: dim edges not connected to this node
      if (diagramSettings.hoverHighlight) {
        setHoverNodeId(node.id);
      }
    },
    [focusNodeId, setFocusNode, diagramSettings.hoverHighlight],
  );

  // Clear hover highlighting on mouse leave
  const handleNodeMouseLeave = useCallback(() => {
    setHoverNodeId(null);
  }, []);

  // Hover highlight effect: dim unrelated edges when hovering over a node
  useEffect(() => {
    if (!hoverNodeId) {
      // Remove hover classes from all edges — use DOM for instant feedback
      document.querySelectorAll(".edge-hover-dim, .edge-hover-highlight").forEach((el) => {
        el.classList.remove("edge-hover-dim", "edge-hover-highlight");
      });
      return;
    }
    // Add dim to all edges, then highlight connected ones
    document.querySelectorAll(".react-flow__edge").forEach((el) => {
      el.classList.add("edge-hover-dim");
      el.classList.remove("edge-hover-highlight");
    });
    document.querySelectorAll(".sequence-edge-label").forEach((el) => {
      el.classList.add("edge-hover-dim");
      el.classList.remove("edge-hover-highlight");
    });
    // Find connected edges and highlight them
    for (const e of edges) {
      if (e.source === hoverNodeId || e.target === hoverNodeId) {
        // React Flow edge wrappers have data-testid="rf__edge-<id>"
        const selector = `[data-testid="rf__edge-${CSS.escape(e.id)}"]`;
        const el = document.querySelector(selector);
        if (el) {
          el.classList.remove("edge-hover-dim");
          el.classList.add("edge-hover-highlight");
        }
        const labelSelector = `.sequence-edge-label[data-edge-id="${CSS.escape(e.id)}"]`;
        const labelEl = document.querySelector(labelSelector);
        if (labelEl) {
          labelEl.classList.remove("edge-hover-dim");
          labelEl.classList.add("edge-hover-highlight");
        }
      }
    }
  }, [hoverNodeId, edges]);

  // When a connection is made between handles, show type dialog
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !currentViewId) return;
      setConnectDialog({ source: conn.source, target: conn.target });
      setConnectType("calls");
    },
    [currentViewId],
  );

  // Confirm the connection type dialog
  const handleConfirmConnect = useCallback(() => {
    if (!connectDialog || !currentViewId) return;
    const relId = `rel-${Date.now()}`;
    const newRel: Relation = {
      id: relId,
      type: connectType as Relation["type"],
      source: connectDialog.source,
      target: connectDialog.target,
      label: connectType,
      confidence: 1,
    };
    addRelation(newRel, currentViewId);
    setConnectDialog(null);
  }, [connectDialog, connectType, addRelation, currentViewId]);

  // Keyboard Delete handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs/textareas/selects
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const hasSelection = !!selectedSymbolId || !!selectedEdgeId;
        if (!hasSelection) return;
        e.preventDefault();
        if (selectedSymbolId) {
          removeSymbol(selectedSymbolId);
          selectSymbol(null);
        } else if (selectedEdgeId) {
          // For projected edges, find underlying relation IDs
          const directRel = graph?.relations.find((r) => r.id === selectedEdgeId);
          if (directRel) {
            removeRelation(selectedEdgeId);
          } else {
            // Projected edge: parse "source|target", "source|target|type"
            // or unaggregated "source|target|type|relationId"
            const parts = selectedEdgeId.split("|");
            if (parts.length === 3) {
              const rels = graph?.relations.filter(
                (r) => r.type === parts[2] && r.source === parts[0] && r.target === parts[1],
              ) ?? [];
              removeRelations(rels.map((r) => r.id));
            } else if (parts.length === 4) {
              const rel = graph?.relations.find((r) => r.id === parts[3]);
              if (rel) {
                removeRelation(rel.id);
              } else {
                const rels = graph?.relations.filter(
                  (r) => r.type === parts[2] && r.source === parts[0] && r.target === parts[1],
                ) ?? [];
                removeRelations(rels.map((r) => r.id));
              }
            } else if (parts.length === 2) {
              const rels = graph?.relations.filter(
                (r) => r.source === parts[0] && r.target === parts[1],
              ) ?? [];
              removeRelations(rels.map((r) => r.id));
            }
          }
          selectEdge(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedSymbolId,
    selectedEdgeId,
    removeSymbol,
    removeRelations,
    removeRelation,
    selectSymbol,
    selectEdge,
    graph,
  ]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const d = node.data as UmlNodeData;
      selectSymbol(d.symbolId);
    },
    [selectSymbol],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const d = node.data as UmlNodeData;
      if (d.childViewId) navigateToView(d.childViewId);
    },
    [navigateToView],
  );

  // Edge click → select in inspector
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const baseEdgeId = ((edge.data as { sequenceMessageId?: string } | undefined)?.sequenceMessageId) ?? edge.id;
      selectEdge(baseEdgeId);
    },
    [selectEdge],
  );

  // Root overview edge double-click → open sequence context. Other views keep inline label editing.
  const onEdgeDoubleClick: EdgeMouseHandler = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      event.preventDefault();
      if (currentView?.scope === "root" && renderMode !== "sequence" && graph) {
        const relationIds = ((edge.data as { relationIds?: string[] } | undefined)?.relationIds ?? [])
          .filter((id) => graph.relations.some((relation) => relation.id === id));
        const sourceLabel = graph.symbols.find((symbol) => symbol.id === edge.source)?.label ?? edge.source;
        const targetLabel = graph.symbols.find((symbol) => symbol.id === edge.target)?.label ?? edge.target;
        openSequenceContext({
          originViewId: currentView.id,
          sourceSymbolId: edge.source,
          targetSymbolId: edge.target,
          edgeId: edge.id,
          relationIds,
          title: `${sourceLabel} -> ${targetLabel}`,
        });
        return;
      }
      if (renderMode === "sequence") {
        return;
      }
      // Get real relation IDs from projected edge data
      const relIds = (edge.data as any)?.relationIds as string[] | undefined;
      const validRelIds = (relIds ?? []).filter((id) => graph?.relations.some((r) => r.id === id));
      const firstRel = validRelIds.length > 0 ? graph?.relations.find((r) => r.id === validRelIds[0]) : undefined;
      // Store ALL relation IDs for batch update
      setEditingEdgeId(edge.id);
      setEditingRelationIds(validRelIds);
      setEditingEdgeLabel(firstRel?.label ?? firstRel?.type ?? edge.label?.toString() ?? "");
      setEditingEdgePos({ x: event.clientX, y: event.clientY });
    },
    [currentView, graph, openSequenceContext, renderMode],
  );

  const commitEdgeLabel = useCallback(() => {
    if (editingEdgeId && editingEdgeLabel.trim()) {
      if (editingRelationIds.length > 0) {
        // Update ALL underlying relations of this projected edge
        updateRelations(editingRelationIds, { label: editingEdgeLabel.trim() });
      } else {
        // Fallback: try as direct relation ID
        updateRelation(editingEdgeId, { label: editingEdgeLabel.trim() });
      }
    }
    setEditingEdgeId(null);
    setEditingRelationIds([]);
    setEditingEdgePos(null);
  }, [editingEdgeId, editingEdgeLabel, editingRelationIds, updateRelation, updateRelations]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/uml-kind");
      if (!kind || !currentViewId) return;

      const position = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const symId = `manual-${Date.now()}`;

      // Create a real Symbol in the graph
      const newSym: Sym = {
        id: symId,
        label: `New ${kind}`,
        kind: kind as any,
        tags: [],
      };
      addSymbolToGraph(newSym, currentViewId);

      if (isAutoLayoutActive) {
        return;
      }

      // Save the drop position so manual layouts preserve it.
      saveNodePositions([{ symbolId: symId, x: position.x, y: position.y }]);

      // Also add to local React Flow nodes immediately for visual feedback
      const newNode: Node = {
        id: symId,
        type: "uml",
        draggable: nodesDraggable,
        position,
        data: {
          label: newSym.label,
          kind: newSym.kind,
          symbolId: symId,
          summary: "",
        } satisfies UmlNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes, currentViewId, addSymbolToGraph, isAutoLayoutActive, nodesDraggable, saveNodePositions],
  );

  // Click on canvas background → deselect
  const onPaneClick = useCallback(() => {
    selectSymbol(null);
    selectEdge(null);
    clearReviewHighlight();
    // Edge label commit is handled by onBlur already — don't trigger twice
  }, [clearReviewHighlight, selectSymbol, selectEdge]);

  // Save node positions after drag (auto-persist)
  const onNodeDragStart = useCallback((_event: React.MouseEvent, _node: Node, _draggedNodes: Node[]) => {
    if (isAutoLayoutActive) return;
    setHoverInteractionBlocked(true);
    setHoverNodeId(null);
    setIsNodeDragActive(true);
  }, [isAutoLayoutActive]);

  const onNodeDrag = useCallback((_event: React.MouseEvent, _node: Node, _draggedNodes: Node[]) => {
    if (isAutoLayoutActive) return;
    setHoverNodeId(null);
  }, [isAutoLayoutActive]);

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, _node: Node, draggedNodes: Node[]) => {
      if (isAutoLayoutActive) {
        setIsNodeDragActive(false);
        setHoverInteractionBlocked(false, 240);
        return;
      }
      if (currentViewId) {
        manualLayoutViewIdsRef.current.add(currentViewId);
      }
      suppressNextGraphResetRef.current = true;
      const nodesById = new Map(nodes.map((n) => [n.id, n]));
      for (const draggedNode of draggedNodes) {
        nodesById.set(draggedNode.id, draggedNode);
      }
      const nodesToPersist = projectionMode === "class"
        ? [...nodesById.values()]
        : draggedNodes;
      const positions = nodesToPersist.map((n) => {
        const style = n.style as { width?: unknown; height?: unknown } | undefined;
        const styleWidth = typeof style?.width === "number" ? style.width : undefined;
        const styleHeight = typeof style?.height === "number" ? style.height : undefined;
        return {
          symbolId: (n.data as UmlNodeData).symbolId,
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? styleWidth,
          height: n.measured?.height ?? styleHeight,
          parentId: n.parentId,
          extent: n.extent === "parent" ? "parent" as const : undefined,
        };
      });
      saveNodePositions(positions);
      setIsNodeDragActive(false);
      // Prevent immediate hover re-open right after drag release.
      setHoverInteractionBlocked(false, 240);
    },
    [currentViewId, isAutoLayoutActive, nodes, projectionMode, saveNodePositions],
  );

  const onMoveStart = useCallback(() => {
    setHoverInteractionBlocked(true);
    setHoverNodeId(null);
  }, []);

  const onMoveEnd = useCallback(() => {
    persistCurrentViewport();
    setIsNodeDragActive(false);
    setHoverInteractionBlocked(false, 240);
  }, [persistCurrentViewport]);

  useEffect(() => {
    const onCanvasCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = detail?.action;
      if (!action) return;

      if ((action === "export-project-html" || action === "export-project") && graph) {
        exportProjectAsHtml(graph, diagramSettings);
        return;
      }

      if (action === "export-project-package" && graph) {
        exportProjectPackage(graph);
        return;
      }

      if (action === "export-view") {
        const view = graph?.views.find((v) => v.id === currentViewId);
        exportDiagramAsHtml(nodes, edges, view?.title ?? "diagram", diagramSettings);
      }
    };

    window.addEventListener("dmpg:canvas-command", onCanvasCommand as EventListener);
    return () => window.removeEventListener("dmpg:canvas-command", onCanvasCommand as EventListener);
  }, [currentViewId, diagramSettings, edges, graph, nodes]);

  const handleFitView = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
    scheduleViewportPersist(360, currentViewId);
  }, [currentViewId, reactFlowInstance, scheduleViewportPersist]);

  return (
    <div className="canvas-area">
      <UmlMarkerDefs />
      <ReactFlow
        className={renderMode === "sequence" ? "canvas-flow canvas-flow--sequence" : "canvas-flow"}
        style={renderMode === "sequence" ? { background: "#f7f8fc" } : undefined}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: diagramSettings.edgeType }}
        nodesDraggable={nodesDraggable}
        fitView
        minZoom={0.05}
        proOptions={proOptions}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={renderMode === "sequence" ? 22 : 20}
          size={1}
          color={renderMode === "sequence" ? "#e3e7ef" : "#2d3148"}
        />
        <Controls onFitView={handleFitView}>
          <ControlButton
            className={`canvas-control-button canvas-control-button--artifact-mode canvas-control-button--artifact-input canvas-control-button--mode-${diagramSettings.inputArtifactMode}`}
            onClick={cycleInputArtifactMode}
            title={artifactControlLabel("Eingaben", diagramSettings.inputArtifactMode, INPUT_ARTIFACT_MODE_TEXT)}
            aria-label={artifactControlLabel("Eingaben", diagramSettings.inputArtifactMode, INPUT_ARTIFACT_MODE_TEXT)}
          >
            <i className="bi bi-download" />
            <span>{artifactControlLabel("Eingaben", diagramSettings.inputArtifactMode, INPUT_ARTIFACT_MODE_TEXT)}</span>
          </ControlButton>
          <ControlButton
            className={`canvas-control-button canvas-control-button--artifact-mode canvas-control-button--artifact-generated canvas-control-button--mode-${diagramSettings.generatedArtifactMode}`}
            onClick={cycleGeneratedArtifactMode}
            title={artifactControlLabel("Ausgaben", diagramSettings.generatedArtifactMode, OUTPUT_ARTIFACT_MODE_TEXT)}
            aria-label={artifactControlLabel("Ausgaben", diagramSettings.generatedArtifactMode, OUTPUT_ARTIFACT_MODE_TEXT)}
          >
            <i className="bi bi-upload" />
            <span>{artifactControlLabel("Ausgaben", diagramSettings.generatedArtifactMode, OUTPUT_ARTIFACT_MODE_TEXT)}</span>
          </ControlButton>
        </Controls>
        <MiniMap
          nodeStrokeColor="#6c8cff"
          nodeColor={(n) => {
            const d = n.data as UmlNodeData;
            if (d.kind === "group") return "rgba(108,140,255,0.3)";
            if (d.kind === "class") return "rgba(255,216,102,0.3)";
            if (d.kind === "function" || d.kind === "method") return "rgba(128,224,160,0.3)";
            if (d.kind === "external") return "rgba(139,143,167,0.3)";
            if (d.kind === "module") return "rgba(108,140,255,0.2)";
            return "rgba(35,38,58,0.8)";
          }}
          maskColor="rgba(15,17,23,0.7)"
        />
      </ReactFlow>

      {/* AI Working Overlay — shows current LLM status on canvas */}
      {aiRunning && (
        <div className="ai-canvas-overlay">
          <span className="ai-spinner" />
          <span className={`ai-phase-badge ai-phase-badge--${aiPhase}`}>{aiPhase || "starting…"}</span>
          {aiThought && <span className="ai-canvas-overlay__thought">{aiThought}</span>}
          {aiNavPaused && <span className="ai-canvas-overlay__paused"><i className="bi bi-compass" /> Nav pausiert</span>}
        </div>
      )}

      {showScanLoadingOverlay && (
        <div className="scan-canvas-loading" aria-live="polite">
          <div className="scan-canvas-loading__panel">
            <span className="ai-spinner scan-canvas-loading__spinner" />
            <div className="scan-canvas-loading__content">
              <div className="scan-canvas-loading__title">Projekt wird neu gescannt</div>
              <div className="scan-canvas-loading__message">
                {scanStatus.message ?? "AST-Scanner und Pyreverse-Klassendiagramm laufen"}
              </div>
              {scanWarnings.length > 0 && (
                <div className="scan-canvas-loading__warnings">
                  {scanWarnings.slice(0, 2).map((warning) => (
                    <div key={warning} className="scan-canvas-loading__warning">
                      <i className="bi bi-exclamation-triangle" /> {warning}
                    </div>
                  ))}
                </div>
              )}
              <div className="scan-canvas-loading__meta">{scanProgressText}</div>
            </div>
          </div>
        </div>
      )}

      {showScanIdleOverlay && (
        <div className="scan-canvas-loading scan-canvas-loading--idle" aria-live="polite">
          <div className="scan-canvas-loading__panel">
            <div className="scan-canvas-loading__content">
              <div className="scan-canvas-loading__title">Noch kein Scan geladen</div>
              <div className="scan-canvas-loading__message">
                {scanStatus.message ?? "Projekt auswaehlen oder Rescan starten"}
              </div>
              <div className="scan-canvas-loading__meta">{scanStatus.projectPath}</div>
            </div>
          </div>
        </div>
      )}

      {/* Export buttons */}
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 5, display: "flex", gap: 4 }}>
        <button
          className="export-btn"
          onClick={() => {
            if (graph) exportProjectPackage(graph);
          }}
          title="Komplettes UML-Projekt als importierbares Projektpaket exportieren"
        >
          <i className="bi bi-box-arrow-up" /> Projektpaket
        </button>
        <button
          className="export-btn"
          onClick={() => {
            if (graph) exportProjectAsHtml(graph, diagramSettings);
          }}
          title="Komplettes UML-Projekt als HTML exportieren (alle Views + Navigation)"
        >
          <i className="bi bi-filetype-html" /> HTML Projekt
        </button>
        <button
          className="export-btn"
          onClick={() => {
            const view = graph?.views.find((v) => v.id === currentViewId);
            exportDiagramAsHtml(nodes, edges, view?.title ?? "diagram", diagramSettings);
          }}
          title="Nur aktuelle Ansicht als HTML exportieren"
        >
          <i className="bi bi-file-earmark" /> HTML View
        </button>
      </div>

      {/* Inline edge label editor */}
      {editingEdgeId && editingEdgePos && (
        <div
          className="edge-label-editor"
          style={{
            position: "fixed",
            left: editingEdgePos.x - 80,
            top: editingEdgePos.y - 16,
            zIndex: 1000,
          }}
        >
          <input
            autoFocus
            className="edge-label-input"
            value={editingEdgeLabel}
            onChange={(e) => setEditingEdgeLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdgeLabel();
              if (e.key === "Escape") { setEditingEdgeId(null); setEditingEdgePos(null); }
            }}
            onBlur={commitEdgeLabel}
            placeholder="Beziehungslabel (z. B. calls, imports…)"
          />
        </div>
      )}

      {/* Symbol hover card (pinnable tooltip) */}
      <SymbolHoverCard />

      {/* Connection type dialog */}
      {connectDialog && (
        <div className="connect-type-dialog-overlay" onClick={() => setConnectDialog(null)}>
          <div className="connect-type-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="connect-type-dialog-title">Verbindungstyp wählen</div>
            <div className="connect-type-dialog-subtitle">
              {graph?.symbols.find((s) => s.id === connectDialog.source)?.label ?? connectDialog.source}
              {" → "}
              {graph?.symbols.find((s) => s.id === connectDialog.target)?.label ?? connectDialog.target}
            </div>
            <div className="connect-type-options">
              {CONNECT_TYPES.map((t) => (
                <button
                  key={t}
                  className={`connect-type-option${connectType === t ? " connect-type-option--active" : ""}`}
                  onClick={() => setConnectType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="connect-type-dialog-actions">
              <button className="btn btn-sm btn-primary" onClick={handleConfirmConnect}>
                <i className="bi bi-check-circle" /> Verbinden
              </button>
              <button className="btn btn-sm" onClick={() => setConnectDialog(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
