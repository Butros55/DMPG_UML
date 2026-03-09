import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
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
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useAppStore } from "../store";
import { UmlNode, UmlClassNode, UmlFunctionNode, UmlArtifactNode, UmlGroupNode } from "./UmlNode";
import { SymbolHoverCard, setHoverInteractionBlocked } from "./SymbolHoverCard";
import { layoutNodes, type LayoutResult, type PortInfo } from "../layout";
import { exportDiagramAsHtml, exportProjectAsHtml } from "../exportHtml";
import { exportProjectPackage } from "../projectTransfer";
import type { UmlNodeData } from "./UmlNode";
import type { ProjectedEdge, Relation, RelationType, Symbol as Sym } from "@dmpg/shared";
import { projectEdgesForView } from "@dmpg/shared";
import {
  EDGE_ANIMATED_BY_RELATION,
  EDGE_CLASS_BY_RELATION,
  RELATION_VERBS,
  type DiagramLabelMode,
} from "../diagramSettings";

const nodeTypes = {
  uml: UmlNode,
  umlClass: UmlClassNode,
  umlFunction: UmlFunctionNode,
  umlArtifact: UmlArtifactNode,
  umlGroup: UmlGroupNode,
};

const proOptions = { hideAttribution: true };

function positionFromHandle(handle: string): Position {
  const normalized = handle.toLowerCase();
  if (normalized.includes("right") || normalized.includes("east")) return Position.Right;
  if (normalized.includes("left") || normalized.includes("west")) return Position.Left;
  if (normalized.includes("north") || normalized.includes("top")) return Position.Top;
  if (normalized.includes("south") || normalized.includes("bottom")) return Position.Bottom;
  return Position.Bottom;
}

/** Apply dynamic port handle IDs from the layout result onto edges.
 *  DISABLED: React Flow cannot reliably resolve dynamically-added Handle
 *  elements in the same render cycle, causing all edges to disappear.
 *  Keep the infrastructure for future use; edges use static handles for now. */
function withDynamicHandles(
  edges: Edge[],
  _handleMap: Map<string, { sourceHandle: string; targetHandle: string }>,
): Edge[] {
  return edges; // pass-through — use static handles
}

