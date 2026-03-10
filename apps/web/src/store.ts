import { create } from "zustand";
import type { ProjectGraph, DiagramView, Symbol as Sym, Relation, RelationType } from "@dmpg/shared";
import type { AnalyzeEvent } from "./api";
import { buildWorkspaceCompletionHighlight, isAiDataEvent, resolveEventRunKind } from "./aiWorkspaceEvents";
import {
  bestNavigableViewForSymbol,
  bestNavigableViewForTargetIds,
  buildBreadcrumbPath,
  collectNavigableSymbolIds,
  isManagedProcessLayoutViewId,
  isTechnicalNavigationView,
  normalizeGraphForFrontend,
  resolveNavigableViewId,
} from "./viewNavigation";
import {
  DEFAULT_DIAGRAM_SETTINGS,
  cloneDiagramSettings,
  getDiagramPreset,
  mergeDiagramSettings,
  sanitizeDiagramSettings,
  type DiagramLayoutSettings,
  type DiagramPresetId,
  type DiagramSettings,
  type DiagramSettingsPatch,
} from "./diagramSettings";

/* ── Playback Queue Item ── */
export interface PlaybackItem {
  symbolId: string;
  viewId: string | null;
  event: AnalyzeEvent;
  /** Timestamp when this item became ready */
  readyAt: number;
}

/* ── Validate Mode Types ── */
export interface ValidateChange {
  id: string;
  symbolId: string;
  symbolLabel: string;
  field: string;       // "label" | "summary" | "inputs" | "outputs" | "sideEffects" | "deadCode" | "relation"
  phase: string;
  before: any;
  after: any;
  /** For relations: the relation ID */
  relationId?: string;
  /** Status of validation */
  status: "pending" | "confirmed" | "rejected";
}

export interface ValidateState {
  active: boolean;
  changes: ValidateChange[];
  currentIndex: number;
  baselineRunId: string | null;
}

export interface AiAnalysisState {
  runKind: "project_analysis" | "view_workspace";
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
  /** Playback queue: data events ready for sequential navigation+animation */
  playbackQueue: PlaybackItem[];
  /** Is playback currently animating a symbol? */
  playbackActive: boolean;
}

/* ── Debug Transport State ── */
export interface DebugTransportState {
  sseConnected: boolean;
  eventsPollerActive: boolean;
  statusPollerActive: boolean;
  lastSseSeq: number;
  lastPollSeq: number;
  lastEventTime: number;
  eventsDelivered: number;
  eventsDeduplicated: number;
  playbackQueueLen: number;
  navigationRequestedSeq: number;
  navigationSettledSeq: number;
}

export interface DebugDiagramState {
  currentViewId: string | null;
  layoutKey: string;
  layoutPass: number;
  layoutRunId: number;
  nodesRendered: number;
  edgesRendered: number;
  viewNodes: number;
  viewEdges: number;
  elkRouteCount: number;
  edgeHandleCount: number;
  dynamicPortNodeCount: number;
  dynamicPortCount: number;
  routeMode: "elk" | "fallback" | "mixed" | "none";
  routeReason: string;
  autoLayout: boolean;
  dragActive: boolean;
  persistedManualLayout: boolean;
  localManualLayoutOverride: boolean;
  manualLayoutActive: boolean;
  savedPositionCount: number;
  allHaveSavedPositions: boolean;
}

export interface ReviewHighlightState {
  activeItemId: string | null;
  nodeIds: string[];
  primaryNodeId: string | null;
  viewId: string | null;
  fitView: boolean;
  seq: number;
  previewNodeIds: string[];
}

export interface ViewportSnapshot {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewUiSnapshot {
  breadcrumb: string[];
  selectedSymbolId: string | null;
  selectedEdgeId: string | null;
  inspectorCollapsed: boolean;
  viewport: ViewportSnapshot | null;
}

export interface NavigateToViewOptions {
  restoreViewState?: boolean;
}

export interface AppState {
  graph: ProjectGraph | null;
  currentViewId: string | null;
  selectedSymbolId: string | null;
  selectedEdgeId: string | null;
  breadcrumb: string[]; // view IDs path
  viewUiSnapshots: Record<string, ViewUiSnapshot>;
  graphHistoryPast: GraphHistorySnapshot[];
  graphHistoryFuture: GraphHistorySnapshot[];
  historyCanUndo: boolean;
  historyCanRedo: boolean;

  // AI analysis
  aiAnalysis: AiAnalysisState | null;
  startAiAnalysis: (runKind?: "project_analysis" | "view_workspace") => void;
  addAiEvent: (event: AnalyzeEvent) => void;
  acknowledgeAiNavigationSettled: (symbolId: string) => void;
  stopAiAnalysis: () => void;
  toggleAiNavPaused: () => void;
  resetPlaybackQueue: () => void;
  /** Process next item from the playback queue */
  processPlaybackQueue: () => void;

  // Validate mode
  validateState: ValidateState;
  enterValidateMode: () => void;
  exitValidateMode: () => void;
  validateNavigateTo: (index: number) => void;
  validateNext: () => void;
  validatePrev: () => void;
  validateConfirm: (changeId: string, comment?: string) => void;
  validateReject: (changeId: string, comment?: string) => void;
  validateConfirmAll: () => void;

  // Inspector
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;

  // Diagram settings
  diagramSettings: DiagramSettings;
  diagramLayoutVersion: number;
  updateDiagramSettings: (patch: DiagramSettingsPatch) => void;
  updateDiagramLayout: (patch: Partial<DiagramLayoutSettings>) => void;
  setRelationFilter: (relationType: RelationType, enabled: boolean) => void;
  setDiagramPreset: (presetId: DiagramPresetId) => void;
  applyDiagramLayout: () => void;
  resetDiagramSettings: () => void;
  resetProjectLayout: () => void;

  // Hover card
  hoverSymbolId: string | null;
  hoverPosition: { x: number; y: number; source?: "canvas" | "inspector" } | null;
  setHoverSymbol: (
    id: string | null,
    pos?: { x: number; y: number; source?: "canvas" | "inspector" } | null,
  ) => void;

  // Focus-navigate: zoom to a specific node after view change
  focusNodeId: string | null;
  focusSeq: number;
  setFocusNode: (id: string | null) => void;
  viewFitViewId: string | null;
  viewFitSeq: number;
  viewRestoreViewId: string | null;
  viewRestoreSeq: number;
  saveCurrentViewSnapshot: (patch?: Partial<ViewUiSnapshot>) => void;

  // Review hint graph focus
  reviewHighlight: ReviewHighlightState;
  activateReviewHighlight: (payload: {
    itemId: string;
    nodeIds: string[];
    primaryNodeId?: string | null;
    viewId?: string | null;
    fitView?: boolean;
    inspectPrimary?: boolean;
  }) => void;
  previewReviewHighlight: (nodeIds: string[]) => void;
  clearReviewHighlight: () => void;

  // Source viewer popup
  sourceViewerSymbol: { id: string; label: string } | null;
  openSourceViewer: (symbolId: string, label: string) => void;
  closeSourceViewer: () => void;

