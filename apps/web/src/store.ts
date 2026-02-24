import { create } from "zustand";
import type { ProjectGraph, DiagramView, Symbol as Sym, Relation } from "@dmpg/shared";
import type { AnalyzeEvent } from "./api";

export interface AiAnalysisState {
  running: boolean;
  phase: string;
  log: AnalyzeEvent[];
  highlightSymbolId: string | null;
  highlightSeq: number;
  animationSymbolId: string | null;
  animationSeq: number;
  analysisSeq: number;
  navigationRequestedSeq: number;
  navigationSettledSeq: number;
  navigationTargetSymbolId: string | null;
  pendingAnimationSymbolId: string | null;
  aiFocusViewId: string | null;
  current?: number;
  total?: number;
  thought: string | null;
  aiCurrentSymbolId: string | null;
  /** The symbol the LLM is currently analyzing (shown as "working on..." indicator) */
  aiWorkingSymbolId: string | null;
  /** User can pause auto-navigation without stopping the analysis */
  navPaused: boolean;
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
  acknowledgeAiNavigationSettled: (symbolId: string) => void;
  stopAiAnalysis: () => void;
  toggleAiNavPaused: () => void;

  // Inspector
  inspectorCollapsed: boolean;
  toggleInspector: () => void;

  // Hover card
  hoverSymbolId: string | null;
  hoverPosition: { x: number; y: number } | null;
  setHoverSymbol: (id: string | null, pos?: { x: number; y: number } | null) => void;

  // Focus-navigate: zoom to a specific node after view change
  focusNodeId: string | null;
  focusSeq: number;
  setFocusNode: (id: string | null) => void;

  // Source viewer popup
  sourceViewerSymbol: { id: string; label: string } | null;
  openSourceViewer: (symbolId: string, label: string) => void;
  closeSourceViewer: () => void;

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
  /** Confirm an AI-generated field (remove aiGenerated marker) */
  confirmAiField: (symbolId: string, field: string) => void;
  /** Reject an AI-generated field (remove the data + marker) */
  rejectAiField: (symbolId: string, field: string) => void;
  /** Confirm an AI-generated relation */
  confirmAiRelation: (relationId: string) => void;
  syncGraphToServer: () => Promise<void>;
}

/* ── AI animation timing: track last data update for navigation ── */
let _lastDataUpdateTime = 0;
let _lastSseDataEventTime = 0;

function findBestViewForSymbol(graph: ProjectGraph, symbolId: string, preferredViewId?: string | null): string | null {
  if (preferredViewId && graph.views.some((v) => v.id === preferredViewId && v.nodeRefs.includes(symbolId))) {
    return preferredViewId;
  }
  let bestView: string | null = null;
  for (const view of graph.views) {
    if (!view.nodeRefs.includes(symbolId)) continue;
    if (!bestView) {
      bestView = view.id;
      continue;
    }
    if (view.parentViewId && view.parentViewId !== graph.rootViewId) {
      bestView = view.id;
    }
  }
  return bestView;
}