/** Attach dynamic port data from layout result onto node.data */
function attachDynamicPorts(
  nodes: Node[],
  portsByNode: Map<string, PortInfo[]>,
): Node[] {
  return nodes.map((n) => {
    const ports = portsByNode.get(n.id);
    if (!ports || ports.length === 0) return n;
    return {
      ...n,
      data: { ...(n.data as object), dynamicPorts: ports },
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
      key: `${pe.source}|${pe.target}`,
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

function isArtifactLikeSymbol(symbol: Pick<Sym, "kind" | "umlType">): boolean {
  return (
    symbol.kind === "external" ||
    symbol.umlType === "artifact" ||
    symbol.umlType === "database" ||
    symbol.umlType === "component" ||
    symbol.umlType === "note" ||
    symbol.umlType === "external"
  );
}

export function Canvas() {
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const reviewHighlight = useAppStore((s) => s.reviewHighlight);
  const clearReviewHighlight = useAppStore((s) => s.clearReviewHighlight);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const addSymbolToGraph = useAppStore((s) => s.addSymbolToGraph);
  const addRelation = useAppStore((s) => s.addRelation);
  const updateRelation = useAppStore((s) => s.updateRelation);
  const updateRelations = useAppStore((s) => s.updateRelations);
  const removeSymbol = useAppStore((s) => s.removeSymbol);
  const removeRelation = useAppStore((s) => s.removeRelation);
  const saveNodePositions = useAppStore((s) => s.saveNodePositions);
  const diagramSettings = useAppStore((s) => s.diagramSettings);
  const layoutVersion = useAppStore((s) => s.diagramLayoutVersion);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const reactFlowInstance = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const layoutRef = useRef(false);
  const layoutPassRef = useRef(0); // 0 = idle, 1 = first pass done, 2 = second pass done
  const prevLayoutKeyRef = useRef<string>("");

  // Dynamic port handle mapping from ELK layout (persists across layout passes)
  const edgeHandlesRef = useRef<Map<string, { sourceHandle: string; targetHandle: string }>>(new Map());

  // Node hover highlighting — dims unrelated edges
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

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
  const CONNECT_TYPES = ["imports", "contains", "calls", "reads", "writes", "inherits", "uses_config", "instantiates"] as const;

  useEffect(() => {
    return () => {
      setHoverInteractionBlocked(false);
    };
  }, []);

  // Build nodes/edges from current view using edge projection
  const { viewNodes, viewEdges } = useMemo(() => {
    if (!graph || !currentViewId) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const view = graph.views.find((v) => v.id === currentViewId);
    if (!view) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const scope = (view as any).scope as string | undefined;
    const hiddenSymbolIds = diagramSettings.showArtifacts
      ? new Set<string>()
      : new Set(graph.symbols.filter((symbol) => isArtifactLikeSymbol(symbol)).map((symbol) => symbol.id));
    const visibleViewNodeRefs = view.nodeRefs.filter((id) => !hiddenSymbolIds.has(id));
    const visibleViewNodeRefSet = new Set(visibleViewNodeRefs);
    const visibleRelations = graph.relations.filter(
      (rel) => !hiddenSymbolIds.has(rel.source) && !hiddenSymbolIds.has(rel.target),
    );
    const relationMap = new Map(graph.relations.map((rel) => [rel.id, rel]));
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
    for (const rel of visibleRelations) {
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
      const sym = graph.symbols.find((s) => s.id === symId);
      if (!sym) return null;

      const savedPos = view.nodePositions?.find((p) => p.symbolId === symId);

      // Choose node type based on symbol kind and view scope
      let nodeType = "uml";
      if (sym.umlType === "database" || sym.umlType === "artifact" || sym.umlType === "component" || sym.umlType === "note") {
        nodeType = "umlArtifact";
      } else if (sym.umlType === "package") {
        nodeType = "umlGroup";
      } else if (sym.kind === "group") nodeType = "umlGroup";
      else if (sym.kind === "external") nodeType = "umlArtifact";
      else if (sym.kind === "class" && (scope === "group" || scope === "module")) nodeType = "umlClass";
      else if (sym.kind === "module" && scope === "group") nodeType = "umlGroup";
      else if (sym.kind === "function" || sym.kind === "method") nodeType = "umlFunction";

      // Gather children for class nodes (show members inline)
      const children = (sym.kind === "class" || sym.kind === "module")
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
      const relationBadges = Array.from(childBadges).filter((t) => !t.endsWith(":imports"));

      return {
        id: sym.id,
        type: nodeType,
        position: savedPos ? { x: savedPos.x, y: savedPos.y } : { x: i * 250, y: i * 120 },
        className: nodeClasses.join(" ") || undefined,
        data: {
          label: sym.label,
          kind: sym.kind,
          umlType: sym.umlType,
          summary: sym.doc?.summary,
          symbolId: sym.id,
          childViewId: sym.childViewId,
          inputs: sym.doc?.inputs,
          outputs: sym.doc?.outputs,
          children,
          tags: sym.tags,
          relationBadges,
          location: sym.location,
          compactMode: diagramSettings.nodeCompactMode,
          labelsMode: diagramSettings.labels,
        } satisfies UmlNodeData,
      } satisfies Node;
    }).filter(Boolean) as Node[];

    // Use edge projection instead of strict endpoint filtering
    const projected = projectEdgesForView(
      { ...view, nodeRefs: visibleViewNodeRefs },
      graph.symbols,
      visibleRelations,
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
        className: `${pe.className}${edgeVisibilityClass}${edgeReviewClass}`,
        style: { strokeWidth: diagramSettings.edgeStrokeWidth },
        data: { relationIds: pe.relationIds, relationType: pe.type },
      };
    });

    return { viewNodes: scopedNodes, viewEdges: vEdges };
  }, [
    graph,
    currentViewId,
    diagramSettings,
    selectedSymbolId,
    reviewHighlight.nodeIds,
    reviewHighlight.previewNodeIds,
    reviewHighlight.primaryNodeId,
    reviewHighlight.viewId,
  ]);

  // Apply ELK layout — Pass 1 (estimate)
  // Only re-layout when the view or node set actually changes (not on position/data-only updates)
  useEffect(() => {
    if (viewNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      prevLayoutKeyRef.current = "";
      return;
    }

    // Build key from structure + size-affecting data (node IDs, input/output counts)
    // When AI analysis adds parameters/outputs to function nodes, the fingerprint
    // changes and ELK re-layout runs to prevent node overlaps.
    const nodeFingerprint = viewNodes
      .map((n) => {
        const d = n.data as UmlNodeData;
        return `${n.id}:${d.inputs?.length ?? 0}:${d.outputs?.length ?? 0}`;
      })
      .sort()
      .join(",");
    const layoutKey = `${currentViewId}|${nodeFingerprint}|${layoutVersion}`;

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
            // Do NOT overwrite position — keep ELK/user-dragged position from prev
            data: { ...updated.data, dynamicPorts: prevPorts },
            className: updated.className,
          };
        });
      });
      setEdges(withDynamicHandles(viewEdges, edgeHandlesRef.current));
      return;
    }
    prevLayoutKeyRef.current = layoutKey;

    // Check which nodes have saved positions
    const view = graph?.views.find((v) => v.id === currentViewId);
    const savedMap = new Map(
      (view?.nodePositions ?? []).map((p) => [p.symbolId, p]),
    );
    const allHaveSavedPos = viewNodes.every((n) => savedMap.has(n.id));

    if (allHaveSavedPos) {
      // All nodes already have manual/saved positions — skip ELK entirely
      // Still run layout just for port computation (dynamic handles)
      edgeHandlesRef.current = new Map();
      layoutNodes(
        viewNodes,
        viewEdges,
        diagramSettings.layout,
        diagramSettings.nodeCompactMode,
      ).then(({ portsByNode, edgeHandles }) => {
        edgeHandlesRef.current = edgeHandles;
        setNodes(attachDynamicPorts(viewNodes, portsByNode));
        setEdges(withDynamicHandles(viewEdges, edgeHandles));
      });
      layoutRef.current = false;
      layoutPassRef.current = 2;
      setLayoutDone(true);
      return;
    }

    // Need ELK layout for unsaved nodes
    setLayoutDone(false);
    layoutRef.current = false;
    layoutPassRef.current = 0;

    layoutNodes(
      viewNodes,
      viewEdges,
      diagramSettings.layout,
      diagramSettings.nodeCompactMode,
    ).then(({ nodes: laid, portsByNode, edgeHandles }) => {
      edgeHandlesRef.current = edgeHandles;
      // Preserve saved positions; use ELK only for new/unsaved nodes
      const positioned = laid.map((n) => {
        const saved = savedMap.get(n.id);
        return saved
          ? { ...n, position: { x: saved.x, y: saved.y } }
          : n;
      });
      setNodes(attachDynamicPorts(positioned, portsByNode));
      setEdges(withDynamicHandles(viewEdges, edgeHandles));
      layoutPassRef.current = 1;
      setLayoutDone(true);
    });
  }, [
    viewNodes,
    viewEdges,
    setNodes,
    setEdges,
    graph,
    currentViewId,
    layoutVersion,
    diagramSettings.layout,
    diagramSettings.nodeCompactMode,
  ]);

  // Pass 2: re-layout with measured sizes (React Flow measures after first render)
  useEffect(() => {
    if (layoutPassRef.current !== 1 || !layoutDone) return;
    // Check if any node has been measured by React Flow
    const hasMeasured = nodes.some((n) => n.measured?.width && n.measured?.height);
    if (!hasMeasured) return;

    layoutPassRef.current = 2; // prevent infinite loop

    // Preserve saved positions in pass 2 as well
    const view = graph?.views.find((v) => v.id === currentViewId);
    const savedMap = new Map(
      (view?.nodePositions ?? []).map((p) => [p.symbolId, p]),
    );

    layoutNodes(
      nodes,
      edges,
      diagramSettings.layout,
      diagramSettings.nodeCompactMode,
    ).then(({ nodes: laid, portsByNode, edgeHandles }) => {
      edgeHandlesRef.current = edgeHandles;
      const positioned = laid.map((n) => {
        const saved = savedMap.get(n.id);
        return saved
          ? { ...n, position: { x: saved.x, y: saved.y } }
          : n;
      });
      setNodes(attachDynamicPorts(positioned, portsByNode));
      setEdges((prev) => withDynamicHandles(prev, edgeHandles));
      // Short delay then fit
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.12, duration: 300 });
      }, 60);
    });
  }, [
    nodes,
    edges,
    layoutDone,
    setNodes,
    reactFlowInstance,
    graph,
    currentViewId,
    diagramSettings.layout,
    diagramSettings.nodeCompactMode,
  ]);

  // Fit view after first layout pass
  useEffect(() => {
    if (layoutDone && !layoutRef.current) {
      layoutRef.current = true;
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
      }, 50);
    }
  }, [layoutDone, reactFlowInstance]);

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
  const appliedViewFitSeqRef = useRef(0);

  // Core function to apply focus zoom + highlight
  const applyFocusZoom = useCallback((nodeId: string) => {
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
    } else {
      reactFlowInstance.fitView({
        nodes: [{ id: nodeId }],
        duration: 500,
        padding: 0.1,
        maxZoom: 2,
      });
    }
    setTimeout(() => {
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
  }, [reactFlowInstance, aiRunning, acknowledgeAiNavigationSettled, graph]);

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
    if (!exists || !layoutDone || layoutPassRef.current < 2 || !nodesInitialized) {
      // Layout not ready — store as pending and retry
      pendingFocusRef.current = focusNodeId;
      console.debug(`[Canvas-Focus] pending id=${focusNodeId} seq=${focusSeq} exists=${exists} layoutPass=${layoutPassRef.current} nodesInit=${nodesInitialized}`);
      return;
    }

    // Layout is ready — apply focus
    console.debug(`[Canvas-Focus] applying id=${focusNodeId} seq=${focusSeq} layoutPass=${layoutPassRef.current} nodesInit=${nodesInitialized}`);
    focusAppliedRef.current = focusNodeId;
    lastFocusSeqRef.current = focusSeq;
    pendingFocusRef.current = null;
    setTimeout(() => applyFocusZoom(focusNodeId), 300);
  }, [focusNodeId, focusSeq, layoutDone, nodes, nodesInitialized, reactFlowInstance, setFocusNode, applyFocusZoom]);

  // Retry pending focus after layout pass 2 completes (also checks nodesInitialized)
  useEffect(() => {
    if (!layoutDone || layoutPassRef.current < 2 || !nodesInitialized) return;
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const isNewBySeq = focusSeq > lastFocusSeqRef.current;
    const isNewByNode = focusAppliedRef.current !== pending;
    if (!isNewBySeq && !isNewByNode) return;

    // Check node exists now that layout is done
    const exists = nodes.some((n) => n.id === pending);
    if (!exists) return;

    console.debug(`[Canvas-Focus] retry-apply id=${pending} seq=${focusSeq}`);
    focusAppliedRef.current = pending;
    lastFocusSeqRef.current = focusSeq;
    pendingFocusRef.current = null;
    setTimeout(() => applyFocusZoom(pending), 300);
  }, [layoutDone, nodes, nodesInitialized, applyFocusZoom, focusSeq]);

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
      setTimeout(() => applyFocusZoom(id), 100);
    }, 200);
    return () => {
      if (focusRetryRef.current) { clearInterval(focusRetryRef.current); focusRetryRef.current = null; }
    };
  }, [focusNodeId, focusSeq, nodes, applyFocusZoom]);

  useEffect(() => {
    if (reviewHighlight.seq <= appliedReviewSeqRef.current) return;

    if (!reviewHighlight.fitView || reviewHighlight.nodeIds.length === 0) {
      appliedReviewSeqRef.current = reviewHighlight.seq;
      return;
    }
    if (!reviewHighlight.viewId || reviewHighlight.viewId !== currentViewId) return;
    if (!layoutDone || layoutPassRef.current < 2 || !nodesInitialized) return;

    const visibleTargetIds = reviewHighlight.nodeIds.filter((id) => nodes.some((node) => node.id === id));
    appliedReviewSeqRef.current = reviewHighlight.seq;
    if (visibleTargetIds.length === 0) return;

    requestAnimationFrame(() => applyReviewFit(visibleTargetIds));
  }, [
    applyReviewFit,
    currentViewId,
    layoutDone,
    nodes,
    nodesInitialized,
    reviewHighlight.fitView,
    reviewHighlight.nodeIds,
    reviewHighlight.seq,
    reviewHighlight.viewId,
  ]);

  useEffect(() => {
    if (viewFitSeq <= appliedViewFitSeqRef.current) return;
    if (!viewFitViewId || viewFitViewId !== currentViewId) return;
    if (!layoutDone || !nodesInitialized || nodes.length === 0) return;

    appliedViewFitSeqRef.current = viewFitSeq;
    requestAnimationFrame(() => {
      reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
    });
  }, [
    currentViewId,
    layoutDone,
    nodes.length,
    nodesInitialized,
    reactFlowInstance,
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
            // Projected edge: parse "source|target|type"
            const parts = selectedEdgeId.split("|");
            if (parts.length === 3) {
              const rels = graph?.relations.filter(
                (r) => r.type === parts[2] && r.source === parts[0] && r.target === parts[1],
              ) ?? [];
              rels.forEach((r) => removeRelation(r.id));
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
      selectEdge(edge.id);
    },
    [selectEdge],
  );

  // Edge double-click → open label editor inline
  const onEdgeDoubleClick: EdgeMouseHandler = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      event.preventDefault();
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
    [graph],
  );

  const commitEdgeLabel = useCallback(() => {
    if (editingEdgeId && editingEdgeLabel.trim()) {
      console.log("[Canvas] Commit edge label:", editingEdgeId, "relationIds:", editingRelationIds, "label:", editingEdgeLabel.trim());
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

      // Save the drop position so ELK relayout preserves it
      saveNodePositions([{ symbolId: symId, x: position.x, y: position.y }]);

      // Also add to local React Flow nodes immediately for visual feedback
      const newNode: Node = {
        id: symId,
        type: "uml",
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
    [reactFlowInstance, setNodes, currentViewId, addSymbolToGraph, saveNodePositions],
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
    setHoverInteractionBlocked(true);
    setHoverNodeId(null);
  }, []);

  const onNodeDrag = useCallback((_event: React.MouseEvent, _node: Node, _draggedNodes: Node[]) => {
    setHoverNodeId(null);
  }, []);

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, _node: Node, draggedNodes: Node[]) => {
      const positions = draggedNodes.map((n) => ({
        symbolId: (n.data as UmlNodeData).symbolId,
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width,
        height: n.measured?.height,
      }));
      saveNodePositions(positions);
      // Prevent immediate hover re-open right after drag release.
      setHoverInteractionBlocked(false, 560);
    },
    [saveNodePositions],
  );

  const onMoveStart = useCallback(() => {
    setHoverInteractionBlocked(true);
    setHoverNodeId(null);
  }, []);

  const onMoveEnd = useCallback(() => {
    setHoverInteractionBlocked(false, 560);
  }, []);

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

  return (
    <div className="canvas-area">
      <ReactFlow
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
        defaultEdgeOptions={{ type: diagramSettings.edgeType }}
        fitView
        minZoom={0.05}
        proOptions={proOptions}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2d3148" />
        <Controls />
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
            placeholder="Label (e.g. calls, imports…)"
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
