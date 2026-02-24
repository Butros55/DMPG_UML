import { useEffect, useRef, useCallback, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { Inspector } from "./components/Inspector";
import { Breadcrumb } from "./components/Breadcrumb";
import { useAppStore } from "./store";
import { fetchGraph } from "./api";

/** Reusable drag-resize hook for panel widths */
function useResizeHandle(
  side: "left" | "right",
  initial: number,
  min: number,
  max: number,
) {
  const [width, setWidth] = useState(initial);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      const newW = side === "left"
        ? startW.current + delta
        : startW.current - delta;
      setWidth(Math.max(min, Math.min(max, newW)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width, side, min, max]);

  return { width, onMouseDown };
}

export function App() {
  const setGraph = useAppStore((s) => s.setGraph);
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const inspectorCollapsed = useAppStore((s) => s.inspectorCollapsed);

  const skipHistoryPush = useRef(false);
  const prevViewId = useRef<string | null>(null);

  // Resizable panels
  const sidebar = useResizeHandle("left", 240, 160, 500);
  const inspector = useResizeHandle("right", 340, 200, 600);

  useEffect(() => {
    fetchGraph()
      .then((g) => setGraph(g))
      .catch((err) => console.error("Failed to load graph:", err));
  }, [setGraph]);

  // Sync view changes to browser history
  useEffect(() => {
    if (currentViewId && currentViewId !== prevViewId.current) {
      prevViewId.current = currentViewId;
      if (!skipHistoryPush.current) {
        window.history.pushState({ viewId: currentViewId }, "", `#view=${currentViewId}`);
      }
      skipHistoryPush.current = false;
    }
  }, [currentViewId]);

  // Listen for browser back/forward
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const viewId = e.state?.viewId;
      if (viewId) {
        skipHistoryPush.current = true;
        prevViewId.current = viewId;
        navigateToView(viewId);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigateToView]);

  const gridCols = inspectorCollapsed
    ? `${sidebar.width}px 1fr 36px`
    : `${sidebar.width}px 1fr ${inspector.width}px`;

  return (
    <div
      className={`app-layout${inspectorCollapsed ? " inspector-collapsed" : ""}`}
      style={{ gridTemplateColumns: gridCols }}
    >
      <header className="app-header">
        <h1>DMPG UML Editor</h1>
        <Breadcrumb />
        <div style={{ flex: 1 }} />
        {graph && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {graph.symbols.length} symbols · {graph.relations.length} relations · {graph.views.length} views
          </span>
        )}
      </header>

      <Sidebar />
      <div
        className="resize-handle resize-handle--sidebar"
        style={{ left: sidebar.width - 3 }}
        onMouseDown={sidebar.onMouseDown}
      />

      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>

      {!inspectorCollapsed && (
        <div
          className="resize-handle resize-handle--inspector"
          style={{ right: inspector.width - 3 }}
          onMouseDown={inspector.onMouseDown}
        />
      )}
      <Inspector />
    </div>
  );
}