function navigateBreadcrumb(current: string[], viewId: string): string[] {
  const idx = current.indexOf(viewId);
  if (idx >= 0) return current.slice(0, idx + 1);
  return [...current, viewId];
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
  focusSeq: 0,
  setFocusNode: (id) =>
    set(id
      ? { focusNodeId: id, focusSeq: (get().focusSeq ?? 0) + 1, selectedSymbolId: id, selectedEdgeId: null, inspectorCollapsed: false }
      : { focusNodeId: null }),

  sourceViewerSymbol: null,
  openSourceViewer: (symbolId, label) => set({ sourceViewerSymbol: { id: symbolId, label } }),
  closeSourceViewer: () => set({ sourceViewerSymbol: null }),

  startAiAnalysis: () =>
    set({
      aiAnalysis: {
        running: true,
        phase: "starting",
        log: [],
        highlightSymbolId: null,
        highlightSeq: 0,
        animationSymbolId: null,
        animationSeq: 0,
        analysisSeq: 0,
        navigationRequestedSeq: 0,
        navigationSettledSeq: 0,
        navigationTargetSymbolId: null,
        pendingAnimationSymbolId: null,
        aiFocusViewId: null,
        thought: null,
        aiCurrentSymbolId: null,
        aiWorkingSymbolId: null,
        navPaused: false,
      },
    }),

  addAiEvent: (event) => {
    const { aiAnalysis, graph, currentViewId, breadcrumb } = get();
    if (!aiAnalysis) return;

    // For poll-progress events, only update progress — skip log bloat
    const isPoll = event._source === "poll" || event.action === "poll-progress";

    const newPhase = event.phase ?? aiAnalysis.phase;
    const newLog = isPoll ? aiAnalysis.log : [...aiAnalysis.log, event];

    const isFocusEvent = event.action === "focus";
    const isDataEvent = event.action === "generated"
      || (event.phase === "labels" && !event.action && event.new_)
      || (event.phase === "dead-code" && !event.action && event.reason)
      || (event.phase === "relations" && event.action === "added");

    const thought = event.thought ?? (event.symbolLabel && event.phase ? `${event.phase}: ${event.symbolLabel}` : null) ?? aiAnalysis.thought;

    // Track SSE data event freshness (used for poll-fallback navigation)
    if (isDataEvent && !isPoll) _lastSseDataEventTime = Date.now();

    console.debug(`[AI-Store] src=${event._source ?? 'sse'} action=${event.action ?? '-'} symbol=${event.symbolId ?? '-'} current=${event.current ?? '-'}/${event.total ?? '-'} dataEvent=${isDataEvent}`);

    // If phase is terminal, mark as not running and reload graph once.
    if (event.phase === "done" || event.phase === "error" || event.phase === "cancelled" || event.phase === "paused") {
      _lastDataUpdateTime = 0;
      _lastSseDataEventTime = 0;
      set({
        aiAnalysis: {
          running: false,
          phase: event.phase,
          log: newLog,
          highlightSymbolId: null,
          highlightSeq: 0,
          animationSymbolId: null,
          animationSeq: 0,
          analysisSeq: 0,
          navigationRequestedSeq: 0,
          navigationSettledSeq: 0,
          navigationTargetSymbolId: null,
          pendingAnimationSymbolId: null,
          aiFocusViewId: null,
          current: undefined,
          total: undefined,
          thought: null,
          aiCurrentSymbolId: null,
          aiWorkingSymbolId: null,
          navPaused: false,
        },
      });

      fetch("/api/graph")
        .then((r) => r.json())
        .then((g) => {
          get().updateGraph(g);
        })
        .catch(console.error);
      return;
    }

    // Live graph updates from SSE events
    let contentChangedSymbolId: string | null = null;
    if (graph && !isPoll) {
      let graphChanged = false;
      const symbols = [...graph.symbols];
      const views = [...graph.views];
      const relations = [...graph.relations];

      if (event.phase === "labels" && event.symbolId && event.new_) {
        const symbolIndex = symbols.findIndex((s) => s.id === event.symbolId);
        const sym = symbolIndex >= 0 ? symbols[symbolIndex] : undefined;
        if (sym && sym.label !== event.new_) {
          symbols[symbolIndex] = {
            ...sym,
            label: event.new_,
            doc: { ...sym.doc, aiGenerated: { ...(sym.doc?.aiGenerated ?? {}), label: true } },
          };
          if (sym.childViewId) {
            const childIndex = views.findIndex((v) => v.id === sym.childViewId);
            if (childIndex >= 0) {
              views[childIndex] = { ...views[childIndex], title: event.new_ };
            }
          }
          graphChanged = true;
          contentChangedSymbolId = event.symbolId;
        }
      }

      if (event.phase === "docs" && event.action === "generated" && event.symbolId && event.summary) {
        const symbolIndex = symbols.findIndex((s) => s.id === event.symbolId);
        const sym = symbolIndex >= 0 ? symbols[symbolIndex] : undefined;
        if (sym) {
          const aiFields: Record<string, boolean> = { ...(sym.doc?.aiGenerated ?? {}), summary: true };
          if (event.inputs?.length) aiFields.inputs = true;
          if (event.outputs?.length) aiFields.outputs = true;
          const nextDoc = {
            ...sym.doc,
            summary: event.summary,
            inputs: event.inputs?.length ? event.inputs : sym.doc?.inputs,
            outputs: event.outputs?.length ? event.outputs : sym.doc?.outputs,
            aiGenerated: aiFields,
          };
          const changed =
            nextDoc.summary !== sym.doc?.summary ||
            JSON.stringify(nextDoc.inputs ?? []) !== JSON.stringify(sym.doc?.inputs ?? []) ||
            JSON.stringify(nextDoc.outputs ?? []) !== JSON.stringify(sym.doc?.outputs ?? []);

          if (changed) {
            symbols[symbolIndex] = { ...sym, doc: nextDoc };
            graphChanged = true;
            contentChangedSymbolId = event.symbolId;
          }
        }
      }

      if (event.phase === "relations" && event.action === "added" && event.relationId && event.source && event.target) {
        const exists = relations.some((r) => r.id === event.relationId);
        if (!exists) {
          const newRel: Relation = {
            id: event.relationId,
            type: (event.relationType ?? "calls") as Relation["type"],
            source: event.source,
            target: event.target,
            label: event.relationLabel ?? event.relationType ?? "calls",
            confidence: event.confidence ?? 0.7,
            aiGenerated: true,
          };
          relations.push(newRel);
          for (let idx = 0; idx < views.length; idx++) {
            const view = views[idx];
            if (view.nodeRefs.includes(newRel.source) && view.nodeRefs.includes(newRel.target)) {
              if (!view.edgeRefs.includes(newRel.id)) {
                views[idx] = { ...view, edgeRefs: [...view.edgeRefs, newRel.id] };
              }
            }
          }
          graphChanged = true;
        }
      }

      if (event.phase === "dead-code" && event.symbolId && event.reason) {
        const symbolIndex = symbols.findIndex((s) => s.id === event.symbolId);
        const sym = symbolIndex >= 0 ? symbols[symbolIndex] : undefined;
        if (sym) {
          const alreadyTagged = sym.tags?.includes("dead-code") ?? false;
          const nextReason = event.reason.trim();
          const reasonChanged = (sym.doc?.deadCodeReason ?? "") !== nextReason;
          const aiMarkerMissing = !sym.doc?.aiGenerated?.deadCode;

          if (!alreadyTagged || reasonChanged || aiMarkerMissing) {
            symbols[symbolIndex] = {
              ...sym,
              tags: [...(sym.tags ?? []).filter((t) => t !== "dead-code"), "dead-code"],
              doc: {
                ...sym.doc,
                aiGenerated: { ...(sym.doc?.aiGenerated ?? {}), deadCode: true },
                deadCodeReason: nextReason,
              },
            };
            graphChanged = true;
            contentChangedSymbolId = event.symbolId;
          }
        }
      }

      if (graphChanged) {
        _lastDataUpdateTime = Date.now();
        set({ graph: { ...graph, symbols, views, relations } });
      }
    }

    const isPhaseStart = event.action === "start";
    const newCurrent = isPhaseStart
      ? (event.current ?? 0)
      : (event.current ?? aiAnalysis.current);
    const newTotal = isPhaseStart
      ? (event.total ?? undefined)
      : (event.total ?? aiAnalysis.total);

    const nextAnalysisSeq = isDataEvent && event.symbolId && !isPoll
      ? (aiAnalysis.analysisSeq ?? 0) + 1
      : (aiAnalysis.analysisSeq ?? 0);

    const nextAiState: AiAnalysisState = {
      ...aiAnalysis,
      running: true,
      phase: newPhase,
      log: newLog,
      current: newCurrent,
      total: newTotal,
      thought,
      aiFocusViewId: event.viewId ?? aiAnalysis.aiFocusViewId,
      aiCurrentSymbolId: event.symbolId ?? aiAnalysis.aiCurrentSymbolId,
      aiWorkingSymbolId: isDataEvent ? null : (event.symbolId ?? aiAnalysis.aiWorkingSymbolId),
      navPaused: aiAnalysis.navPaused,
      analysisSeq: nextAnalysisSeq,
      navigationRequestedSeq: aiAnalysis.navigationRequestedSeq,
      navigationSettledSeq: aiAnalysis.navigationSettledSeq,
      navigationTargetSymbolId: aiAnalysis.navigationTargetSymbolId,
      pendingAnimationSymbolId: aiAnalysis.pendingAnimationSymbolId,
      animationSymbolId: aiAnalysis.animationSymbolId,
      animationSeq: aiAnalysis.animationSeq,
      highlightSymbolId: aiAnalysis.highlightSymbolId,
      highlightSeq: aiAnalysis.highlightSeq,
    };

    const setPatch: Partial<AppState> = { aiAnalysis: nextAiState };

    // Navigation: primary from SSE data events, fallback from poll when SSE stale
    const wantNav = !aiAnalysis.navPaused && !!event.symbolId && !!graph;
    const sseIsStale = Date.now() - _lastSseDataEventTime > 3000;
    const shouldNav = wantNav && ((isDataEvent && !isPoll) || (isPoll && sseIsStale));

    if (shouldNav && event.symbolId) {
      const targetViewId = findBestViewForSymbol(graph!, event.symbolId, event.viewId ?? aiAnalysis.aiFocusViewId);
      if (targetViewId) {
        setPatch.currentViewId = targetViewId;
        setPatch.breadcrumb = navigateBreadcrumb(breadcrumb, targetViewId);
      }
      setPatch.focusNodeId = event.symbolId;
      setPatch.focusSeq = (get().focusSeq ?? 0) + 1;
      setPatch.selectedSymbolId = event.symbolId;
      setPatch.selectedEdgeId = null;
      setPatch.inspectorCollapsed = false;

      const nextNavReqSeq = (nextAiState.navigationRequestedSeq ?? 0) + 1;
      nextAiState.navigationRequestedSeq = nextNavReqSeq;
      nextAiState.navigationTargetSymbolId = event.symbolId;
      // Only queue animation for SSE data events that actually changed content
      nextAiState.pendingAnimationSymbolId = (!isPoll && contentChangedSymbolId === event.symbolId) ? event.symbolId : null;

      console.debug(`[AI-Store] Nav → symbol=${event.symbolId} view=${targetViewId} focusSeq=${setPatch.focusSeq} src=${event._source ?? 'sse'} sseStale=${sseIsStale}`);
    }

    set({
      ...setPatch,
    });
  },

  acknowledgeAiNavigationSettled: (symbolId) => {
    const { aiAnalysis } = get();
    if (!aiAnalysis || !aiAnalysis.running) return;
    if (aiAnalysis.navigationTargetSymbolId !== symbolId) return;
    if ((aiAnalysis.navigationSettledSeq ?? 0) >= (aiAnalysis.navigationRequestedSeq ?? 0)) return;

    const next: AiAnalysisState = {
      ...aiAnalysis,
      navigationSettledSeq: aiAnalysis.navigationRequestedSeq,
      highlightSymbolId: symbolId,
      highlightSeq: (aiAnalysis.highlightSeq ?? 0) + 1,
    };

    if (aiAnalysis.pendingAnimationSymbolId === symbolId) {
      next.animationSymbolId = symbolId;
      next.animationSeq = (aiAnalysis.animationSeq ?? 0) + 1;
      next.pendingAnimationSymbolId = null;
    }

    set({ aiAnalysis: next });
  },

  stopAiAnalysis: () => {
    const { aiAnalysis } = get();
    if (!aiAnalysis) return;
    _lastDataUpdateTime = 0;
    set({
      aiAnalysis: { ...aiAnalysis, running: false, phase: "stopped" },
    });
  },

  toggleAiNavPaused: () => {
    const { aiAnalysis } = get();
    if (!aiAnalysis) return;
    set({ aiAnalysis: { ...aiAnalysis, navPaused: !aiAnalysis.navPaused } });
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
    const { graph, aiAnalysis, currentViewId, breadcrumb, selectedSymbolId, selectedEdgeId } = get();
    const localUpdateFresh =
      !!aiAnalysis?.running &&
      _lastDataUpdateTime > 0 &&
      (Date.now() - _lastDataUpdateTime) < 4000;

    if (localUpdateFresh && graph) {
      // Ignore potentially stale server snapshots shortly after local AI live updates.
      return;
    }

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
    // If the label is being changed, also update the title of the view this symbol owns
    const updatedViews = patch.label
      ? graph.views.map((v) => {
          const ownerSym = graph.symbols.find((s) => s.id === id && s.childViewId === v.id);
          return ownerSym ? { ...v, title: patch.label! } : v;
        })
      : graph.views;
    const updated = {
      ...graph,
      symbols: graph.symbols.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      views: updatedViews,
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

  confirmAiField: (symbolId, field) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      symbols: graph.symbols.map((s) => {
        if (s.id !== symbolId || !s.doc?.aiGenerated) return s;
        const { [field]: _, ...rest } = s.doc.aiGenerated;
        return { ...s, doc: { ...s.doc, aiGenerated: Object.keys(rest).length > 0 ? rest : undefined } };
      }),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  rejectAiField: (symbolId, field) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      symbols: graph.symbols.map((s) => {
        if (s.id !== symbolId) return s;
        const doc = { ...s.doc };
        // Remove the AI-generated marker
        if (doc.aiGenerated) {
          const { [field]: _, ...rest } = doc.aiGenerated;
          doc.aiGenerated = Object.keys(rest).length > 0 ? rest : undefined;
        }
        // Remove the actual data for the field
        if (field === "summary") doc.summary = undefined;
        if (field === "inputs") doc.inputs = undefined;
        if (field === "outputs") doc.outputs = undefined;
        if (field === "sideEffects") doc.sideEffects = undefined;
        if (field === "calls") doc.calls = undefined;
        if (field === "label") {
          // Revert label — we can't fully revert, but remove the marker
        }
        if (field === "deadCode") {
          return { ...s, doc, tags: (s.tags ?? []).filter((t) => t !== "dead-code") };
        }
        return { ...s, doc };
      }),
    };
    set({ graph: updated });
    get().syncGraphToServer();
  },

  confirmAiRelation: (relationId) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      relations: graph.relations.map((r) =>
        r.id === relationId ? { ...r, aiGenerated: undefined, confidence: 1 } : r,
      ),
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
