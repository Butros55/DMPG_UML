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

const PANEL_WIDTH_STORAGE_KEYS = {
  sidebar: "dmpg.layout.sidebar-width.v1",
  inspector: "dmpg.layout.inspector-width.v1",
  validate: "dmpg.layout.validate-width.v1",
} as const;

function clampPanelWidth(width: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, width));
}

/** Reusable drag-resize hook for panel widths */
function useResizeHandle(
  side: "left" | "right",
  initial: number,
  min: number,
  max: number,
  storageKey: string,
) {
  const [width, setWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
      return Number.isFinite(parsed) ? clampPanelWidth(parsed, min, max) : initial;
    } catch {
      return initial;
    }
  });
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    setWidth((prev) => clampPanelWidth(prev, min, max));
  }, [min, max]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      // ignore persistence failures
    }
  }, [storageKey, width]);

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
      setWidth(clampPanelWidth(newW, min, max));
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
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const breadcrumb = useAppStore((s) => s.breadcrumb);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const inspectorCollapsed = useAppStore((s) => s.inspectorCollapsed);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const sourceViewerSymbol = useAppStore((s) => s.sourceViewerSymbol);
  const closeSourceViewer = useAppStore((s) => s.closeSourceViewer);
  const validateActive = useAppStore((s) => s.validateState.active);
  const toggleDebugTransport = useAppStore((s) => s.toggleDebugTransport);
  const undoGraphChange = useAppStore((s) => s.undoGraphChange);
  const redoGraphChange = useAppStore((s) => s.redoGraphChange);
  const saveCurrentViewSnapshot = useAppStore((s) => s.saveCurrentViewSnapshot);

  const skipHistoryPush = useRef(false);
  const prevViewId = useRef<string | null>(null);

  // Resizable panels
  const sidebar = useResizeHandle("left", 240, 160, 500, PANEL_WIDTH_STORAGE_KEYS.sidebar);
  const inspector = useResizeHandle("right", 340, 200, 600, PANEL_WIDTH_STORAGE_KEYS.inspector);
  const validatePanel = useResizeHandle("left", 380, 280, 560, PANEL_WIDTH_STORAGE_KEYS.validate);
  const sidebarActivityWidth = 50;
  const sidebarColumnWidth = sidebarCollapsed ? sidebarActivityWidth : sidebar.width;

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
        navigateToView(viewId, { restoreViewState: true });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigateToView]);

  useEffect(() => {
    if (!currentViewId) return;
    saveCurrentViewSnapshot();
  }, [
    breadcrumb,
    currentViewId,
    inspectorCollapsed,
    saveCurrentViewSnapshot,
    selectedEdgeId,
    selectedSymbolId,
  ]);

  // Global graph undo/redo shortcuts (capture phase to prevent browser handlers)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isTypingTarget =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        !!target?.isContentEditable;
      if (isTypingTarget) return;

      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;
      const key = event.key.toLowerCase();
      const isRedo = (event.shiftKey && key === "z") || key === "y";
      const isUndo = key === "z" && !event.shiftKey;

      if (!isUndo && !isRedo) return;
      event.preventDefault();
      event.stopPropagation();
      if (isRedo) {
        redoGraphChange();
      } else {
        undoGraphChange();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [undoGraphChange, redoGraphChange]);

  // Build grid columns — optionally include validate panel between sidebar & canvas
  const gridCols = (() => {
    const sidebarCol = `${sidebarColumnWidth}px`;
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
            {graph.symbols.length} Symbole · {graph.relations.length} Relationen · {graph.views.length} Ansichten
          </span>
        )}
        <button
          className="debug-transport-toggle"
          title="Debug ein-/ausblenden"
          onClick={toggleDebugTransport}
        >
          <i className="bi bi-bug" />
        </button>
      </header>

      <Sidebar />
      {!sidebarCollapsed && (
        <div
          className="resize-handle resize-handle--sidebar"
          style={{ left: sidebarColumnWidth - 3 }}
          onMouseDown={sidebar.onMouseDown}
        />
      )}

      {/* Validate Panel — docked between sidebar & canvas */}
      {validateActive && (
        <>
          <ValidatePanel />
          <div
            className="resize-handle resize-handle--validate"
            style={{ left: sidebarColumnWidth + validatePanel.width - 3 }}
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

      {/* Unified command palette (Ctrl+P / Ctrl+Shift+P) */}
      <CommandPalette />

      {/* Debug Transport overlay */}
      <DebugTransportPanel />
    </div>
  );
}

