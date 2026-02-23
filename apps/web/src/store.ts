import { create } from "zustand";
import type { ProjectGraph, DiagramView, Symbol as Sym } from "@dmpg/shared";

export interface AppState {
  graph: ProjectGraph | null;
  currentViewId: string | null;
  selectedSymbolId: string | null;
  breadcrumb: string[]; // view IDs path

  // actions
  setGraph: (g: ProjectGraph) => void;
  navigateToView: (viewId: string) => void;
  goBack: () => void;
  selectSymbol: (id: string | null) => void;
  getCurrentView: () => DiagramView | null;
  getSymbol: (id: string) => Sym | undefined;
  getView: (id: string) => DiagramView | undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  graph: null,
  currentViewId: null,
  selectedSymbolId: null,
  breadcrumb: [],

  setGraph: (g) =>
    set({
      graph: g,
      currentViewId: g.rootViewId,
      selectedSymbolId: null,
      breadcrumb: [g.rootViewId],
    }),

  navigateToView: (viewId) => {
    const { breadcrumb } = get();
    // if already in breadcrumb, pop back to it
    const idx = breadcrumb.indexOf(viewId);
    if (idx >= 0) {
      set({ currentViewId: viewId, breadcrumb: breadcrumb.slice(0, idx + 1), selectedSymbolId: null });
    } else {
      set({ currentViewId: viewId, breadcrumb: [...breadcrumb, viewId], selectedSymbolId: null });
    }
  },

  goBack: () => {
    const { breadcrumb } = get();
    if (breadcrumb.length > 1) {
      const newBc = breadcrumb.slice(0, -1);
      set({ currentViewId: newBc[newBc.length - 1], breadcrumb: newBc, selectedSymbolId: null });
    }
  },

  selectSymbol: (id) => set({ selectedSymbolId: id }),

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
}));
