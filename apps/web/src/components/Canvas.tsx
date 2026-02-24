import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
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

export function Canvas() {
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const addSymbolToGraph = useAppStore((s) => s.addSymbolToGraph);
  const addRelation = useAppStore((s) => s.addRelation);
  const updateRelation = useAppStore((s) => s.updateRelation);
  const updateRelations = useAppStore((s) => s.updateRelations);
  const saveNodePositions = useAppStore((s) => s.saveNodePositions);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const reactFlowInstance = useReactFlow();
  const layoutRef = useRef(false);
  const layoutPassRef = useRef(0); // 0 = idle, 1 = first pass done, 2 = second pass done

  // AI analysis highlight
  const aiHighlightId = useAppStore((s) => s.aiAnalysis?.highlightSymbolId ?? null);

  // Edge label editing state
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState("");
  const [editingEdgePos, setEditingEdgePos] = useState<{ x: number; y: number } | null>(null);
  const [editingRelationIds, setEditingRelationIds] = useState<string[]>([]);

  // Build nodes/edges from current view using edge projection
  const { viewNodes, viewEdges } = useMemo(() => {
    if (!graph || !currentViewId) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const view = graph.views.find((v) => v.id === currentViewId);
    if (!view) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const scope = (view as any).scope as string | undefined;

    // Pre-compute relation badges per symbol: which relation types touch each symbol?
    const relBadgeMap = new Map<string, Set<string>>();
    for (const rel of graph.relations) {
      if (rel.type === "contains") continue;
      const srcSet = relBadgeMap.get(rel.source) ?? new Set();
      srcSet.add(rel.type);
      relBadgeMap.set(rel.source, srcSet);
      const tgtSet = relBadgeMap.get(rel.target) ?? new Set();
      tgtSet.add(rel.type);
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
      const relationBadges = Array.from(childBadges).filter((t) => t !== "imports");

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
        } satisfies UmlNodeData,
      } satisfies Node;
    }).filter(Boolean) as Node[];

    // Use edge projection instead of strict endpoint filtering
    const projected = projectEdgesForView(view, graph.symbols, graph.relations);
    const vEdges: Edge[] = projected.map((pe) => ({
      id: pe.key,
      source: pe.source,
      target: pe.target,
      label: pe.label,
      animated: pe.animated,
      className: pe.className,
      data: { relationIds: pe.relationIds },
    }));

    return { viewNodes: vNodes, viewEdges: vEdges };
  }, [graph, currentViewId]);

  // Apply ELK layout — Pass 1 (estimate) 
  useEffect(() => {
    if (viewNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    setLayoutDone(false);
    layoutRef.current = false;
    layoutPassRef.current = 0;

    layoutNodes(viewNodes, viewEdges).then((laid) => {
      setNodes(laid);
      setEdges(viewEdges);
      layoutPassRef.current = 1;
      setLayoutDone(true);
    });
  }, [viewNodes, viewEdges, setNodes, setEdges]);

  // Pass 2: re-layout with measured sizes (React Flow measures after first render)
  useEffect(() => {
    if (layoutPassRef.current !== 1 || !layoutDone) return;
    // Check if any node has been measured by React Flow
    const hasMeasured = nodes.some((n) => n.measured?.width && n.measured?.height);
    if (!hasMeasured) return;

    layoutPassRef.current = 2; // prevent infinite loop

    layoutNodes(nodes, edges).then((laid) => {
      setNodes(laid);
      // Short delay then fit
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.12, duration: 300 });
      }, 60);
    });
  }, [nodes, edges, layoutDone, setNodes, reactFlowInstance]);

  // Fit view after first layout pass
  useEffect(() => {
    if (layoutDone && !layoutRef.current) {
      layoutRef.current = true;
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
      }, 50);
    }
  }, [layoutDone, reactFlowInstance]);

  // AI highlight: scroll to highlighted node & flash animation
  useEffect(() => {
    if (aiHighlightId) {
      // Zoom to the highlighted node
      reactFlowInstance.fitView({
        nodes: [{ id: aiHighlightId }],
        duration: 400,
        padding: 0.5,
      });
      // Add a CSS flash class to the node
      setTimeout(() => {
        const el = document.querySelector(`[data-id="${aiHighlightId}"]`);
        if (el) {
          el.classList.add("ai-flash");
          setTimeout(() => el.classList.remove("ai-flash"), 1500);
        }
      }, 450);
    }
  }, [aiHighlightId, reactFlowInstance]);

  // Focus-navigate: zoom to a specific node after view switch & highlight it
  const focusNodeId = useAppStore((s) => s.focusNodeId);
  const setFocusNode = useAppStore((s) => s.setFocusNode);
  const focusAppliedRef = useRef<string | null>(null);
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
      const el = document.querySelector(`[data-id="${nodeId}"]`);
      if (el) el.classList.add("node-focus-highlight");
    }, 520);
  }, [reactFlowInstance]);

  // Main focus effect — tries immediately, retries if layout not ready
  useEffect(() => {
    if (!focusNodeId) {
      pendingFocusRef.current = null;
      return;
    }
    if (focusAppliedRef.current === focusNodeId) return;

    const exists = nodes.some((n) => n.id === focusNodeId);
    if (!exists || !layoutDone || layoutPassRef.current < 2) {
      // Layout not ready — store as pending and retry
      pendingFocusRef.current = focusNodeId;
      return;
    }

    // Layout is ready — apply focus
    focusAppliedRef.current = focusNodeId;
    pendingFocusRef.current = null;
    setTimeout(() => applyFocusZoom(focusNodeId), 300);
  }, [focusNodeId, layoutDone, nodes, reactFlowInstance, setFocusNode, applyFocusZoom]);

  // Retry pending focus after layout pass 2 completes
  useEffect(() => {
    if (!layoutDone || layoutPassRef.current < 2) return;
    const pending = pendingFocusRef.current;
    if (!pending || focusAppliedRef.current === pending) return;

    // Check node exists now that layout is done
    const exists = nodes.some((n) => n.id === pending);
    if (!exists) return;

    focusAppliedRef.current = pending;
    pendingFocusRef.current = null;
    setTimeout(() => applyFocusZoom(pending), 300);
  }, [layoutDone, nodes, applyFocusZoom]);

  // Also retry with a timer for cases where layout deps don't trigger re-render
  useEffect(() => {
    if (!focusNodeId || focusAppliedRef.current === focusNodeId) {
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
      if (focusAppliedRef.current === id) {
        if (focusRetryRef.current) clearInterval(focusRetryRef.current);
        focusRetryRef.current = null;
        return;
      }
      focusAppliedRef.current = id;
      pendingFocusRef.current = null;
      if (focusRetryRef.current) clearInterval(focusRetryRef.current);
      focusRetryRef.current = null;
      setTimeout(() => applyFocusZoom(id), 100);
    }, 200);
    return () => {
      if (focusRetryRef.current) { clearInterval(focusRetryRef.current); focusRetryRef.current = null; }
    };
  }, [focusNodeId, nodes, applyFocusZoom]);

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

  // When a connection is made between handles, create a real Relation in the graph
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !currentViewId) return;
      const relId = `rel-${Date.now()}`;
      const newRel: Relation = {
        id: relId,
        type: "calls",
        source: conn.source,
        target: conn.target,
        label: "calls",
        confidence: 1,
      };
      addRelation(newRel, currentViewId);
    },
    [addRelation, currentViewId],
  );

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
    [reactFlowInstance, setNodes, currentViewId, addSymbolToGraph],
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
        fitView
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
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

      {/* Export buttons */}
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 5, display: "flex", gap: 4 }}>
        <button
          className="export-btn"
          onClick={() => {
            if (graph) exportProjectAsHtml(graph);
          }}
          title="Komplettes UML-Projekt als HTML exportieren (alle Views + Navigation)"
        >
          📥 Export Projekt
        </button>
        <button
          className="export-btn"
          onClick={() => {
            const view = graph?.views.find((v) => v.id === currentViewId);
            exportDiagramAsHtml(nodes, edges, view?.title ?? "diagram");
          }}
          title="Nur aktuelle Ansicht als HTML exportieren"
        >
          📄 Export View
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
    </div>
  );
}
