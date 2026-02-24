import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
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
import { SymbolHoverCard } from "./SymbolHoverCard";
import { layoutNodes } from "../layout";
import { exportDiagramAsHtml, exportProjectAsHtml } from "../exportHtml";
import type { UmlNodeData } from "./UmlNode";
import type { Relation, Symbol as Sym } from "@dmpg/shared";
import { projectEdgesForView } from "@dmpg/shared";

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
  if (normalized.endsWith("right") || normalized.endsWith("east")) return Position.Right;
  if (normalized.endsWith("left") || normalized.endsWith("west")) return Position.Left;
  if (normalized.endsWith("north") || normalized.endsWith("top")) return Position.Top;
  if (normalized.endsWith("south") || normalized.endsWith("bottom")) return Position.Bottom;
  return Position.Bottom;
}

export function Canvas() {
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const reactFlowInstance = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const layoutRef = useRef(false);
  const layoutPassRef = useRef(0); // 0 = idle, 1 = first pass done, 2 = second pass done
  const prevLayoutKeyRef = useRef<string>("");

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

  // Build nodes/edges from current view using edge projection
  const { viewNodes, viewEdges } = useMemo(() => {
    if (!graph || !currentViewId) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const view = graph.views.find((v) => v.id === currentViewId);
    if (!view) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const scope = (view as any).scope as string | undefined;

    // Pre-compute relation badges per symbol: which relation types touch each symbol?
    // Badges are directional: "out:<type>" for source, "in:<type>" for target
    const relBadgeMap = new Map<string, Set<string>>();
    for (const rel of graph.relations) {
      if (rel.type === "contains") continue;
      const srcSet = relBadgeMap.get(rel.source) ?? new Set();
      srcSet.add(`out:${rel.type}`);
      relBadgeMap.set(rel.source, srcSet);
      const tgtSet = relBadgeMap.get(rel.target) ?? new Set();
      tgtSet.add(`in:${rel.type}`);
      relBadgeMap.set(rel.target, tgtSet);
    }

    const vNodes: Node[] = view.nodeRefs.map((symId, i) => {
      const sym = graph.symbols.find((s) => s.id === symId);
      if (!sym) return null;

      const savedPos = view.nodePositions?.find((p) => p.symbolId === symId);

      // Choose node type based on symbol kind and view scope
      let nodeType = "uml";
      if (sym.kind === "group") nodeType = "umlGroup";
      else if (sym.kind === "external") nodeType = "umlArtifact";
      else if (sym.kind === "class" && (scope === "group" || scope === "module")) nodeType = "umlClass";
      else if (sym.kind === "module" && scope === "group") nodeType = "umlGroup";
      else if (sym.kind === "function" || sym.kind === "method") nodeType = "umlFunction";

      // Gather children for class nodes (show members inline)
      const children = (sym.kind === "class" || sym.kind === "module")
        ? graph.symbols.filter((s) => s.parentId === sym.id)
        : [];

      // Extra CSS classes
      const isDeadCode = sym.tags?.includes("dead-code");
      const extraClass = isDeadCode ? "dead-code" : "";

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
        className: extraClass || undefined,
        data: {
          label: sym.label,
          kind: sym.kind,
          summary: sym.doc?.summary,
          symbolId: sym.id,
          childViewId: sym.childViewId,
          inputs: sym.doc?.inputs,
          outputs: sym.doc?.outputs,
          children,
          tags: sym.tags,
          relationBadges,
          location: sym.location,
        } satisfies UmlNodeData,
      } satisfies Node;
    }).filter(Boolean) as Node[];

    // Use edge projection instead of strict endpoint filtering
    const projected = projectEdgesForView(view, graph.symbols, graph.relations);

    // Detect bidirectional pairs: if both A→B and B→A exist, route the
    // "reverse" edge through Left/Right handles to avoid overlapping paths
    const edgeKeys = new Set(projected.map((pe) => pe.key));
    const reverseSet = new Set<string>(); // keys that are the "reverse" direction
    for (const pe of projected) {
      const reverse = `${pe.target}|${pe.source}`;
      if (edgeKeys.has(reverse) && !reverseSet.has(pe.key)) {
        // Mark the reverse direction (the one we encounter second) for alt routing
        reverseSet.add(reverse);
      }
    }

    const vEdges: Edge[] = projected.map((pe) => {
      const isReverse = reverseSet.has(pe.key);
      const sourceHandle = isReverse ? "out-right" : "out-bottom";
      const targetHandle = isReverse ? "in-left" : "in-top";
      return {
        id: pe.key,
        source: pe.source,
        target: pe.target,
        sourceHandle,
        targetHandle,
        sourcePosition: positionFromHandle(sourceHandle),
        targetPosition: positionFromHandle(targetHandle),
        type: "step",
        label: pe.label,
        animated: pe.animated,
        className: pe.className,
        data: { relationIds: pe.relationIds, relationType: pe.type },
      };
    });

    return { viewNodes: vNodes, viewEdges: vEdges };
  }, [graph, currentViewId]);

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
    const layoutKey = `${currentViewId}|${nodeFingerprint}`;

    if (layoutKey === prevLayoutKeyRef.current) {
      // Node structure unchanged — update node data & edges without repositioning
      setNodes((prev) => {
        const viewNodeMap = new Map(viewNodes.map((vn) => [vn.id, vn]));
        return prev.map((n) => {
          const updated = viewNodeMap.get(n.id);
          return updated
            ? { ...n, data: updated.data, className: updated.className }
            : n;
        });
      });
      setEdges(viewEdges);
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
      setNodes(viewNodes);
      setEdges(viewEdges);
      layoutRef.current = false;
      layoutPassRef.current = 2;
      setLayoutDone(true);
      return;
    }

    // Need ELK layout for unsaved nodes
    setLayoutDone(false);
    layoutRef.current = false;
    layoutPassRef.current = 0;

    layoutNodes(viewNodes, viewEdges).then((laid) => {
      // Preserve saved positions; use ELK only for new/unsaved nodes
      const result = laid.map((n) => {
        const saved = savedMap.get(n.id);
        return saved
          ? { ...n, position: { x: saved.x, y: saved.y } }
          : n;
      });
      setNodes(result);
      setEdges(viewEdges);
      layoutPassRef.current = 1;
      setLayoutDone(true);
    });
  }, [viewNodes, viewEdges, setNodes, setEdges, graph, currentViewId]);

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

    layoutNodes(nodes, edges).then((laid) => {
      const result = laid.map((n) => {
        const saved = savedMap.get(n.id);
        return saved
          ? { ...n, position: { x: saved.x, y: saved.y } }
          : n;
      });
      setNodes(result);
      // Short delay then fit
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.12, duration: 300 });
      }, 60);
    });
  }, [nodes, edges, layoutDone, setNodes, reactFlowInstance, graph, currentViewId]);

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
  const focusAppliedRef = useRef<string | null>(null);
  const lastFocusSeqRef = useRef(0);
  const pendingFocusRef = useRef<string | null>(null);
  const focusRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Core function to apply focus zoom + highlight
  const applyFocusZoom = useCallback((nodeId: string) => {
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
      document.querySelectorAll(".node-focus-highlight").forEach((prev) => {
        prev.classList.remove("node-focus-highlight");
      });

      const el = document.querySelector(`[data-id="${nodeId}"]`);
      if (el) {
        // Use ai-processing class during AI analysis, regular highlight otherwise
        const cls = aiRunning ? "ai-flash" : "node-focus-highlight";
        el.classList.add(cls);
        if (cls === "ai-flash") {
          setTimeout(() => el.classList.remove("ai-flash"), 1500);
        }
      }
      acknowledgeAiNavigationSettled(nodeId);
    }, 520);
  }, [reactFlowInstance, aiRunning, acknowledgeAiNavigationSettled]);

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

  // Clear focus highlight when user hovers over the focused node
  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (focusNodeId && node.id === focusNodeId) {
        const el = document.querySelector(`[data-id="${focusNodeId}"]`);
        if (el) el.classList.remove("node-focus-highlight");
        setFocusNode(null);
        focusAppliedRef.current = null;
      }
    },
    [focusNodeId, setFocusNode],
  );

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
  }, [selectedSymbolId, selectedEdgeId, removeSymbol, removeRelation, selectSymbol, selectEdge, graph]);

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
    // Edge label commit is handled by onBlur already — don't trigger twice
  }, [selectSymbol, selectEdge]);

  // Save node positions after drag (auto-persist)
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
    },
    [saveNodePositions],
  );

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
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{ type: "step" }}
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
            if (graph) exportProjectAsHtml(graph);
          }}
          title="Komplettes UML-Projekt als HTML exportieren (alle Views + Navigation)"
        >
          <i className="bi bi-download" /> Export Projekt
        </button>
        <button
          className="export-btn"
          onClick={() => {
            const view = graph?.views.find((v) => v.id === currentViewId);
            exportDiagramAsHtml(nodes, edges, view?.title ?? "diagram");
          }}
          title="Nur aktuelle Ansicht als HTML exportieren"
        >
          <i className="bi bi-file-earmark" /> Export View
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
