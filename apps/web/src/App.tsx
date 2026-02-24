import { useEffect, useRef, useCallback, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { Inspector } from "./components/Inspector";
import { Breadcrumb } from "./components/Breadcrumb";
import { SourceViewer } from "./components/SourceViewer";
import { CommandPalette } from "./components/CommandPalette";
import { ValidatePanel } from "./components/ValidatePanel";
import { DebugTransportPanel } from "./components/DebugTransportPanel";
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
  const sourceViewerSymbol = useAppStore((s) => s.sourceViewerSymbol);
  const closeSourceViewer = useAppStore((s) => s.closeSourceViewer);
  const validateActive = useAppStore((s) => s.validateState.active);
  const toggleDebugTransport = useAppStore((s) => s.toggleDebugTransport);

  const skipHistoryPush = useRef(false);
  const prevViewId = useRef<string | null>(null);

  // Resizable panels
  const sidebar = useResizeHandle("left", 240, 160, 500);
  const inspector = useResizeHandle("right", 340, 200, 600);
  const validatePanel = useResizeHandle("left", 380, 280, 560);

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

  // Build grid columns — optionally include validate panel between sidebar & canvas
  const gridCols = (() => {
    const sidebarCol = `${sidebar.width}px`;
    const validateCol = validateActive ? `${validatePanel.width}px` : "";
    const inspectorCol = inspectorCollapsed ? "36px" : `${inspector.width}px`;
    return validateActive
      ? `${sidebarCol} ${validateCol} 1fr ${inspectorCol}`
      : `${sidebarCol} 1fr ${inspectorCol}`;
  })();

  const gridAreas = validateActive
    ? `"header header header header" "sidebar validate canvas inspector"`
    : `"header header header" "sidebar canvas inspector"`;

  return (
    <div
      className={`app-layout${inspectorCollapsed ? " inspector-collapsed" : ""}${validateActive ? " validate-open" : ""}`}
      style={{ gridTemplateColumns: gridCols, gridTemplateAreas: gridAreas }}
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
        <button
          className="debug-transport-toggle"
          title="Toggle Transport Debug"
          onClick={toggleDebugTransport}
        >
          <i className="bi bi-bug" />
        </button>
      </header>

      <Sidebar />
      <div
        className="resize-handle resize-handle--sidebar"
        style={{ left: sidebar.width - 3 }}
        onMouseDown={sidebar.onMouseDown}
      />

      {/* Validate Panel — docked between sidebar & canvas */}
      {validateActive && (
        <>
          <ValidatePanel />
          <div
            className="resize-handle resize-handle--validate"
            style={{ left: sidebar.width + validatePanel.width - 3 }}
            onMouseDown={validatePanel.onMouseDown}
          />
        </>
      )}

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

      {/* Source Code Viewer popup — rendered outside the grid */}
      {sourceViewerSymbol && (
        <SourceViewer
          symbolId={sourceViewerSymbol.id}
          symbolLabel={sourceViewerSymbol.label}
          onClose={closeSourceViewer}
        />
      )}

      {/* Command Palette (Ctrl+P) */}
      <CommandPalette />

      {/* Debug Transport overlay */}
      <DebugTransportPanel />
    </div>
  );
}