  // Debug transport state
  debugTransport: DebugTransportState | null;
  debugDiagram: DebugDiagramState | null;
  showDebugTransport: boolean;
  toggleDebugTransport: () => void;
  updateDebugTransport: (patch: Partial<DebugTransportState>) => void;
  updateDebugDiagram: (patch: Partial<DebugDiagramState>) => void;

  // actions
  setGraph: (g: ProjectGraph) => void;
  /** Update graph data while keeping current view / breadcrumb intact */
  updateGraph: (g: ProjectGraph) => void;
  undoGraphChange: () => void;
  redoGraphChange: () => void;
  navigateToView: (viewId: string, options?: NavigateToViewOptions) => void;
  goBack: () => void;
  focusSymbolInContext: (symbolId: string, preferredViewId?: string | null) => void;
  selectSymbol: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  getCurrentView: () => DiagramView | null;
  getSymbol: (id: string) => Sym | undefined;
  getView: (id: string) => DiagramView | undefined;
  updateView: (id: string, patch: Partial<DiagramView>) => void;

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

export interface GraphHistorySnapshot {
  graph: ProjectGraph;
  currentViewId: string | null;
  selectedSymbolId: string | null;
  selectedEdgeId: string | null;
  breadcrumb: string[];
}

/* ── AI animation timing: track last data update for navigation ── */
let _lastDataUpdateTime = 0;
let _lastSseDataEventTime = 0;
const DIAGRAM_SETTINGS_STORAGE_KEY = "dmpg.diagram-settings.v1";
const MAX_GRAPH_HISTORY = 80;

export {
  bestNavigableViewForSymbol,
  collectNavigableSymbolIds,
  isTechnicalNavigationView,
} from "./viewNavigation";

function cloneProjectGraph(graph: ProjectGraph): ProjectGraph {
  if (typeof structuredClone === "function") {
    return structuredClone(graph);
  }
  return JSON.parse(JSON.stringify(graph)) as ProjectGraph;
}

function buildGraphHistorySnapshot(state: Pick<AppState,
  "graph" | "currentViewId" | "selectedSymbolId" | "selectedEdgeId" | "breadcrumb">): GraphHistorySnapshot | null {
  if (!state.graph) return null;
  return {
    graph: cloneProjectGraph(state.graph),
    currentViewId: state.currentViewId,
    selectedSymbolId: state.selectedSymbolId,
    selectedEdgeId: state.selectedEdgeId,
    breadcrumb: [...state.breadcrumb],
  };
}

function normalizeSnapshotBreadcrumb(
  graph: ProjectGraph | null,
  viewId: string,
  breadcrumb: string[] | undefined,
): string[] {
  if (!graph) {
    return breadcrumb && breadcrumb.length > 0 ? [...breadcrumb] : [viewId];
  }
  const validViewIds = new Set(graph.views.map((view) => view.id));
  if (
    breadcrumb &&
    breadcrumb.length > 0 &&
    breadcrumb[breadcrumb.length - 1] === viewId &&
    breadcrumb.every((entry) => validViewIds.has(entry))
  ) {
    return [...breadcrumb];
  }
  return buildViewPath(graph, viewId);
}

function buildViewUiSnapshot(
  state: Pick<AppState,
    | "graph"
    | "currentViewId"
    | "breadcrumb"
    | "selectedSymbolId"
    | "selectedEdgeId"
    | "inspectorCollapsed"
    | "viewUiSnapshots">,
  viewId: string,
  patch: Partial<ViewUiSnapshot> = {},
): ViewUiSnapshot {
  const previous = state.viewUiSnapshots[viewId];
  const isCurrentView = state.currentViewId === viewId;
  return {
    breadcrumb: normalizeSnapshotBreadcrumb(
      state.graph,
      viewId,
      patch.breadcrumb ?? (isCurrentView ? state.breadcrumb : previous?.breadcrumb),
    ),
    selectedSymbolId: patch.selectedSymbolId !== undefined
      ? patch.selectedSymbolId
      : (isCurrentView ? state.selectedSymbolId : previous?.selectedSymbolId ?? null),
    selectedEdgeId: patch.selectedEdgeId !== undefined
      ? patch.selectedEdgeId
      : (isCurrentView ? state.selectedEdgeId : previous?.selectedEdgeId ?? null),
    inspectorCollapsed: patch.inspectorCollapsed ?? (isCurrentView ? state.inspectorCollapsed : previous?.inspectorCollapsed ?? false),
    viewport: patch.viewport !== undefined ? patch.viewport : previous?.viewport ?? null,
  };
}

function withSavedCurrentViewSnapshot(
  state: Pick<AppState,
    | "graph"
    | "currentViewId"
    | "breadcrumb"
    | "selectedSymbolId"
    | "selectedEdgeId"
    | "inspectorCollapsed"
    | "viewUiSnapshots">,
  patch: Partial<ViewUiSnapshot> = {},
): Record<string, ViewUiSnapshot> {
  if (!state.currentViewId) return state.viewUiSnapshots;
  return {
    ...state.viewUiSnapshots,
    [state.currentViewId]: buildViewUiSnapshot(state, state.currentViewId, patch),
  };
}

function isRestorableSelectedSymbol(
  graph: ProjectGraph | null,
  viewId: string,
  symbolId: string | null,
): boolean {
  if (!graph || !symbolId) return false;
  const view = graph.views.find((entry) => entry.id === viewId);
  return !!view && view.nodeRefs.includes(symbolId) && graph.symbols.some((symbol) => symbol.id === symbolId);
}

function isRestorableSelectedEdge(
  graph: ProjectGraph | null,
  edgeId: string | null,
): boolean {
  if (!edgeId) return false;
  if (edgeId.includes("|")) return true;
  if (!graph) return false;
  return graph.relations.some((relation) => relation.id === edgeId);
}

function getRestorableViewSnapshot(
  state: Pick<AppState, "graph" | "viewUiSnapshots">,
  viewId: string,
): ViewUiSnapshot | null {
  const snapshot = state.viewUiSnapshots[viewId];
  if (!snapshot) return null;
  return {
    breadcrumb: normalizeSnapshotBreadcrumb(state.graph, viewId, snapshot.breadcrumb),
    selectedSymbolId: isRestorableSelectedSymbol(state.graph, viewId, snapshot.selectedSymbolId)
      ? snapshot.selectedSymbolId
      : null,
    selectedEdgeId: isRestorableSelectedEdge(state.graph, snapshot.selectedEdgeId)
      ? snapshot.selectedEdgeId
      : null,
    inspectorCollapsed: snapshot.inspectorCollapsed,
    viewport: snapshot.viewport ?? null,
  };
}

function pruneViewUiSnapshots(
  graph: ProjectGraph,
  snapshots: Record<string, ViewUiSnapshot>,
): Record<string, ViewUiSnapshot> {
  const validViewIds = new Set(graph.views.map((view) => view.id));
  const next: Record<string, ViewUiSnapshot> = {};

  for (const [viewId, snapshot] of Object.entries(snapshots)) {
    if (!validViewIds.has(viewId)) continue;
    next[viewId] = {
      ...snapshot,
      breadcrumb: normalizeSnapshotBreadcrumb(graph, viewId, snapshot.breadcrumb),
      selectedSymbolId: isRestorableSelectedSymbol(graph, viewId, snapshot.selectedSymbolId)
        ? snapshot.selectedSymbolId
        : null,
      selectedEdgeId: isRestorableSelectedEdge(graph, snapshot.selectedEdgeId)
        ? snapshot.selectedEdgeId
        : null,
      viewport: snapshot.viewport ?? null,
    };
  }

  return next;
}

function historyPatchWithCurrentSnapshot(state: Pick<AppState,
  | "graph"
  | "currentViewId"
  | "selectedSymbolId"
  | "selectedEdgeId"
  | "breadcrumb"
  | "graphHistoryPast"
  | "graphHistoryFuture">) {
  const snapshot = buildGraphHistorySnapshot(state);
  if (!snapshot) {
    return {
      graphHistoryPast: state.graphHistoryPast,
      graphHistoryFuture: state.graphHistoryFuture,
      historyCanUndo: state.graphHistoryPast.length > 0,
      historyCanRedo: state.graphHistoryFuture.length > 0,
    };
  }
  const past = [...state.graphHistoryPast, snapshot];
  if (past.length > MAX_GRAPH_HISTORY) past.shift();
  return {
    graphHistoryPast: past,
    graphHistoryFuture: [] as GraphHistorySnapshot[],
    historyCanUndo: past.length > 0,
    historyCanRedo: false,
  };
}

function loadDiagramSettings(): DiagramSettings {
  if (typeof window === "undefined") {
    return cloneDiagramSettings(DEFAULT_DIAGRAM_SETTINGS);
  }
  try {
    const raw = window.localStorage.getItem(DIAGRAM_SETTINGS_STORAGE_KEY);
    if (!raw) return cloneDiagramSettings(DEFAULT_DIAGRAM_SETTINGS);
    return sanitizeDiagramSettings(JSON.parse(raw));
  } catch {
    return cloneDiagramSettings(DEFAULT_DIAGRAM_SETTINGS);
  }
}

function persistDiagramSettings(settings: DiagramSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DIAGRAM_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: keep settings in-memory if storage fails.
  }
}

/** Build the full ancestor chain from root down to the given view */
function buildViewPath(graph: { rootViewId: string; views: Array<{ id: string; parentViewId?: string | null }> }, viewId: string): string[] {
  return buildBreadcrumbPath(graph as Pick<ProjectGraph, "rootViewId" | "views">, viewId);
}

export const useAppStore = create<AppState>((set, get) => ({
  graph: null,
  currentViewId: null,
  selectedSymbolId: null,
  selectedEdgeId: null,
  breadcrumb: [],
  viewUiSnapshots: {},
  graphHistoryPast: [],
  graphHistoryFuture: [],
  historyCanUndo: false,
  historyCanRedo: false,

  aiAnalysis: null,

  // Validate mode — initial state
  validateState: { active: false, changes: [], currentIndex: -1, baselineRunId: null },

  inspectorCollapsed: false,
  toggleInspector: () => set((state) => ({
    inspectorCollapsed: !state.inspectorCollapsed,
    viewUiSnapshots: withSavedCurrentViewSnapshot(state, {
      inspectorCollapsed: !state.inspectorCollapsed,
    }),
  })),
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  diagramSettings: loadDiagramSettings(),
  diagramLayoutVersion: 1,
  updateDiagramSettings: (patch) =>
    set((state) => {
      const next = sanitizeDiagramSettings(
        mergeDiagramSettings(state.diagramSettings, {
          ...patch,
          activePreset: patch.activePreset ?? "custom",
        }),
      );
      persistDiagramSettings(next);
      return { diagramSettings: next };
    }),
  updateDiagramLayout: (patch) =>
    set((state) => {
      const next = sanitizeDiagramSettings(
        mergeDiagramSettings(state.diagramSettings, {
          activePreset: "custom",
          layout: patch,
        }),
      );
      persistDiagramSettings(next);
      return { diagramSettings: next };
    }),
  setRelationFilter: (relationType, enabled) =>
    set((state) => {
      const next = sanitizeDiagramSettings(
        mergeDiagramSettings(state.diagramSettings, {
          activePreset: "custom",
          relationFilters: {
            [relationType]: enabled,
          } as Partial<Record<RelationType, boolean>>,
        }),
      );
      persistDiagramSettings(next);
      return { diagramSettings: next };
    }),
  setDiagramPreset: (presetId) =>
    set(() => {
      const preset = getDiagramPreset(presetId);
      if (!preset) return {};
      const next = sanitizeDiagramSettings(
        mergeDiagramSettings(cloneDiagramSettings(DEFAULT_DIAGRAM_SETTINGS), {
          ...preset.settings,
          activePreset: presetId,
        }),
      );
      persistDiagramSettings(next);
      return { diagramSettings: next };
    }),
  applyDiagramLayout: () => set((state) => ({ diagramLayoutVersion: state.diagramLayoutVersion + 1 })),
  resetDiagramSettings: () =>
    set((state) => {
      const next = cloneDiagramSettings(DEFAULT_DIAGRAM_SETTINGS);
      persistDiagramSettings(next);
      return {
        diagramSettings: next,
        diagramLayoutVersion: state.diagramLayoutVersion + 1,
      };
    }),
  resetProjectLayout: () => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      views: graph.views.map((view) => ({
        ...view,
        manualLayout: undefined,
        nodePositions: undefined,
      })),
    };
    set((state) => ({
      graph: updated,
      diagramLayoutVersion: state.diagramLayoutVersion + 1,
      ...historyPatchWithCurrentSnapshot(state),
    }));
    void get().syncGraphToServer();
  },

  hoverSymbolId: null,
  hoverPosition: null,
  setHoverSymbol: (id, pos) => set({ hoverSymbolId: id, hoverPosition: pos ?? null }),

  focusNodeId: null,
  focusSeq: 0,
  viewFitViewId: null,
  viewFitSeq: 0,
  viewRestoreViewId: null,
  viewRestoreSeq: 0,
  setFocusNode: (id) =>
    set((state) => {
      if (id) {
        return {
          focusNodeId: id,
          focusSeq: state.focusSeq + 1,
          selectedSymbolId: id,
          selectedEdgeId: null,
          inspectorCollapsed: false,
          viewUiSnapshots: withSavedCurrentViewSnapshot(state, {
            selectedSymbolId: id,
            selectedEdgeId: null,
            inspectorCollapsed: false,
          }),
        };
      }
      return { focusNodeId: null };
    }),
  saveCurrentViewSnapshot: (patch = {}) =>
    set((state) => ({
      viewUiSnapshots: withSavedCurrentViewSnapshot(state, patch),
    })),

  reviewHighlight: {
    activeItemId: null,
    nodeIds: [],
    primaryNodeId: null,
    viewId: null,
    fitView: false,
    seq: 0,
    previewNodeIds: [],
  },
  activateReviewHighlight: (payload) =>
    set((state) => {
      const targetViewId = state.graph
        ? (
          payload.nodeIds.length > 0
            ? bestNavigableViewForTargetIds(state.graph, payload.viewId ?? state.currentViewId, payload.nodeIds)
            : resolveNavigableViewId(state.graph, payload.viewId ?? state.currentViewId, state.currentViewId)
        )
        : (payload.viewId ?? state.currentViewId);
      const nextBreadcrumb = state.graph && targetViewId
        ? buildViewPath(state.graph, targetViewId)
        : state.breadcrumb;
      const uniqueNodeIds = Array.from(new Set(payload.nodeIds));
      return {
        currentViewId: targetViewId ?? state.currentViewId,
        breadcrumb: targetViewId ? nextBreadcrumb : state.breadcrumb,
        selectedSymbolId: payload.inspectPrimary === false ? state.selectedSymbolId : (payload.primaryNodeId ?? uniqueNodeIds[0] ?? null),
        selectedEdgeId: null,
        inspectorCollapsed: payload.inspectPrimary === false ? state.inspectorCollapsed : false,
        reviewHighlight: {
          activeItemId: payload.itemId,
          nodeIds: uniqueNodeIds,
          primaryNodeId: payload.primaryNodeId ?? uniqueNodeIds[0] ?? null,
          viewId: targetViewId ?? state.currentViewId,
          fitView: payload.fitView ?? true,
          seq: state.reviewHighlight.seq + 1,
          previewNodeIds: [],
        },
      };
    }),
  previewReviewHighlight: (nodeIds) =>
    set((state) => ({
      reviewHighlight: {
        ...state.reviewHighlight,
        previewNodeIds: Array.from(new Set(nodeIds)),
      },
    })),
  clearReviewHighlight: () =>
    set((state) => ({
      reviewHighlight: {
        ...state.reviewHighlight,
        activeItemId: null,
        nodeIds: [],
        primaryNodeId: null,
        fitView: false,
        seq: state.reviewHighlight.seq + 1,
        previewNodeIds: [],
      },
    })),

  sourceViewerSymbol: null,
  openSourceViewer: (symbolId, label) => set({ sourceViewerSymbol: { id: symbolId, label } }),
  closeSourceViewer: () => set({ sourceViewerSymbol: null }),

  // Debug transport state
  debugTransport: null,
  debugDiagram: null,
  showDebugTransport: false,
  toggleDebugTransport: () => set((s) => ({ showDebugTransport: !s.showDebugTransport })),
  updateDebugTransport: (patch) => set((s) => ({
    debugTransport: { ...((s.debugTransport ?? {
      sseConnected: false, eventsPollerActive: false, statusPollerActive: false,
      lastSseSeq: 0, lastPollSeq: 0, lastEventTime: 0,
      eventsDelivered: 0, eventsDeduplicated: 0, playbackQueueLen: 0,
      navigationRequestedSeq: 0, navigationSettledSeq: 0,
    }) as DebugTransportState), ...patch },
  })),
  updateDebugDiagram: (patch) => set((s) => ({
    debugDiagram: { ...((s.debugDiagram ?? {
      currentViewId: null,
      layoutKey: "",
      layoutPass: 0,
      layoutRunId: 0,
      nodesRendered: 0,
      edgesRendered: 0,
      viewNodes: 0,
      viewEdges: 0,
      elkRouteCount: 0,
      edgeHandleCount: 0,
      dynamicPortNodeCount: 0,
      dynamicPortCount: 0,
      routeMode: "none",
      routeReason: "waiting for layout",
      autoLayout: true,
      dragActive: false,
      persistedManualLayout: false,
      localManualLayoutOverride: false,
      manualLayoutActive: false,
      savedPositionCount: 0,
      allHaveSavedPositions: false,
    }) as DebugDiagramState), ...patch },
  })),

  startAiAnalysis: (runKind = "project_analysis") =>
    set({
      aiAnalysis: {
        runKind,
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
        playbackQueue: [],
        playbackActive: false,
      },
    }),

  addAiEvent: (event) => {
    const { aiAnalysis, graph, currentViewId, breadcrumb } = get();
    if (!aiAnalysis) return;

    // Classify event source and type
    const isPollStatus = event._source === "poll" && event.action === "poll-progress";
    const isPollEvents = event._source === "poll-events";
    const isSse = event._source === "sse" || !event._source;
    const eventRunKind = resolveEventRunKind(event, aiAnalysis.runKind);
    const isDataEvent = isAiDataEvent(event, eventRunKind);

    // For status-poll events, only update progress overlay — no log, no graph, no navigation
    if (isPollStatus) {
      const thought = event.thought ?? (event.symbolLabel && event.phase ? `${event.phase}: ${event.symbolLabel}` : null) ?? aiAnalysis.thought;
      set({
        aiAnalysis: {
          ...aiAnalysis,
          runKind: eventRunKind,
          phase: event.phase ?? aiAnalysis.phase,
          current: event.current ?? aiAnalysis.current,
          total: event.total ?? aiAnalysis.total,
          thought,
          aiFocusViewId: event.viewId ?? aiAnalysis.aiFocusViewId,
          aiCurrentSymbolId: event.symbolId ?? aiAnalysis.aiCurrentSymbolId,
          // aiWorkingSymbolId is driven by the playback queue, not by live events
        },
      });
      return;
    }

    // From here: SSE or poll-events data
    const newPhase = event.phase ?? aiAnalysis.phase;
    const newLog = [...aiAnalysis.log, event];

    const thought = event.thought ?? (event.symbolLabel && event.phase ? `${event.phase}: ${event.symbolLabel}` : null) ?? aiAnalysis.thought;

    // Track SSE data event freshness
    if (isDataEvent && isSse) _lastSseDataEventTime = Date.now();

    console.debug(`[AI-Store] src=${event._source ?? 'sse'} action=${event.action ?? '-'} symbol=${event.symbolId ?? '-'} current=${event.current ?? '-'}/${event.total ?? '-'} dataEvent=${isDataEvent}`);

    // ── Update debug transport state ──
    const debugPatch: Partial<DebugTransportState> = {
      lastEventTime: Date.now(),
      eventsDelivered: ((get().debugTransport?.eventsDelivered ?? 0) + 1),
    };
    if (isSse && event.seq) debugPatch.lastSseSeq = event.seq;
    if (isPollEvents && event.seq) debugPatch.lastPollSeq = event.seq;
    if (isSse) debugPatch.sseConnected = true;
    if (isPollEvents) debugPatch.eventsPollerActive = true;
    if (isPollStatus) debugPatch.statusPollerActive = true;
    get().updateDebugTransport(debugPatch);

    // If phase is terminal, mark as not running and reload graph once.
    if (event.phase === "done" || event.phase === "error" || event.phase === "cancelled" || event.phase === "paused") {
      _lastDataUpdateTime = 0;
      _lastSseDataEventTime = 0;
      set({
        aiAnalysis: {
          runKind: eventRunKind,
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
          playbackQueue: [],
          playbackActive: false,
        },
      });

      fetch("/api/graph")
        .then((r) => r.json())
        .then((g) => {
          get().updateGraph(g);
          if (eventRunKind === "view_workspace") {
            const completionHighlight = buildWorkspaceCompletionHighlight(event);
            if (completionHighlight) {
              const resolvedViewId = completionHighlight.nodeIds.length > 0
                ? bestNavigableViewForTargetIds(g, completionHighlight.viewId ?? get().currentViewId, completionHighlight.nodeIds)
                : resolveNavigableViewId(g, completionHighlight.viewId ?? get().currentViewId, get().currentViewId);
              if (completionHighlight.nodeIds.length > 0) {
                get().activateReviewHighlight({
                  itemId: `workspace-run:${Date.now()}`,
                  nodeIds: completionHighlight.nodeIds,
                  primaryNodeId: completionHighlight.primaryNodeId,
                  viewId: resolvedViewId ?? get().currentViewId,
                  fitView: true,
                  inspectPrimary: true,
                });
              } else if (resolvedViewId) {
                get().navigateToView(resolvedViewId);
              }
            }
          }
        })
        .catch(console.error);
      return;
    }

    if (eventRunKind === "view_workspace" && event.action === "saved") {
      fetch("/api/graph")
        .then((response) => response.json())
        .then((g) => get().updateGraph(g))
        .catch(() => {});
    }

    // ── Live graph updates from data events ──
    let contentChangedSymbolId: string | null = null;
    if (graph && !isPollStatus) {
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
          const kindChanged = (sym.doc?.deadCodeKind ?? "") !== (event.deadCodeKind ?? "");
          const aiMarkerMissing = !sym.doc?.aiGenerated?.deadCode;

          if (!alreadyTagged || reasonChanged || kindChanged || aiMarkerMissing) {
            symbols[symbolIndex] = {
              ...sym,
              tags: [...(sym.tags ?? []).filter((t) => t !== "dead-code"), "dead-code"],
              doc: {
                ...sym.doc,
                aiGenerated: { ...(sym.doc?.aiGenerated ?? {}), deadCode: true },
                deadCodeReason: nextReason,
                deadCodeKind: event.deadCodeKind,
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

    const nextAnalysisSeq = isDataEvent && event.symbolId
      ? (aiAnalysis.analysisSeq ?? 0) + 1
      : (aiAnalysis.analysisSeq ?? 0);

    // ── Playback Queue: enqueue data events for sequential navigation ──
    let nextPlaybackQueue = [...aiAnalysis.playbackQueue];
    if (isDataEvent && event.symbolId && !aiAnalysis.navPaused) {
      const targetViewId = graph
        ? bestNavigableViewForSymbol(graph, event.symbolId, {
            preferredViewId: event.viewId ?? aiAnalysis.aiFocusViewId,
            currentViewId: get().currentViewId,
          })
        : null;
      nextPlaybackQueue.push({
        symbolId: event.symbolId,
        viewId: targetViewId,
        event,
        readyAt: Date.now(),
      });
    }

    // Fast-forward: if queue is getting very long, trim old items (keep last 8)
    if (nextPlaybackQueue.length > 12) {
      nextPlaybackQueue = nextPlaybackQueue.slice(-8);
    }

    const nextAiState: AiAnalysisState = {
      ...aiAnalysis,
      runKind: eventRunKind,
      running: true,
      phase: newPhase,
      log: newLog,
      current: newCurrent,
      total: newTotal,
      thought,
      aiFocusViewId: event.viewId ?? aiAnalysis.aiFocusViewId,
      aiCurrentSymbolId: event.symbolId ?? aiAnalysis.aiCurrentSymbolId,
      // aiWorkingSymbolId is driven by the playback queue, not by live events
      aiWorkingSymbolId: aiAnalysis.aiWorkingSymbolId,
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
      playbackQueue: nextPlaybackQueue,
      playbackActive: aiAnalysis.playbackActive,
    };

    set({ aiAnalysis: nextAiState });

    // Update debug transport with queue length
    get().updateDebugTransport({
      playbackQueueLen: nextPlaybackQueue.length,
      navigationRequestedSeq: nextAiState.navigationRequestedSeq,
      navigationSettledSeq: nextAiState.navigationSettledSeq,
    });

    // If not currently playing, kick off playback
    if (!aiAnalysis.playbackActive && nextPlaybackQueue.length > 0) {
      // Use setTimeout to allow the current set() to commit first
      setTimeout(() => get().processPlaybackQueue(), 50);
    }
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

    // Navigation settled → kick playback queue forward if items are waiting
    if (next.playbackQueue.length > 0 && next.playbackActive) {
      setTimeout(() => get().processPlaybackQueue(), 100);
    }
  },

  processPlaybackQueue: () => {
    const { aiAnalysis, graph, currentViewId } = get();
    if (!aiAnalysis || !aiAnalysis.running) return;
    if (aiAnalysis.playbackQueue.length === 0) {
      if (aiAnalysis.playbackActive) {
        set({ aiAnalysis: { ...aiAnalysis, playbackActive: false } });
      }
      return;
    }
    if (aiAnalysis.navPaused) {
      set({ aiAnalysis: { ...aiAnalysis, playbackActive: false } });
      return;
    }

    // ── Wait for previous navigation to settle before advancing ──
    // If we have a pending navigation that hasn't settled yet, re-check shortly
    if (aiAnalysis.navigationTargetSymbolId &&
        (aiAnalysis.navigationSettledSeq ?? 0) < (aiAnalysis.navigationRequestedSeq ?? 0)) {
      // Previous nav not settled — retry after a short wait
      setTimeout(() => get().processPlaybackQueue(), 200);
      return;
    }

    // Dequeue front item
    const [item, ...rest] = aiAnalysis.playbackQueue;

    // Fast mode: if queue is long, skip intermediate items and only process last few
    const fastMode = rest.length > 5;
    if (fastMode && rest.length > 3) {
      // Skip to the last 3 items — just flash through intermediates
      const skipCount = rest.length - 3;
      const skipped = rest.splice(0, skipCount);
      console.debug(`[AI-Playback] Fast-mode: skipping ${skipped.length} queued items`);
    }

    const nextAi: AiAnalysisState = {
      ...aiAnalysis,
      playbackActive: true,
      playbackQueue: rest,
    };

    const setPatch: Partial<AppState> = { aiAnalysis: nextAi };

    if (item.symbolId && graph) {
      const targetViewId = item.viewId ?? bestNavigableViewForSymbol(graph, item.symbolId, {
        preferredViewId: aiAnalysis.aiFocusViewId,
        currentViewId,
      });
      if (targetViewId) {
        setPatch.currentViewId = targetViewId;
        setPatch.breadcrumb = buildViewPath(graph, targetViewId);
        setPatch.viewFitViewId = targetViewId;
        setPatch.viewFitSeq = (get().viewFitSeq ?? 0) + 1;
      }
      setPatch.focusNodeId = item.symbolId;
      setPatch.focusSeq = (get().focusSeq ?? 0) + 1;
      setPatch.selectedSymbolId = item.symbolId;
      setPatch.selectedEdgeId = null;
      setPatch.inspectorCollapsed = false;

      const nextNavReqSeq = (nextAi.navigationRequestedSeq ?? 0) + 1;
      nextAi.navigationRequestedSeq = nextNavReqSeq;
      nextAi.navigationTargetSymbolId = item.symbolId;
      nextAi.pendingAnimationSymbolId = item.symbolId;
      // Drive the working-symbol highlight from the playback queue so it
      // matches the node we are actually navigating to (not the live AI stream)
      nextAi.aiWorkingSymbolId = item.symbolId;

      console.debug(`[AI-Playback] Nav → symbol=${item.symbolId} view=${targetViewId} queueLen=${rest.length} fast=${fastMode}`);
    }

    set(setPatch);

    // Schedule next: short delay for fast mode, longer for normal
    // but also rely on acknowledgeAiNavigationSettled to re-trigger
    const delay = fastMode ? 300 : rest.length > 3 ? 600 : rest.length > 1 ? 900 : 1200;
    setTimeout(() => {
      get().processPlaybackQueue();
    }, delay);
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

  resetPlaybackQueue: () => {
    const { aiAnalysis } = get();
    if (!aiAnalysis) return;
    set({
      aiAnalysis: {
        ...aiAnalysis,
        playbackQueue: [],
        playbackActive: false,
        pendingAnimationSymbolId: null,
        aiWorkingSymbolId: null,
      },
    });
  },

  // ── Validate Mode Methods ──

  enterValidateMode: async () => {
    const { graph } = get();
    if (!graph) return;

    try {
      const { fetchAnalyzeBaseline } = await import("./api.js");
      const baseline = await fetchAnalyzeBaseline();
      if (!baseline.runId) {
        console.warn("[Validate] No baseline available");
        return;
      }

      const changes: ValidateChange[] = [];
      let changeId = 0;

      for (const sym of graph.symbols) {
        const base = baseline.symbols[sym.id];
        const aiFlags = sym.doc?.aiGenerated;
        if (!aiFlags) continue;

        // Label change
        if (aiFlags.label && base && base.label !== sym.label) {
          changes.push({
            id: String(++changeId),
            symbolId: sym.id,
            symbolLabel: sym.label,
            field: "label",
            phase: "labels",
            before: base.label,
            after: sym.label,
            status: "pending",
          });
        }

        // Summary change
        if (aiFlags.summary && sym.doc?.summary) {
          changes.push({
            id: String(++changeId),
            symbolId: sym.id,
            symbolLabel: sym.label,
            field: "summary",
            phase: "docs",
            before: base?.doc?.summary ?? "",
            after: sym.doc.summary,
            status: "pending",
          });
        }

        // Inputs change
        if (aiFlags.inputs && sym.doc?.inputs?.length) {
          changes.push({
            id: String(++changeId),
            symbolId: sym.id,
            symbolLabel: sym.label,
            field: "inputs",
            phase: "docs",
            before: JSON.stringify(base?.doc?.inputs ?? [], null, 2),
            after: JSON.stringify(sym.doc.inputs, null, 2),
            status: "pending",
          });
        }

        // Outputs change
        if (aiFlags.outputs && sym.doc?.outputs?.length) {
          changes.push({
            id: String(++changeId),
            symbolId: sym.id,
            symbolLabel: sym.label,
            field: "outputs",
            phase: "docs",
            before: JSON.stringify(base?.doc?.outputs ?? [], null, 2),
            after: JSON.stringify(sym.doc.outputs, null, 2),
            status: "pending",
          });
        }

        // Dead-code tagging
        if (aiFlags.deadCode && sym.doc?.deadCodeReason) {
          const wasDead = base?.tags?.includes("dead-code") ?? false;
          changes.push({
            id: String(++changeId),
            symbolId: sym.id,
            symbolLabel: sym.label,
            field: "deadCode",
            phase: "dead-code",
            before: wasDead ? (base?.doc?.deadCodeReason ?? "dead-code") : "",
            after: sym.doc.deadCodeReason ?? "dead-code",
            status: "pending",
          });
        }
      }

      // AI-generated relations
      for (const rel of graph.relations) {
        if (!rel.aiGenerated) continue;
        const wasPresent = baseline.relationIds.includes(rel.id);
        if (!wasPresent) {
          const sourceSym = graph.symbols.find((s) => s.id === rel.source);
          const targetSym = graph.symbols.find((s) => s.id === rel.target);
          changes.push({
            id: String(++changeId),
            symbolId: rel.source,
            symbolLabel: `${sourceSym?.label ?? rel.source} → ${targetSym?.label ?? rel.target}`,
            field: "relation",
            phase: "relations",
            before: "",
            after: `${rel.type}: ${rel.label ?? ""}`,
            relationId: rel.id,
            status: "pending",
          });
        }
      }

      set({
        validateState: {
          active: true,
          changes,
          currentIndex: changes.length > 0 ? 0 : -1,
          baselineRunId: baseline.runId,
        },
      });

      // Navigate to first change if available
      if (changes.length > 0) {
        get().validateNavigateTo(0);
      }
    } catch (err) {
      console.error("[Validate] Failed to enter validate mode:", err);
    }
  },

  exitValidateMode: () => {
    set({
      validateState: { active: false, changes: [], currentIndex: -1, baselineRunId: null },
    });
  },

  validateNavigateTo: (index) => {
    const { validateState, graph, currentViewId } = get();
    if (!validateState.active || !graph) return;
    const change = validateState.changes[index];
    if (!change) return;

    const targetViewId = bestNavigableViewForSymbol(graph, change.symbolId, { currentViewId });
    const setPatch: Partial<AppState> = {
      validateState: { ...validateState, currentIndex: index },
      selectedSymbolId: change.symbolId,
      selectedEdgeId: change.relationId ?? null,
      inspectorCollapsed: false,
      focusNodeId: change.symbolId,
      focusSeq: (get().focusSeq ?? 0) + 1,
    };
    if (targetViewId) {
      setPatch.currentViewId = targetViewId;
      setPatch.breadcrumb = buildViewPath(graph, targetViewId);
      setPatch.viewFitViewId = targetViewId;
      setPatch.viewFitSeq = (get().viewFitSeq ?? 0) + 1;
    }
    set(setPatch);
  },

  validateNext: () => {
    const { validateState } = get();
    if (!validateState.active) return;
    const pending = validateState.changes
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.status === "pending" && i > validateState.currentIndex);
    if (pending.length > 0) {
      get().validateNavigateTo(pending[0].i);
    } else {
      // Wrap around to first pending
      const first = validateState.changes.findIndex((c) => c.status === "pending");
      if (first >= 0) get().validateNavigateTo(first);
    }
  },

  validatePrev: () => {
    const { validateState } = get();
    if (!validateState.active) return;
    const pending = validateState.changes
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.status === "pending" && i < validateState.currentIndex);
    if (pending.length > 0) {
      get().validateNavigateTo(pending[pending.length - 1].i);
    } else {
      // Wrap around to last pending
      const last = validateState.changes.map((c, i) => ({ c, i })).filter(({ c }) => c.status === "pending");
      if (last.length > 0) get().validateNavigateTo(last[last.length - 1].i);
    }
  },

  validateConfirm: (changeId, comment) => {
    const { validateState } = get();
    if (!validateState.active) return;
    const idx = validateState.changes.findIndex((c) => c.id === changeId);
    if (idx < 0) return;
    const change = validateState.changes[idx];

    if (comment?.trim()) {
      console.debug(`[Validate] Confirm comment for ${changeId}: ${comment.trim()}`);
    }

    // Confirm in the graph
    if (change.field === "relation" && change.relationId) {
      get().confirmAiRelation(change.relationId);
    } else {
      get().confirmAiField(change.symbolId, change.field);
    }

    // Update validate state
    const nextChanges = [...validateState.changes];
    nextChanges[idx] = { ...change, status: "confirmed" };
    set({ validateState: { ...validateState, changes: nextChanges } });

    // Auto-advance
    setTimeout(() => get().validateNext(), 150);
  },

  validateReject: (changeId, comment) => {
    const { validateState } = get();
    if (!validateState.active) return;
    const idx = validateState.changes.findIndex((c) => c.id === changeId);
    if (idx < 0) return;
    const change = validateState.changes[idx];

    if (comment?.trim()) {
      console.debug(`[Validate] Reject comment for ${changeId}: ${comment.trim()}`);
    }

    // Reject in the graph
    if (change.field === "relation" && change.relationId) {
      // Remove the relation
      const { graph } = get();
      if (graph) {
        const updated = {
          ...graph,
          relations: graph.relations.filter((r) => r.id !== change.relationId),
          views: graph.views.map((v) => ({
            ...v,
            edgeRefs: v.edgeRefs.filter((e) => e !== change.relationId),
          })),
        };
        set((state) => ({
          graph: updated,
          ...historyPatchWithCurrentSnapshot(state),
        }));
        get().syncGraphToServer();
      }
    } else {
      get().rejectAiField(change.symbolId, change.field);
    }

    // Update validate state
    const nextChanges = [...validateState.changes];
    nextChanges[idx] = { ...change, status: "rejected" };
    set({ validateState: { ...validateState, changes: nextChanges } });

    // Auto-advance
    setTimeout(() => get().validateNext(), 150);
  },

  validateConfirmAll: () => {
    const { validateState } = get();
    if (!validateState.active) return;
    const nextChanges = validateState.changes.map((c) => {
      if (c.status !== "pending") return c;
      if (c.field === "relation" && c.relationId) {
        get().confirmAiRelation(c.relationId);
      } else {
        get().confirmAiField(c.symbolId, c.field);
      }
      return { ...c, status: "confirmed" as const };
    });
    set({ validateState: { ...validateState, changes: nextChanges } });
  },

  setGraph: (g) => {
    const normalized = normalizeGraphForFrontend(g);
    const initialViewId = resolveNavigableViewId(normalized, normalized.rootViewId, normalized.rootViewId) ?? normalized.rootViewId;
    set({
      graph: normalized,
      currentViewId: initialViewId,
      selectedSymbolId: null,
      selectedEdgeId: null,
      breadcrumb: [initialViewId],
      viewUiSnapshots: {},
      reviewHighlight: {
        activeItemId: null,
        nodeIds: [],
        primaryNodeId: null,
        viewId: initialViewId,
        fitView: false,
        seq: 0,
        previewNodeIds: [],
      },
      graphHistoryPast: [],
      graphHistoryFuture: [],
      historyCanUndo: false,
      historyCanRedo: false,
      viewRestoreViewId: null,
      viewRestoreSeq: 0,
    });
  },

  updateGraph: (g) => {
    const normalized = normalizeGraphForFrontend(g);
    const { graph, aiAnalysis, currentViewId, breadcrumb, selectedSymbolId, selectedEdgeId, viewUiSnapshots } = get();
    const localUpdateFresh =
      !!aiAnalysis?.running &&
      _lastDataUpdateTime > 0 &&
      (Date.now() - _lastDataUpdateTime) < 4000;

    if (localUpdateFresh && graph) {
      // Ignore potentially stale server snapshots shortly after local AI live updates.
      return;
    }

    // Keep current view if it still exists, otherwise fall back to root
    const fallbackViewId =
      resolveNavigableViewId(normalized, currentViewId, normalized.rootViewId) ?? normalized.rootViewId;
    const viewStillExists = normalized.views.some((v) => v.id === currentViewId);
    set({
      graph: normalized,
      currentViewId: viewStillExists ? currentViewId : fallbackViewId,
      breadcrumb: viewStillExists ? breadcrumb : [fallbackViewId],
      selectedSymbolId: normalized.symbols.some((s) => s.id === selectedSymbolId) ? selectedSymbolId : null,
      selectedEdgeId: normalized.relations.some((r) => r.id === selectedEdgeId) ? selectedEdgeId : null,
      viewUiSnapshots: pruneViewUiSnapshots(normalized, viewUiSnapshots),
      reviewHighlight: {
        ...get().reviewHighlight,
        nodeIds: get().reviewHighlight.nodeIds.filter((id) => normalized.symbols.some((symbol) => symbol.id === id)),
        primaryNodeId: get().reviewHighlight.primaryNodeId && normalized.symbols.some((symbol) => symbol.id === get().reviewHighlight.primaryNodeId)
          ? get().reviewHighlight.primaryNodeId
          : null,
        viewId: viewStillExists ? get().reviewHighlight.viewId : fallbackViewId,
        previewNodeIds: get().reviewHighlight.previewNodeIds.filter((id) => normalized.symbols.some((symbol) => symbol.id === id)),
      },
      graphHistoryPast: [],
      graphHistoryFuture: [],
      historyCanUndo: false,
      historyCanRedo: false,
      viewRestoreViewId: null,
      viewRestoreSeq: 0,
    });
  },

  undoGraphChange: () => {
    const state = get();
    if (state.graphHistoryPast.length === 0) return;
    const currentSnapshot = buildGraphHistorySnapshot(state);
    if (!currentSnapshot) return;

    const previousSnapshot = state.graphHistoryPast[state.graphHistoryPast.length - 1];
    const past = state.graphHistoryPast.slice(0, -1);
    const future = [...state.graphHistoryFuture, currentSnapshot];
    if (future.length > MAX_GRAPH_HISTORY) future.shift();

    set({
      graph: cloneProjectGraph(previousSnapshot.graph),
      currentViewId: previousSnapshot.currentViewId,
      selectedSymbolId: previousSnapshot.selectedSymbolId,
      selectedEdgeId: previousSnapshot.selectedEdgeId,
      breadcrumb: [...previousSnapshot.breadcrumb],
      graphHistoryPast: past,
      graphHistoryFuture: future,
      historyCanUndo: past.length > 0,
      historyCanRedo: future.length > 0,
    });
    void get().syncGraphToServer();
  },

  redoGraphChange: () => {
    const state = get();
    if (state.graphHistoryFuture.length === 0) return;
    const currentSnapshot = buildGraphHistorySnapshot(state);
    if (!currentSnapshot) return;

    const nextSnapshot = state.graphHistoryFuture[state.graphHistoryFuture.length - 1];
    const future = state.graphHistoryFuture.slice(0, -1);
    const past = [...state.graphHistoryPast, currentSnapshot];
    if (past.length > MAX_GRAPH_HISTORY) past.shift();

    set({
      graph: cloneProjectGraph(nextSnapshot.graph),
      currentViewId: nextSnapshot.currentViewId,
      selectedSymbolId: nextSnapshot.selectedSymbolId,
      selectedEdgeId: nextSnapshot.selectedEdgeId,
      breadcrumb: [...nextSnapshot.breadcrumb],
      graphHistoryPast: past,
      graphHistoryFuture: future,
      historyCanUndo: past.length > 0,
      historyCanRedo: future.length > 0,
    });
    void get().syncGraphToServer();
  },

  navigateToView: (viewId, options = {}) => {
    const state = get();
    const { breadcrumb, graph, currentViewId, viewFitSeq, viewRestoreSeq } = state;
    const shouldRestore = options.restoreViewState === true;
    const targetViewId = graph
      ? resolveNavigableViewId(graph, viewId, currentViewId) ?? viewId
      : viewId;
    const snapshot = shouldRestore ? getRestorableViewSnapshot(state, targetViewId) : null;
    const hasViewportRestore = !!snapshot?.viewport;
    if (currentViewId === targetViewId) {
      set({
        currentViewId: targetViewId,
        breadcrumb: snapshot?.breadcrumb ?? breadcrumb,
        selectedSymbolId: snapshot?.selectedSymbolId ?? null,
        selectedEdgeId: snapshot?.selectedEdgeId ?? null,
        focusNodeId: null,
        inspectorCollapsed: snapshot?.inspectorCollapsed ?? state.inspectorCollapsed,
        viewFitViewId: hasViewportRestore ? null : targetViewId,
        viewFitSeq: hasViewportRestore ? viewFitSeq : viewFitSeq + 1,
        viewRestoreViewId: hasViewportRestore ? targetViewId : null,
        viewRestoreSeq: hasViewportRestore ? viewRestoreSeq + 1 : viewRestoreSeq,
      });
      return;
    }

    const idx = breadcrumb.indexOf(targetViewId);
    if (idx >= 0) {
      set({
        currentViewId: targetViewId,
        breadcrumb: snapshot?.breadcrumb ?? breadcrumb.slice(0, idx + 1),
        selectedSymbolId: snapshot?.selectedSymbolId ?? null,
        selectedEdgeId: snapshot?.selectedEdgeId ?? null,
        focusNodeId: null,
        inspectorCollapsed: snapshot?.inspectorCollapsed ?? state.inspectorCollapsed,
        viewFitViewId: hasViewportRestore ? null : targetViewId,
        viewFitSeq: hasViewportRestore ? viewFitSeq : viewFitSeq + 1,
        viewRestoreViewId: hasViewportRestore ? targetViewId : null,
        viewRestoreSeq: hasViewportRestore ? viewRestoreSeq + 1 : viewRestoreSeq,
      });
    } else if (graph) {
      const path = buildViewPath(graph, targetViewId);
      set({
        currentViewId: targetViewId,
        breadcrumb: snapshot?.breadcrumb ?? path,
        selectedSymbolId: snapshot?.selectedSymbolId ?? null,
        selectedEdgeId: snapshot?.selectedEdgeId ?? null,
        focusNodeId: null,
        inspectorCollapsed: snapshot?.inspectorCollapsed ?? state.inspectorCollapsed,
        viewFitViewId: hasViewportRestore ? null : targetViewId,
        viewFitSeq: hasViewportRestore ? viewFitSeq : viewFitSeq + 1,
        viewRestoreViewId: hasViewportRestore ? targetViewId : null,
        viewRestoreSeq: hasViewportRestore ? viewRestoreSeq + 1 : viewRestoreSeq,
      });
    } else {
      set({
        currentViewId: targetViewId,
        breadcrumb: snapshot?.breadcrumb ?? [...breadcrumb, targetViewId],
        selectedSymbolId: snapshot?.selectedSymbolId ?? null,
        selectedEdgeId: snapshot?.selectedEdgeId ?? null,
        focusNodeId: null,
        inspectorCollapsed: snapshot?.inspectorCollapsed ?? state.inspectorCollapsed,
        viewFitViewId: hasViewportRestore ? null : targetViewId,
        viewFitSeq: hasViewportRestore ? viewFitSeq : viewFitSeq + 1,
        viewRestoreViewId: hasViewportRestore ? targetViewId : null,
        viewRestoreSeq: hasViewportRestore ? viewRestoreSeq + 1 : viewRestoreSeq,
      });
    }
  },

  goBack: () => {
    const { breadcrumb } = get();
    if (breadcrumb.length > 1) {
      const newBc = breadcrumb.slice(0, -1);
      get().navigateToView(newBc[newBc.length - 1], { restoreViewState: true });
    }
  },

  focusSymbolInContext: (symbolId, preferredViewId) => {
    const { graph, currentViewId, breadcrumb } = get();
    if (!graph) return;

    const targetViewId = bestNavigableViewForSymbol(graph, symbolId, {
      preferredViewId,
      currentViewId,
    });

    const nextViewId = targetViewId ?? currentViewId ?? graph.rootViewId;
    const nextBreadcrumb = targetViewId ? buildViewPath(graph, targetViewId) : breadcrumb;
    const nextFocusSeq = (get().focusSeq ?? 0) + 1;
    const nextViewFitSeq = targetViewId ? (get().viewFitSeq ?? 0) + 1 : get().viewFitSeq;

    set({
      currentViewId: nextViewId,
      breadcrumb: nextBreadcrumb,
      selectedSymbolId: symbolId,
      selectedEdgeId: null,
      focusNodeId: symbolId,
      focusSeq: nextFocusSeq,
      inspectorCollapsed: false,
      viewFitViewId: targetViewId ?? get().viewFitViewId,
      viewFitSeq: nextViewFitSeq,
      viewRestoreViewId: null,
      viewUiSnapshots: {
        ...get().viewUiSnapshots,
        [nextViewId]: buildViewUiSnapshot(get(), nextViewId, {
          breadcrumb: nextBreadcrumb,
          selectedSymbolId: symbolId,
          selectedEdgeId: null,
          inspectorCollapsed: false,
        }),
      },
    });
  },

  selectSymbol: (id) => set((state) => ({
    selectedSymbolId: id,
    selectedEdgeId: null,
    viewUiSnapshots: withSavedCurrentViewSnapshot(state, {
      selectedSymbolId: id,
      selectedEdgeId: null,
    }),
  })),
  selectEdge: (id) => set((state) => ({
    selectedEdgeId: id,
    selectedSymbolId: null,
    viewUiSnapshots: withSavedCurrentViewSnapshot(state, {
      selectedEdgeId: id,
      selectedSymbolId: null,
    }),
  })),

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

  updateView: (id, patch) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      views: graph.views.map((view) => (view.id === id ? { ...view, ...patch } : view)),
    };
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
    get().syncGraphToServer();
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
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      selectedSymbolId: null,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
    get().syncGraphToServer();
  },

  updateRelation: (id, patch) => {
    const { graph } = get();
    if (!graph) return;
    const updated = {
      ...graph,
      relations: graph.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    };
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      selectedEdgeId: null,
      ...historyPatchWithCurrentSnapshot(state),
    }));
    get().syncGraphToServer();
  },

  saveNodePositions: (positions) => {
    const { graph, currentViewId, diagramSettings } = get();
    if (!graph || !currentViewId) return;
    const persistManualLayout = !diagramSettings.autoLayout && !isManagedProcessLayoutViewId(currentViewId);
    const updated = {
      ...graph,
      views: graph.views.map((v) => {
        if (v.id !== currentViewId) return v;
        // Merge new positions with any existing ones
        const existing = new Map((v.nodePositions ?? []).map((p) => [p.symbolId, p]));
        for (const p of positions) {
          existing.set(p.symbolId, p);
        }
        return {
          ...v,
          manualLayout: persistManualLayout ? true : undefined,
          nodePositions: Array.from(existing.values()),
        };
      }),
    };
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
    set((state) => ({
      graph: updated,
      ...historyPatchWithCurrentSnapshot(state),
    }));
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
