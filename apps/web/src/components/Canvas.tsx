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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useAppStore } from "../store";
import { UmlNode } from "./UmlNode";
import { layoutNodes } from "../layout";
import type { UmlNodeData } from "./UmlNode";

const nodeTypes = { uml: UmlNode };

export function Canvas() {
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const navigateToView = useAppStore((s) => s.navigateToView);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const reactFlowInstance = useReactFlow();
  const layoutRef = useRef(false);

  // Build nodes/edges from current view
  const { viewNodes, viewEdges } = useMemo(() => {
    if (!graph || !currentViewId) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const view = graph.views.find((v) => v.id === currentViewId);
    if (!view) return { viewNodes: [] as Node[], viewEdges: [] as Edge[] };

    const vNodes: Node[] = view.nodeRefs.map((symId, i) => {
      const sym = graph.symbols.find((s) => s.id === symId);
      if (!sym) return null;

      // Check if there's saved position
      const savedPos = view.nodePositions?.find((p) => p.symbolId === symId);

      return {
        id: sym.id,
        type: "uml",
        position: savedPos ? { x: savedPos.x, y: savedPos.y } : { x: i * 250, y: i * 120 },
        data: {
          label: sym.label,
          kind: sym.kind,
          summary: sym.doc?.summary,
          symbolId: sym.id,
          childViewId: sym.childViewId,
        } satisfies UmlNodeData,
      } satisfies Node;
    }).filter(Boolean) as Node[];

    // Get edges that connect nodes in this view
    const nodeIdsInView = new Set(view.nodeRefs);
    const vEdges: Edge[] = view.edgeRefs
      .map((eId) => graph.relations.find((r) => r.id === eId))
      .filter(Boolean)
      .filter((r) => nodeIdsInView.has(r!.source) && nodeIdsInView.has(r!.target))
      .map((r) => ({
        id: r!.id,
        source: r!.source,
        target: r!.target,
        label: r!.label ?? r!.type,
        animated: r!.type === "calls",
        className: `edge-${r!.type}${(r!.confidence ?? 1) < 0.9 ? " edge-low-confidence" : ""}`,
      }));

    // Also add cross-group edges visible at this level
    const crossEdges: Edge[] = graph.relations
      .filter((r) => {
        if (view.edgeRefs.includes(r.id)) return false;
        if (r.type === "contains") return false;
        // Check if source and target are both in this view's groups' children
        const srcSym = graph.symbols.find((s) => s.id === r.source);
        const tgtSym = graph.symbols.find((s) => s.id === r.target);
        if (!srcSym || !tgtSym) return false;
        // If source/target parent is in nodeRefs → show at group level
        return nodeIdsInView.has(srcSym.parentId ?? "") && nodeIdsInView.has(tgtSym.parentId ?? "") && srcSym.parentId !== tgtSym.parentId;
      })
      .map((r) => {
        const srcSym = graph.symbols.find((s) => s.id === r.source);
        const tgtSym = graph.symbols.find((s) => s.id === r.target);
        return {
          id: `cross-${r.id}`,
          source: srcSym!.parentId!,
          target: tgtSym!.parentId!,
          label: r.type,
          animated: r.type === "calls",
          className: `edge-${r.type}`,
        };
      });

    // Deduplicate cross edges
    const edgeMap = new Map<string, Edge>();
    for (const e of [...vEdges, ...crossEdges]) {
      const key = `${e.source}-${e.target}`;
      if (!edgeMap.has(key)) edgeMap.set(key, e);
    }

    return { viewNodes: vNodes, viewEdges: Array.from(edgeMap.values()) };
  }, [graph, currentViewId]);

  // Apply ELK layout
  useEffect(() => {
    if (viewNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    setLayoutDone(false);
    layoutRef.current = false;

    layoutNodes(viewNodes, viewEdges).then((laid) => {
      setNodes(laid);
      setEdges(viewEdges);
      setLayoutDone(true);
    });
  }, [viewNodes, viewEdges, setNodes, setEdges]);

  // Fit view after layout
  useEffect(() => {
    if (layoutDone && !layoutRef.current) {
      layoutRef.current = true;
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
      }, 50);
    }
  }, [layoutDone, reactFlowInstance]);

  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({ ...conn, animated: true }, eds)),
    [setEdges],
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
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/uml-kind");
      if (!kind) return;

      const position = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });

      const newNode: Node = {
        id: `new-${Date.now()}`,
        type: "uml",
        position,
        data: {
          label: `New ${kind}`,
          kind,
          symbolId: `new-${Date.now()}`,
          summary: "",
        } satisfies UmlNodeData,
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes],
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
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        fitView
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
            return "rgba(35,38,58,0.8)";
          }}
          maskColor="rgba(15,17,23,0.7)"
        />
      </ReactFlow>
    </div>
  );
}
