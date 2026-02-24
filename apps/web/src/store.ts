import { create } from "zustand";
import type { ProjectGraph, DiagramView, Symbol as Sym, Relation } from "@dmpg/shared";
import type { AnalyzeEvent } from "./api";

export interface AiAnalysisState {
  running: boolean;
  phase: string;
  log: AnalyzeEvent[];
  highlightSymbolId: string | null;
  current?: number;
  total?: number;
  thought: string | null;
  aiCurrentSymbolId: string | null;
}

export interface AppState {
  graph: ProjectGraph | null;
  currentViewId: string | null;
  selectedSymbolId: string | null;
  selectedEdgeId: string | null;
  breadcrumb: string[]; // view IDs path

  // AI analysis
  aiAnalysis: AiAnalysisState | null;
  startAiAnalysis: () => void;
  addAiEvent: (event: AnalyzeEvent) => void;
  stopAiAnalysis: () => void;

  // Inspector
  inspectorCollapsed: boolean;
  toggleInspector: () => void;

  // Hover card
  hoverSymbolId: string | null;
  hoverPosition: { x: number; y: number } | null;
  setHoverSymbol: (id: string | null, pos?: { x: number; y: number } | null) => void;

  // Focus-navigate: zoom to a specific node after view change
  focusNodeId: string | null;
  setFocusNode: (id: string | null) => void;

  // actions
  setGraph: (g: ProjectGraph) => void;
  /** Update graph data while keeping current view / breadcrumb intact */
  updateGraph: (g: ProjectGraph) => void;
  navigateToView: (viewId: string) => void;
  goBack: () => void;
  selectSymbol: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  getCurrentView: () => DiagramView | null;
  getSymbol: (id: string) => Sym | undefined;
  getView: (id: string) => DiagramView | undefined;

  // graph mutation actions
  addSymbolToGraph: (sym: Sym, viewId: string) => void;
  updateSymbol: (id: string, patch: Partial<Sym>) => void;
  removeSymbol: (id: string) => void;
  addRelation: (rel: Relation, viewId: string) => void;
  updateRelation: (id: string, patch: Partial<Relation>) => void;
  /** Batch update multiple relations with same patch (single sync) */
  updateRelations: (ids: string[], patch: Partial<Relation>) => void;
  removeRelation: (id: string) => void;
  /** Save node positions for the current view (debounced sync) */
  saveNodePositions: (positions: Array<{ symbolId: string; x: number; y: number; width?: number; height?: number }>) => void;
  syncGraphToServer: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  graph: null,
  currentViewId: null,
  selectedSymbolId: null,
  selectedEdgeId: null,
  breadcrumb: [],

  aiAnalysis: null,

  inspectorCollapsed: false,
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),

  hoverSymbolId: null,
  hoverPosition: null,
  setHoverSymbol: (id, pos) => set({ hoverSymbolId: id, hoverPosition: pos ?? null }),

  focusNodeId: null,
  setFocusNode: (id) =>
    set(id
      ? { focusNodeId: id, selectedSymbolId: id, selectedEdgeId: null, inspectorCollapsed: false }
      : { focusNodeId: null }),

  startAiAnalysis: () =>
    set({
      aiAnalysis: { running: true, phase: "starting", log: [], highlightSymbolId: null, thought: null, aiCurrentSymbolId: null },
    }),

  addAiEvent: (event) => {
    const { aiAnalysis, graph } = get();
    if (!aiAnalysis) return;

    const newPhase = event.phase ?? aiAnalysis.phase;
    const newLog = [...aiAnalysis.log, event];
    const highlightSymbolId = event.symbolId ?? aiAnalysis.highlightSymbolId;
    const thought = event.thought ?? (event.symbolLabel && event.phase ? `${event.phase}: ${event.symbolLabel}` : null) ?? aiAnalysis.thought;
    const aiCurrentSymbolId = event.symbolId ?? aiAnalysis.aiCurrentSymbolId;

    // If phase is "done", "error", or "cancelled", mark as not running and reload graph
    if (event.phase === "done" || event.phase === "error" || event.phase === "cancelled") {
      set({
        aiAnalysis: {
          running: false,
          phase: event.phase,
          log: newLog,
          highlightSymbolId: null,
          current: undefined,
          total: undefined,
          thought: null,
          aiCurrentSymbolId: null,
        },
      });
      // Reload graph from server to get all AI updates — preserve current view
      fetch("/api/graph")
        .then((r) => r.json())
        .then((g) => {
          get().updateGraph(g);
        })
        .catch(console.error);
      return;
    }

    // On phase start, reset current/total to the new values (avoid stale progress from previous phase)
    const isPhaseStart = event.action === "start";
    set({
      aiAnalysis: {
        running: true,
        phase: newPhase,
        log: newLog,
        highlightSymbolId,
        current: isPhaseStart ? (event.current ?? 0) : (event.current ?? aiAnalysis.current),
        total: isPhaseStart ? (event.total ?? undefined) : (event.total ?? aiAnalysis.total),
        thought,
        aiCurrentSymbolId,
      },
    });
  },

  stopAiAnalysis: () => {
    const { aiAnalysis } = get();
    if (!aiAnalysis) return;
    set({
      aiAnalysis: { ...aiAnalysis, running: false, phase: "stopped" },
    });
  },

  setGraph: (g) =>
    set({
      graph: g,
      currentViewId: g.rootViewId,
      selectedSymbolId: null,
      selectedEdgeId: null,
      breadcrumb: [g.rootViewId],
    }),

  updateGraph: (g) => {
    const { currentViewId, breadcrumb, selectedSymbolId, selectedEdgeId } = get();
    // Keep current view if it still exists, otherwise fall back to root
    const viewStillExists = g.views.some((v) => v.id === currentViewId);
    set({
      graph: g,
      currentViewId: viewStillExists ? currentViewId : g.rootViewId,
      breadcrumb: viewStillExists ? breadcrumb : [g.rootViewId],
      selectedSymbolId: g.symbols.some((s) => s.id === selectedSymbolId) ? selectedSymbolId : null,
      selectedEdgeId: g.relations.some((r) => r.id === selectedEdgeId) ? selectedEdgeId : null,
    });
  },

  navigateToView: (viewId) => {
    const { breadcrumb } = get();
    const idx = breadcrumb.indexOf(viewId);
    if (idx >= 0) {
      set({ currentViewId: viewId, breadcrumb: breadcrumb.slice(0, idx + 1), selectedSymbolId: null, selectedEdgeId: null });
    } else {
      set({ currentViewId: viewId, breadcrumb: [...breadcrumb, viewId], selectedSymbolId: null, selectedEdgeId: null });
    }
  },

  goBack: () => {
    const { breadcrumb } = get();
    if (breadcrumb.length > 1) {
      const newBc = breadcrumb.slice(0, -1);
      set({ currentViewId: newBc[newBc.length - 1], breadcrumb: newBc, selectedSymbolId: null, selectedEdgeId: null });
    }
  },

  selectSymbol: (id) => set({ selectedSymbolId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedSymbolId: null }),

  getCurrentView: () => {
    const { graph, currentViewId } = get();
    if (!graph || !currentViewId) return null;
    return graph.views.find((v) => v.id === currentViewId) ?? null;
  },

  getSymbol: (id) => {
    const { graph } = get();
    return graph?.symbols.find((s) => s.id === id);
  },

  getView: (id) => {
    const { graph } = get();
    return graph?.views.find((v) => v.id === id);
  },

  addSymbolToGraph: (sym, viewId) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      symbols: [...graph.symbols, sym],
      views: graph.views.map((v) =>
        v.id === viewId ? { ...v, nodeRefs: [...v.nodeRefs, sym.id] } : v,
      ),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  updateSymbol: (id, patch) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      symbols: graph.symbols.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  removeSymbol: (id) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      symbols: graph.symbols.filter((s) => s.id !== id),
      relations: graph.relations.filter((r) => r.source !== id && r.target !== id),
      views: graph.views.map((v) => ({
        ...v,
        nodeRefs: v.nodeRefs.filter((n) => n !== id),
        edgeRefs: v.edgeRefs.filter((eId) => {
          const rel = graph.relations.find((r) => r.id === eId);
          return rel ? rel.source !== id && rel.target !== id : true;
        }),
      })),
    };
    set({ graph: updated, selectedSymbolId: null });
    get().syncGraphToServer();
  },

  addRelation: (rel, viewId) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      relations: [...graph.relations, rel],
      views: graph.views.map((v) =>
        v.id === viewId ? { ...v, edgeRefs: [...v.edgeRefs, rel.id] } : v,
      ),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  updateRelation: (id, patch) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      relations: graph.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  updateRelations: (ids, patch) => {
    const { graph } = get();
    if (!graph) return;
    const idSet = new Set(ids);
    const updated = {
      ...graph,
      relations: graph.relations.map((r) => (idSet.has(r.id) ? { ...r, ...patch } : r)),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  removeRelation: (id) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      relations: graph.relations.filter((r) => r.id !== id),
      views: graph.views.map((v) => ({
        ...v,
        edgeRefs: v.edgeRefs.filter((eId) => eId !== id),
      })),
    };
    set({ graph: updated, selectedEdgeId: null });
    get().syncGraphToServer();
  },

  saveNodePositions: (positions) => {
    const { graph, currentViewId } = get();
    if (!graph || !currentViewId) return;
    const updated = {
      ...graph,
      views: graph.views.map((v) => {
        if (v.id !== currentViewId) return v;
        // Merge new positions with any existing ones
        const existing = new Map((v.nodePositions ?? []).map((p) => [p.symbolId, p]));
        for (const p of positions) {
          existing.set(p.symbolId, p);
        }
        return { ...v, nodePositions: Array.from(existing.values()) };
      }),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  syncGraphToServer: async () => {
    const { graph } = get();
    if (!graph) return;
    try {
      await fetch("/api/graph", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(graph),
      });
    } catch (err) {
      console.error("Failed to sync graph to server:", err);
    }
  },
}));
