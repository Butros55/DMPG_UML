import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { collectNavigableSymbolIds, useAppStore } from "../store";
import {
  scanProject,
  browseFolders,
  fetchConfig,
  fetchProjects,
  switchProject as switchProjectApi,
  deleteProjectApi,
  pickProjectFolder,
  openProjectFolder,
  replaceGraph,
  scanProjectStream,
} from "../api";
import type { ProjectMeta } from "../api";
import type { DiagramView, Symbol as Sym } from "@dmpg/shared";
import { AiWorkspacePanel } from "./AiWorkspacePanel";
import { exportProjectPackage, importProjectPackageFile } from "../projectTransfer";
import { formatViewTitle } from "../viewTitles";
import {
  collectInputSourceTreeSymbols,
  isInputSourcesViewId,
  type InputSourceTreeSymbol,
} from "../inputSources";

const NODE_KINDS = [
  { kind: "module", label: "Module", color: "#6c8cff" },
  { kind: "class", label: "Class", color: "#ffd866" },
  { kind: "function", label: "Function", color: "#80e0a0" },
  { kind: "method", label: "Method", color: "#ffab70" },
  { kind: "package", label: "Package", color: "#6c8cff" },
  { kind: "constant", label: "Constant", color: "#ff6b6b" },
  { kind: "script", label: "Script", color: "#ffab70" },
  { kind: "group", label: "Group", color: "#6c8cff" },
];

/** Short letter + color for each symbol kind */
const KIND_BADGE: Record<string, { letter: string; color: string }> = {
  module: { letter: "M", color: "#6c8cff" },
  class: { letter: "C", color: "#ffd866" },
  function: { letter: "F", color: "#80e0a0" },
  method: { letter: "M", color: "#ffab70" },
  package: { letter: "P", color: "#6c8cff" },
  constant: { letter: "K", color: "#ff6b6b" },
  script: { letter: "S", color: "#ffab70" },
  group: { letter: "G", color: "#6c8cff" },
  interface: { letter: "I", color: "#66d9ef" },
  variable: { letter: "V", color: "#c792ea" },
  external: { letter: "E", color: "#888" },
};

const SCOPE_ICONS: Record<string, string> = {
  root: "bi-globe2",
  group: "bi-box",
  module: "bi-file-earmark-code",
  class: "bi-building",
};

type SidebarTab = "views" | "nodes" | "ai" | "project";
const SIDEBAR_TAB_STORAGE_KEY = "dmpg.sidebar.active-tab.v1";

type TreeSymbol = Sym | InputSourceTreeSymbol;

function treeSymbolKey(sym: TreeSymbol): string {
  return "treeKey" in sym ? sym.treeKey : sym.id;
}

function treeSymbolNavigationId(sym: TreeSymbol): string | null {
  return "navigationSymbolId" in sym ? sym.navigationSymbolId : sym.id;
}

/** Navigate to the deepest view containing a symbol and focus it */
function goToSymbol(symbolId: string, preferredViewId?: string | null) {
  const { graph, navigateToView, focusSymbolInContext } = useAppStore.getState();
  const symbol = graph?.symbols.find((entry) => entry.id === symbolId);
  if (symbol?.childViewId) {
    navigateToView(symbol.childViewId);
    return;
  }
  focusSymbolInContext(symbolId, preferredViewId);
}

/** Small inline kind badge */
function KindBadge({ kind }: { kind: string }) {
  const b = KIND_BADGE[kind] ?? { letter: kind[0]?.toUpperCase() ?? "?", color: "#888" };
  return (
    <span
      className="kind-badge"
      style={{ background: `${b.color}22`, color: b.color }}
      title={kind}
    >
      {b.letter}
    </span>
  );
}

function queryMatches(text: string | undefined, query: string): boolean {
  if (!query) return false;
  return (text ?? "").toLowerCase().includes(query);
}

function normalizeProjectPathValue(projectPath: string | null | undefined): string {
  const trimmed = projectPath?.trim() ?? "";
  if (!trimmed) return "";
  const normalized = trimmed.replace(/\//g, "\\");
  return navigator.platform.toLowerCase().includes("win")
    ? normalized.toLowerCase()
    : normalized;
}

function sameProjectPath(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeProjectPathValue(left);
  const normalizedRight = normalizeProjectPathValue(right);
  return normalizedLeft !== "" && normalizedLeft === normalizedRight;
}

function projectNameFromPath(projectPath: string): string {
  const segments = projectPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? projectPath;
}

function formatProjectTimestamp(value: string | undefined): string {
  if (!value) return "Noch nicht gescannt";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unbekannt";
  return parsed.toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatProjectSymbolCount(project: ProjectMeta | null | undefined): string {
  if (!project?.lastScanned) return "Noch kein gespeicherter Scan";
  return `${project.symbolCount} Symbole`;
}

function clearWorkspaceGraphState() {
  useAppStore.setState({
    graph: null,
    currentViewId: null,
    projectionMode: "overview",
    sequenceContext: null,
    selectedSymbolId: null,
    selectedEdgeId: null,
    breadcrumb: [],
    viewUiSnapshots: {},
    reviewHighlight: {
      activeItemId: null,
      nodeIds: [],
      primaryNodeId: null,
      viewId: null,
      fitView: false,
      seq: 0,
      previewNodeIds: [],
    },
    graphHistoryPast: [],
    graphHistoryFuture: [],
    historyCanUndo: false,
    historyCanRedo: false,
    focusNodeId: null,
    aiAnalysis: null,
    validateState: { active: false, changes: [], currentIndex: -1, baselineRunId: null },
  });
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(query);
  if (idx < 0) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <mark className="view-tree-highlight">{match}</mark>
      {after}
    </>
  );
}

/* ─── Global Symbol Search ─── */
function SymbolSearch({
  symbols,
  query,
  onQueryChange,
}: {
  symbols: Sym[];
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return symbols
      .filter((s) => {
        const label = s.label.toLowerCase();
        // Search label, kind, and doc.summary
        return label.includes(q) || s.kind.includes(q) || (s.doc?.summary ?? "").toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [query, symbols]);

  const showDropdown = focused && query.trim().length >= 2;

  return (
    <div className="symbol-search">
      <div className="symbol-search__input-wrap">
        <span className="symbol-search__icon"><i className="bi bi-search" /></span>
        <input
          ref={inputRef}
          className="symbol-search__input"
          type="text"
          placeholder="Suche nach Symbolen…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onQueryChange("");
              inputRef.current?.blur();
            }
          }}
        />
        {query && (
          <button className="symbol-search__clear" onClick={() => onQueryChange("")}><i className="bi bi-x-lg" /></button>
        )}
      </div>
      {showDropdown && (
        <div className="symbol-search__dropdown">
          {results.length === 0 ? (
            <div className="symbol-search__empty">Keine Ergebnisse</div>
          ) : (
            results.map((sym) => (
              <div
                key={sym.id}
                className="symbol-search__result"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur before click
                  goToSymbol(sym.id);
                  onQueryChange("");
                }}
              >
                <KindBadge kind={sym.kind} />
                <span className="symbol-search__result-label">{sym.label}</span>
                <span className="symbol-search__result-kind">{sym.kind}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─── View Tree Item (recursive) — shows child symbols too ─── */
function ViewTreeItem({
  view,
  childMap,
  symbolsByView,
  currentViewId,
  navigateToView,
  collapsed,
  toggleCollapse,
  deadSymbolIds,
  level,
  searchQuery,
  searchActive,
  visibleViewIds,
  matchedViewIds,
  matchedSymbolIds,
}: {
  view: DiagramView;
  childMap: Map<string, DiagramView[]>;
  symbolsByView: Map<string, TreeSymbol[]>;
  currentViewId: string | null;
  navigateToView: (id: string) => void;
  collapsed: Record<string, boolean>;
  toggleCollapse: (id: string) => void;
  deadSymbolIds: Set<string>;
  level: number;
  searchQuery: string;
  searchActive: boolean;
  visibleViewIds: Set<string> | null;
  matchedViewIds: Set<string>;
  matchedSymbolIds: Set<string>;
}) {
  if (searchActive && visibleViewIds && !visibleViewIds.has(view.id)) return null;

  const rawChildViews = childMap.get(view.id) ?? [];
  const childViews = searchActive && visibleViewIds
    ? rawChildViews.filter((child) => visibleViewIds.has(child.id))
    : rawChildViews;
  const viewSymbols = symbolsByView.get(view.id) ?? [];
  const hasChildren = childViews.length > 0 || viewSymbols.length > 0;
  const isCollapsed = searchActive ? false : (collapsed[view.id] ?? (level > 1));
  const isInputSourcesCollection = isInputSourcesViewId(view.id);
  const isActive = !isInputSourcesCollection && view.id === currentViewId;
  const isSearchMatch = searchActive && matchedViewIds.has(view.id);
  const scope = (view as any).scope as string | undefined;
  const icon = isInputSourcesCollection
    ? "bi-inboxes"
    : SCOPE_ICONS[scope ?? ""] ?? "bi-folder";

  // Check if this view contains dead-code nodes
  const hasDeadCode = view.nodeRefs.some((id) => deadSymbolIds.has(id));

  return (
    <>
      <div
        className={`view-tree-item ${isActive ? "view-tree-item--active" : ""} ${hasDeadCode ? "view-tree-item--has-dead" : ""}${isSearchMatch ? " view-tree-item--search-match" : ""}${isInputSourcesCollection ? " view-tree-item--collection" : ""}`}
        style={{ paddingLeft: 8 + level * 16 }}
        onClick={() => {
          if (isInputSourcesCollection) {
            if (hasChildren) toggleCollapse(view.id);
            return;
          }
          navigateToView(view.id);
        }}
      >
        {hasChildren ? (
          <span
            className={`view-tree-chevron ${isCollapsed ? "" : "view-tree-chevron--open"}`}
            onClick={(e) => { e.stopPropagation(); toggleCollapse(view.id); }}
          >
            <i className="bi bi-chevron-right" />
          </span>
        ) : (
          <span className="view-tree-chevron view-tree-chevron--leaf" />
        )}
        <span className="view-tree-icon"><i className={`bi ${icon}`} /></span>
        <span className="view-tree-label">
          <HighlightText text={formatViewTitle(view.title, view.id)} query={searchQuery} />
        </span>
        {isInputSourcesCollection && (
          <span className="view-tree-collection-badge">Quellen</span>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <>
          {/* Child views first */}
          {childViews.map((child) => (
            <ViewTreeItem
              key={child.id}
              view={child}
              childMap={childMap}
              symbolsByView={symbolsByView}
              currentViewId={currentViewId}
              navigateToView={navigateToView}
              collapsed={collapsed}
              toggleCollapse={toggleCollapse}
              deadSymbolIds={deadSymbolIds}
              level={level + 1}
              searchQuery={searchQuery}
              searchActive={searchActive}
              visibleViewIds={visibleViewIds}
              matchedViewIds={matchedViewIds}
              matchedSymbolIds={matchedSymbolIds}
            />
          ))}
          {/* Then symbols belonging to this view that are NOT sub-views */}
          {viewSymbols.map((sym) => {
            const navigationSymbolId = treeSymbolNavigationId(sym);
            const isDeadSymbol = navigationSymbolId ? deadSymbolIds.has(navigationSymbolId) : false;
            const displayLabel = isInputSourcesCollection
              ? sym.label
              : sym.label.split(".").pop() ?? sym.label;
            return (
              <div
                key={treeSymbolKey(sym)}
                className={`view-tree-item view-tree-symbol ${isDeadSymbol ? "view-tree-symbol--dead" : ""}${searchActive && matchedSymbolIds.has(treeSymbolKey(sym)) ? " view-tree-item--search-match" : ""}`}
                style={{ paddingLeft: 8 + (level + 1) * 16 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!navigationSymbolId) return;
                  if (isInputSourcesCollection) {
                    useAppStore.getState().selectSymbol(navigationSymbolId);
                    return;
                  }
                  goToSymbol(navigationSymbolId, view.id);
                }}
              >
                <span className="view-tree-chevron view-tree-chevron--leaf" />
                <KindBadge kind={sym.kind} />
                <span className="view-tree-label">
                  <HighlightText text={displayLabel} query={searchQuery} />
                </span>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

/* ─── Folder Browser Modal ─── */
function FolderBrowser({ onSelect, onClose }: { onSelect: (path: string) => void; onClose: () => void }) {
  const [currentDir, setCurrentDir] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [folders, setFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDir = useCallback(async (dirPath?: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await browseFolders(dirPath);
      setCurrentDir(result.current);
      setParentDir(result.parent);
      setFolders(result.folders);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDir();
  }, [loadDir]);

  return (
    <div className="folder-browser-overlay" onClick={onClose}>
      <div className="folder-browser" onClick={(e) => e.stopPropagation()}>
        <div className="folder-browser-header">
          <h3>Projektordner waehlen</h3>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 16, color: "var(--text-dim)" }}><i className="bi bi-x-lg" /></button>
        </div>

        <div className="folder-browser-path">
          <input
            className="inspector-input"
            value={currentDir}
            onChange={(e) => setCurrentDir(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadDir(currentDir)}
            style={{ fontSize: 11 }}
          />
        </div>

        <div className="folder-browser-list">
          {loading && <div style={{ padding: 12, color: "var(--text-dim)" }}>Laedt…</div>}
          {error && <div style={{ padding: 12, color: "var(--red)", fontSize: 11 }}>{error}</div>}

          {parentDir && (
            <div className="folder-item" onClick={() => loadDir(parentDir)}>
              <span><i className="bi bi-folder" /></span> <span style={{ color: "var(--text-dim)" }}>..</span>
            </div>
          )}

          {folders.map((f) => (
            <div key={f.path} className="folder-item" onClick={() => loadDir(f.path)}>
              <span><i className="bi bi-folder" /></span> <span>{f.name}</span>
            </div>
          ))}

          {!loading && folders.length === 0 && !error && (
            <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 11 }}>Keine Unterordner</div>
          )}
        </div>

        <div className="folder-browser-actions">
          <button className="btn btn-sm" onClick={onClose}>Abbrechen</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => { onSelect(currentDir); onClose(); }}
            disabled={!currentDir.trim()}
          >
            Auswaehlen "{currentDir.split(/[\\/]/).pop()}"
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const graph = useAppStore((s) => s.graph);
  const setGraph = useAppStore((s) => s.setGraph);
  const updateGraph = useAppStore((s) => s.updateGraph);
  const clearGraphForScan = useAppStore((s) => s.clearGraphForScan);
  const updateScanStatus = useAppStore((s) => s.updateScanStatus);
  const scanStatus = useAppStore((s) => s.scanStatus);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const exitValidateMode = useAppStore((s) => s.exitValidateMode);
  const resetPlaybackQueue = useAppStore((s) => s.resetPlaybackQueue);

  const [scanPath, setScanPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [configuredProjectPath, setConfiguredProjectPath] = useState("");
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Collapsible sidebar sections
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({});
  const toggleSection = useCallback((key: string) => {
    setSectionCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const [aiProvider, setAiProvider] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const projectLoadRunRef = useRef(0);
  const [viewSearchQuery, setViewSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SidebarTab>("views");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_TAB_STORAGE_KEY);
      if (raw === "views" || raw === "nodes" || raw === "ai" || raw === "project") {
        setActiveTab(raw);
      } else if (raw === "review") {
        setActiveTab("ai");
      }
    } catch {
      // ignore invalid persisted tab state
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore storage write errors
    }
  }, [activeTab]);

  const activateTab = useCallback((tab: SidebarTab) => {
    setActiveTab(tab);
    setSidebarCollapsed(false);
  }, [setSidebarCollapsed]);

  const refreshProjects = useCallback(async () => {
    const { projects: nextProjects, activeProject } = await fetchProjects();
    setProjects(nextProjects);
    setActiveProjectPath(activeProject);
    return activeProject;
  }, []);

  const activeProjectMeta = useMemo(
    () => projects.find((project) => sameProjectPath(project.projectPath, activeProjectPath)) ?? null,
    [activeProjectPath, projects],
  );
  const currentProjectPath = activeProjectMeta?.projectPath
    || activeProjectPath
    || configuredProjectPath
    || scanPath;
  const currentProjectName = currentProjectPath
    ? activeProjectMeta?.name ?? projectNameFromPath(currentProjectPath)
    : "";
  const libraryProjects = useMemo(() => {
    const sortedProjects = [...projects].sort((left, right) => {
      const leftIsDefault = sameProjectPath(left.projectPath, configuredProjectPath);
      const rightIsDefault = sameProjectPath(right.projectPath, configuredProjectPath);
      if (leftIsDefault !== rightIsDefault) return leftIsDefault ? -1 : 1;

      const leftTime = new Date(left.lastScanned).getTime();
      const rightTime = new Date(right.lastScanned).getTime();
      return rightTime - leftTime;
    });

    if (!activeProjectMeta) return sortedProjects;
    return sortedProjects.filter((project) => !sameProjectPath(project.projectPath, activeProjectMeta.projectPath));
  }, [activeProjectMeta, configuredProjectPath, projects]);

  const cancelActiveProjectScan = useCallback((message = "Scan abgebrochen") => {
    projectLoadRunRef.current += 1;
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    setScanning(false);
    updateScanStatus({
      running: false,
      phase: "cancelled",
      message,
      current: undefined,
      total: undefined,
    });
  }, [updateScanStatus]);

  const handleActivityTabClick = useCallback((tab: SidebarTab) => {
    if (!sidebarCollapsed && activeTab === tab) {
      setSidebarCollapsed(true);
      return;
    }
    setActiveTab(tab);
    setSidebarCollapsed(false);
  }, [activeTab, sidebarCollapsed, setSidebarCollapsed]);

  const loadProjectWorkspace = useCallback(async (
    projectPath: string,
    options?: { forceRescan?: boolean; scanIfMissing?: boolean },
  ) => {
    const targetPath = projectPath.trim();
    if (!targetPath) return null;

    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    const runId = ++projectLoadRunRef.current;
    const isCurrentRun = () => projectLoadRunRef.current === runId;

    setScanning(true);
    setScanError("");
    setScanPath(targetPath);
    setActiveProjectPath(targetPath);
    updateScanStatus({
      running: true,
      phase: options?.forceRescan ? "start" : "loading",
      message: options?.forceRescan ? "Rescan wird vorbereitet" : "Projekt wird geladen",
      projectPath: targetPath,
      current: undefined,
      total: undefined,
      warnings: [],
    });
    try {
      exitValidateMode();
      resetPlaybackQueue();

      let graphResult = null as Awaited<ReturnType<typeof scanProject>> | null;
      if (options?.forceRescan) {
        await switchProjectApi(targetPath);
        if (!isCurrentRun()) return null;
        await refreshProjects();
        if (!isCurrentRun()) return null;
      } else {
        const { graph } = await switchProjectApi(targetPath);
        if (!isCurrentRun()) return null;
        graphResult = graph;
      }
      if (!graphResult && !options?.forceRescan && !options?.scanIfMissing) {
        clearWorkspaceGraphState();
        setScanPath(targetPath);
        const refreshedActiveProject = await refreshProjects();
        if (!isCurrentRun()) return null;
        setActiveProjectPath(refreshedActiveProject ?? targetPath);
        updateScanStatus({
          running: false,
          phase: "idle",
          message: "Kein gespeicherter Scan fuer dieses Projekt",
          projectPath: targetPath,
          current: undefined,
          total: undefined,
          warnings: [],
        });
        return null;
      }
      if (!graphResult) {
        let appliedGraphFromStream = false;
        clearGraphForScan(targetPath);
        updateScanStatus({
          running: true,
          phase: "start",
          message: "Scanner startet",
          projectPath: targetPath,
          current: undefined,
          total: undefined,
          warnings: [],
        });
        const scanController = new AbortController();
        scanAbortRef.current = scanController;
        graphResult = await scanProjectStream(targetPath, (event) => {
          if (!isCurrentRun() || scanController.signal.aborted) return;
          const eventWarnings = (event.warnings ?? []).map((warning) => warning.trim()).filter(Boolean);
          const previousWarnings = useAppStore.getState().scanStatus.warnings ?? [];
          const warnings = eventWarnings.length > 0
            ? [...new Set([...previousWarnings, ...eventWarnings])]
            : previousWarnings;
          updateScanStatus({
            running: event.phase !== "done" && event.phase !== "error" && event.phase !== "cancelled",
            phase: event.phase,
            message: event.message ?? null,
            projectPath: event.projectPath ?? targetPath,
            current: event.current,
            total: event.total,
            warnings,
          });
          if (!event.graph || event.phase === "error" || event.phase === "cancelled") return;
          const shouldApplyGraph =
            event.phase === "graph" ||
            event.phase === "done" ||
            !useAppStore.getState().graph ||
            (event.phase === "class-synthesis" && (event.relationsAdded ?? 0) > 0);
          if (!shouldApplyGraph) return;
          if (appliedGraphFromStream || useAppStore.getState().graph) {
            updateGraph(event.graph);
          } else {
            setGraph(event.graph);
          }
          appliedGraphFromStream = true;
        }, { signal: scanController.signal });
        if (scanAbortRef.current === scanController) {
          scanAbortRef.current = null;
        }
        if (!isCurrentRun()) return null;
        if (appliedGraphFromStream) {
          updateGraph(graphResult);
        } else {
          setGraph(graphResult);
        }
      } else {
        if (!isCurrentRun()) return null;
        setGraph(graphResult);
      }

      if (!graphResult || !isCurrentRun()) return null;
      const effectiveProjectPath = graphResult.sourceProjectPath ?? graphResult.projectPath ?? targetPath;
      setScanPath(effectiveProjectPath);
      const refreshedActiveProject = await refreshProjects();
      if (!isCurrentRun()) return null;
      setActiveProjectPath(refreshedActiveProject ?? effectiveProjectPath);
      updateScanStatus({
        running: false,
        phase: "done",
        message: "Scan abgeschlossen",
        projectPath: effectiveProjectPath,
        current: undefined,
        total: undefined,
      });
      return graphResult;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        if (isCurrentRun()) {
          updateScanStatus({
            running: false,
            phase: "cancelled",
            message: "Scan abgebrochen",
            projectPath: targetPath,
            current: undefined,
            total: undefined,
          });
        }
        return null;
      }
      if (isCurrentRun()) {
        setScanError(err.message);
        updateScanStatus({
          running: false,
          phase: "error",
          message: err.message ?? "Scan fehlgeschlagen",
          projectPath: targetPath,
        });
      }
      return null;
    } finally {
      if (isCurrentRun()) {
        scanAbortRef.current = null;
        setScanning(false);
      }
    }
  }, [
    clearGraphForScan,
    exitValidateMode,
    refreshProjects,
    resetPlaybackQueue,
    setGraph,
    updateGraph,
    updateScanStatus,
  ]);

  // Load configured project path and open the preferred project on mount.
  useEffect(() => {
    let cancelled = false;

    const bootstrapProjectWorkspace = async () => {
      try {
        const cfg = await fetchConfig();
        if (cancelled) return;

        const configuredPath = cfg.scanProjectPath?.trim() ?? "";
        setConfiguredProjectPath(configuredPath);
        setAiProvider(cfg.aiProvider ?? "cloud");
        setOllamaModel(cfg.ollamaModel ?? "");

        const { projects: initialProjects, activeProject } = await fetchProjects();
        if (cancelled) return;

        setProjects(initialProjects);
        setActiveProjectPath(activeProject);

        const preferredProjectPath = activeProject || initialProjects[0]?.projectPath || "";
        if (!preferredProjectPath) {
          setScanPath(configuredPath);
          return;
        }

        setScanPath(preferredProjectPath);
        await loadProjectWorkspace(preferredProjectPath);
      } catch (err: any) {
        if (!cancelled) {
          setScanError(err.message ?? "Projektkonfiguration konnte nicht geladen werden");
        }
      }
    };

    void bootstrapProjectWorkspace();
    return () => {
      cancelled = true;
      scanAbortRef.current?.abort();
      scanAbortRef.current = null;
    };
  }, [loadProjectWorkspace]);

  const handleSwitchProject = useCallback(async (projectPath: string) => {
    await loadProjectWorkspace(projectPath);
  }, [loadProjectWorkspace]);

  const handleRescanProject = useCallback(async (projectPath?: string | null) => {
    const targetPath = projectPath?.trim() || currentProjectPath.trim();
    if (!targetPath) {
      setScanError("Kein Projekt ausgewählt");
      return;
    }
    await loadProjectWorkspace(targetPath, { forceRescan: true });
  }, [currentProjectPath, loadProjectWorkspace]);

  const handlePickProject = useCallback(async () => {
    try {
      const pickedProjectPath = await pickProjectFolder(currentProjectPath || configuredProjectPath || undefined);
      if (!pickedProjectPath) return;
      setShowBrowser(false);
      setScanError("");
      await loadProjectWorkspace(pickedProjectPath, { scanIfMissing: true });
    } catch (err: any) {
      setShowBrowser(false);
      setScanError(err.message ?? "Windows-Ordnerauswahl konnte nicht geoeffnet werden");
    }
  }, [configuredProjectPath, currentProjectPath, loadProjectWorkspace]);

  const handleOpenProjectFolderClick = useCallback(async (projectPath?: string | null) => {
    const targetPath = projectPath?.trim() || currentProjectPath.trim();
    if (!targetPath) {
      setScanError("Kein Projekt ausgewählt");
      return;
    }
    try {
      await openProjectFolder(targetPath);
      setScanError("");
    } catch (err: any) {
      setScanError(err.message ?? "Ordner konnte nicht geöffnet werden");
    }
  }, [currentProjectPath]);

  const handleImportProject = useCallback(async (file: File) => {
    setScanning(true);
    setScanError("");
    try {
      exitValidateMode();
      resetPlaybackQueue();
      const importedGraph = await importProjectPackageFile(file);
      const normalizedGraph = await replaceGraph(importedGraph);
      setGraph(normalizedGraph);
      setScanPath(normalizedGraph.sourceProjectPath ?? normalizedGraph.projectPath ?? "");
      await refreshProjects();
    } catch (err: any) {
      setScanError(err.message ?? "Import fehlgeschlagen");
    } finally {
      setScanning(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }, [exitValidateMode, refreshProjects, resetPlaybackQueue, setGraph]);

  const handleDeleteProject = useCallback(async (projectPath: string) => {
    cancelActiveProjectScan("Scan abgebrochen, Projekt wird entfernt");
    try {
      setScanError("");
      exitValidateMode();
      resetPlaybackQueue();
      const result = await deleteProjectApi(projectPath);
      // Re-sync from server response (single round-trip)
      setProjects(result.projects);
      setActiveProjectPath(result.activeProject);

      if (result.activeProject && result.graph) {
        // Another project became active — show its graph
        setGraph(result.graph);
        setScanPath(result.graph.sourceProjectPath ?? result.activeProject);
      } else {
        // No project left — clear everything
        clearWorkspaceGraphState();
        setScanPath((result.activeProject ?? configuredProjectPath) || "");
        setActiveProjectPath(result.activeProject ?? null);
      }
      updateScanStatus({
        running: false,
        phase: "idle",
        message: null,
        projectPath: result.activeProject ?? null,
        current: undefined,
        total: undefined,
        warnings: [],
      });
      setScanError("");
    } catch (err: any) {
      setScanError(err.message ?? "Projekt konnte nicht entfernt werden");
    }
  }, [
    cancelActiveProjectScan,
    configuredProjectPath,
    setGraph,
    exitValidateMode,
    resetPlaybackQueue,
    updateScanStatus,
  ]);

  useEffect(() => {
    const onSidebarCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; projectPath?: string }>).detail;
      const action = detail?.action;
      if (!action) return;

      switch (action) {
        case "scan":
          activateTab("project");
          void handleRescanProject();
          break;
        case "open-folder-browser":
          activateTab("project");
          void handlePickProject();
          break;
        case "import-project-package":
          activateTab("project");
          importInputRef.current?.click();
          break;
        case "switch-project":
          activateTab("project");
          if (detail.projectPath) void handleSwitchProject(detail.projectPath);
          break;
        case "delete-project":
          activateTab("project");
          if (detail.projectPath) void handleDeleteProject(detail.projectPath);
          break;
        case "delete-active-project":
          activateTab("project");
          if (activeProjectPath) void handleDeleteProject(activeProjectPath);
          break;
        case "ai-start":
        case "ai-resume":
        case "ai-pause":
        case "ai-stop":
          activateTab("ai");
          window.dispatchEvent(new CustomEvent("dmpg:ai-workspace-command", { detail }));
          break;
        default:
          break;
      }
    };

    window.addEventListener("dmpg:sidebar-command", onSidebarCommand as EventListener);
    return () => window.removeEventListener("dmpg:sidebar-command", onSidebarCommand as EventListener);
  }, [
    activeProjectPath,
    handleDeleteProject,
    handlePickProject,
    handleRescanProject,
    handleSwitchProject,
    activateTab,
  ]);

  const onDragStart = (e: React.DragEvent, kind: string) => {
    e.dataTransfer.setData("application/uml-kind", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  const toggleCollapse = useCallback((viewId: string) => {
    setCollapsed((prev) => ({ ...prev, [viewId]: !prev[viewId] }));
  }, []);

  /** Collapse all view tree nodes */
  const collapseAllViews = useCallback(() => {
    const all: Record<string, boolean> = {};
    for (const v of (graph?.views ?? [])) {
      all[v.id] = true;
    }
    setCollapsed(all);
  }, [graph]);

  // Build view tree structure
  const views = graph?.views ?? [];
  const showScanTreeLoading = scanStatus.running && !graph;
  const sidebarViews = useMemo(
    () => views.filter((view) => !view.hiddenInSidebar),
    [views],
  );
  const allSymbols = graph?.symbols ?? [];
  const inputSourceTreeSymbols = useMemo(
    () => graph ? collectInputSourceTreeSymbols(graph) : [],
    [graph],
  );
  const searchableSymbols = useMemo(() => {
    if (!graph) return [] as Sym[];
    const navigableIds = collectNavigableSymbolIds(graph);
    return graph.symbols.filter((symbol) => navigableIds.has(symbol.id));
  }, [graph]);
  const { rootViews, childMap } = useMemo(() => {
    const cMap = new Map<string, DiagramView[]>();
    const roots: DiagramView[] = [];
    for (const v of sidebarViews) {
      if (!v.parentViewId) {
        roots.push(v);
      } else {
        const siblings = cMap.get(v.parentViewId) ?? [];
        siblings.push(v);
        cMap.set(v.parentViewId, siblings);
      }
    }
    return { rootViews: roots, childMap: cMap };
  }, [sidebarViews]);

  // Build symbol list per view: only symbols that are direct children (not sub-view owners)
  const symbolsByView = useMemo(() => {
    const map = new Map<string, TreeSymbol[]>();
    // A symbol that owns any child view should not be rendered as a leaf item.
    const viewOwnerIds = new Set(
      allSymbols
        .filter((sym) => Boolean(sym.childViewId))
        .map((sym) => sym.id),
    );
    for (const v of sidebarViews) {
      if (isInputSourcesViewId(v.id)) {
        if (inputSourceTreeSymbols.length > 0) map.set(v.id, inputSourceTreeSymbols);
        continue;
      }

      const syms: TreeSymbol[] = [];
      for (const nid of v.nodeRefs) {
        if (viewOwnerIds.has(nid)) continue; // skip — shown as sub-view
        const sym = allSymbols.find((s) => s.id === nid);
        if (sym) syms.push(sym);
      }
      // Sort: classes/modules first, then functions, then methods, then rest
      const kindOrder: Record<string, number> = { class: 0, module: 1, function: 2, method: 3, constant: 4, script: 5 };
      syms.sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || a.label.localeCompare(b.label));
      if (syms.length > 0) map.set(v.id, syms);
    }
    return map;
  }, [sidebarViews, allSymbols, inputSourceTreeSymbols]);
  const normalizedViewSearch = viewSearchQuery.trim().toLowerCase();
  const viewSearchActive = normalizedViewSearch.length > 0;
  const {
    filteredRootViews,
    filteredSymbolsByView,
    visibleViewIds,
    matchedViewIds,
    matchedSymbolIds,
  } = useMemo(() => {
    if (!viewSearchActive) {
      return {
        filteredRootViews: rootViews,
        filteredSymbolsByView: symbolsByView,
        visibleViewIds: null as Set<string> | null,
        matchedViewIds: new Set<string>(),
        matchedSymbolIds: new Set<string>(),
      };
    }

    const isViewMatch = (view: DiagramView) =>
      queryMatches(view.title, normalizedViewSearch) ||
      queryMatches((view as any).scope as string | undefined, normalizedViewSearch);
    const isSymbolMatch = (sym: TreeSymbol) =>
      queryMatches(sym.label, normalizedViewSearch) ||
      queryMatches(sym.kind, normalizedViewSearch) ||
      queryMatches(sym.doc?.summary ?? "", normalizedViewSearch);

    const matchedViewIds = new Set<string>();
    const matchedSymbolIds = new Set<string>();
    for (const sym of allSymbols) {
      if (isSymbolMatch(sym)) matchedSymbolIds.add(sym.id);
    }

    const visibleViewIds = new Set<string>();
    const filteredSymbolsByView = new Map<string, TreeSymbol[]>();

    const visit = (view: DiagramView): boolean => {
      const selfMatch = isViewMatch(view);
      if (selfMatch) matchedViewIds.add(view.id);

      const children = childMap.get(view.id) ?? [];
      const childVisible = children.some((child) => visit(child));

      const viewSymbols = symbolsByView.get(view.id) ?? [];
      const visibleSymbols = viewSymbols.filter((sym) => {
        const match = matchedSymbolIds.has(sym.id) || isSymbolMatch(sym);
        if (match) matchedSymbolIds.add(treeSymbolKey(sym));
        return match;
      });
      if (visibleSymbols.length > 0) filteredSymbolsByView.set(view.id, visibleSymbols);

      const visible = selfMatch || childVisible || visibleSymbols.length > 0;
      if (visible) visibleViewIds.add(view.id);
      return visible;
    };

    const filteredRootViews = rootViews.filter((root) => visit(root));
    return {
      filteredRootViews,
      filteredSymbolsByView,
      visibleViewIds,
      matchedViewIds,
      matchedSymbolIds,
    };
  }, [
    viewSearchActive,
    rootViews,
    symbolsByView,
    allSymbols,
    childMap,
    normalizedViewSearch,
  ]);

  // Auto-expand sidebar tree to reveal the current view
  useEffect(() => {
    if (!currentViewId || views.length === 0) return;
    // Build viewId → parentViewId map
    const parentMap = new Map<string, string>();
    for (const v of views) {
      if (v.parentViewId) parentMap.set(v.id, v.parentViewId);
    }
    // Walk up from currentViewId and collect ancestor chain
    const toExpand: string[] = [];
    let cur = parentMap.get(currentViewId);
    while (cur) {
      toExpand.push(cur);
      cur = parentMap.get(cur);
    }
    if (toExpand.length === 0) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const id of toExpand) next[id] = false;
      return next;
    });
  }, [currentViewId, views]);

  // Collect dead-code symbol IDs for visual indicators
  const deadSymbolIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sym of graph?.symbols ?? []) {
      if (sym.tags?.includes("dead-code")) ids.add(sym.id);
    }
    return ids;
  }, [graph]);

  const handleViewTreeClick = useCallback((viewId: string) => {
    navigateToView(viewId);
  }, [navigateToView]);
  const scanWarnings = scanStatus.warnings ?? [];
  const showActiveProjectScanStatus =
    !!currentProjectPath &&
    !!scanStatus.projectPath &&
    sameProjectPath(currentProjectPath, scanStatus.projectPath) &&
    (scanStatus.running || scanWarnings.length > 0);

  return (
    <div className={`sidebar sidebar--vscode${sidebarCollapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar-activity" role="tablist" aria-label="Sidebar Tabs">
        <button
          className={`sidebar-activity-btn${activeTab === "views" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("views")}
          title="Ansichten"
          role="tab"
          aria-selected={activeTab === "views"}
        >
          <i className="bi bi-diagram-3" />
        </button>
        <button
          className={`sidebar-activity-btn${activeTab === "nodes" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("nodes")}
          title="UML-Knoten"
          role="tab"
          aria-selected={activeTab === "nodes"}
        >
          <i className="bi bi-boxes" />
        </button>
        <button
          className={`sidebar-activity-btn${activeTab === "ai" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("ai")}
          title="KI-Workspace"
          role="tab"
          aria-selected={activeTab === "ai"}
        >
          <i className="bi bi-cpu" />
        </button>
        <button
          className={`sidebar-activity-btn${activeTab === "project" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("project")}
          title="Projekte / Scan"
          role="tab"
          aria-selected={activeTab === "project"}
        >
          <i className="bi bi-folder2-open" />
        </button>
      </div>

      <div className="sidebar-content">
      {/* ── Global Symbol Search ── */}
      {activeTab === "views" && searchableSymbols.length > 0 && (
        <div className="sidebar-section sidebar-section--search">
          <SymbolSearch
            symbols={searchableSymbols}
            query={viewSearchQuery}
            onQueryChange={setViewSearchQuery}
          />
        </div>
      )}

      {activeTab === "nodes" && (
      <div className="sidebar-section">
        <h2 className="sidebar-section__header" onClick={() => toggleSection("umlNodes")}>
          <span className={`sidebar-section__chevron ${sectionCollapsed.umlNodes ? "" : "sidebar-section__chevron--open"}`}><i className="bi bi-chevron-right" /></span>
          UML-Knoten
        </h2>
        {!sectionCollapsed.umlNodes && NODE_KINDS.map((nk) => (
          <div
            key={nk.kind}
            className="node-palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, nk.kind)}
          >
            <div className="icon" style={{ background: `${nk.color}22`, color: nk.color }}>
              {nk.label[0]}
            </div>
            <span>{nk.label}</span>
          </div>
        ))}
      </div>
      )}

      {/* ── Collapsible View Tree ── */}
      {activeTab === "views" && (
      <div className="sidebar-section">
        <h2 className="sidebar-section__header" onClick={() => toggleSection("views")}>
          <span className={`sidebar-section__chevron ${sectionCollapsed.views ? "" : "sidebar-section__chevron--open"}`}><i className="bi bi-chevron-right" /></span>
          Ansichten
          <button
            className="sidebar-section__action"
            onClick={(e) => { e.stopPropagation(); collapseAllViews(); }}
            title="Alle Ansichten einklappen"
          >
            <i className="bi bi-dash-square" />
          </button>
        </h2>
        {!sectionCollapsed.views && (
          <div className="view-tree">
            {showScanTreeLoading ? (
              <div className="view-tree-scan-loading">
                <span className="ai-spinner" />
                <div>
                  <div className="view-tree-scan-loading__title">Scan baut Ansichten neu auf</div>
                  <div className="view-tree-scan-loading__meta">
                    {scanStatus.total && scanStatus.current
                      ? `${scanStatus.current}/${scanStatus.total} LLM-Batches`
                      : scanStatus.message ?? "Projekt wird analysiert"}
                  </div>
                </div>
              </div>
            ) : filteredRootViews.length === 0 ? (
              <div className="view-tree-empty">Keine passenden Ansichten</div>
            ) : (
              filteredRootViews.map((v) => (
                <ViewTreeItem
                  key={v.id}
                  view={v}
                  childMap={childMap}
                  symbolsByView={filteredSymbolsByView}
                  currentViewId={currentViewId}
                  navigateToView={handleViewTreeClick}
                  collapsed={collapsed}
                  toggleCollapse={toggleCollapse}
                  deadSymbolIds={deadSymbolIds}
                  level={0}
                  searchQuery={normalizedViewSearch}
                  searchActive={viewSearchActive}
                  visibleViewIds={visibleViewIds}
                  matchedViewIds={matchedViewIds}
                  matchedSymbolIds={matchedSymbolIds}
                />
              ))
            )}
          </div>
        )}
      </div>
      )}

      {activeTab === "ai" && (
        <AiWorkspacePanel aiProvider={aiProvider} ollamaModel={ollamaModel} />
      )}

      {activeTab === "project" && (
      <div className="sidebar-section scan-section">
        <div className="project-workspace">
          <div className="project-hero">
            <div className="project-hero__eyebrow">Projektverwaltung</div>
            <div className="project-hero__title">Aktives Projekt</div>
            <div className="project-hero__description">
              {configuredProjectPath
                ? "Das konfigurierte Default-Projekt fuellt nur die Auswahl vor. Scans laufen erst bei Rescan oder neuer Ordnerauswahl."
                : "Waehle ein Projekt ueber den Windows-Explorer und lade es direkt in den Workspace."}
            </div>

            {currentProjectPath ? (
              <div className="project-card project-card--active">
                <div className="project-card__top">
                  <div className="project-card__title-wrap">
                    <div className="project-card__title">{currentProjectName}</div>
                    <div className="project-card__path" title={currentProjectPath}>{currentProjectPath}</div>
                  </div>
                  <div className="project-card__badges">
                    <span className="project-pill project-pill--active">Aktiv</span>
                    {sameProjectPath(currentProjectPath, configuredProjectPath) && (
                      <span className="project-pill project-pill--default">Env Default</span>
                    )}
                    {scanning && <span className="project-pill project-pill--muted">Laedt...</span>}
                  </div>
                </div>
                <div className="project-card__meta">
                  <span>{formatProjectSymbolCount(activeProjectMeta)}</span>
                  <span>{formatProjectTimestamp(activeProjectMeta?.lastScanned)}</span>
                </div>
                {showActiveProjectScanStatus && (
                  <div className={`project-card__scan-status${scanWarnings.length > 0 ? " project-card__scan-status--warning" : ""}`}>
                    <div className="project-card__scan-status-line">
                      {scanStatus.running ? "Scan laeuft" : "Scan-Hinweis"}: {scanStatus.message ?? scanStatus.phase}
                    </div>
                    {scanWarnings.slice(0, 2).map((warning) => (
                      <div key={warning} className="project-card__scan-warning">
                        <i className="bi bi-exclamation-triangle" /> {warning}
                      </div>
                    ))}
                  </div>
                )}
                <div className="project-card__actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => void handlePickProject()}
                    type="button"
                  >
                    <i className="bi bi-folder2-open" /> Projekt wechseln
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => void handleOpenProjectFolderClick(currentProjectPath)}
                    disabled={!currentProjectPath}
                    type="button"
                  >
                    <i className="bi bi-windows" /> Im Explorer oeffnen
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => void handleRescanProject(currentProjectPath)}
                    disabled={!currentProjectPath}
                    type="button"
                  >
                    <i className="bi bi-arrow-repeat" /> Rescan
                  </button>
                  {scanning && (
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => cancelActiveProjectScan()}
                      type="button"
                    >
                      <i className="bi bi-stop-circle" /> Scan stoppen
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost-danger"
                    onClick={() => {
                      if (activeProjectMeta) void handleDeleteProject(activeProjectMeta.projectPath);
                    }}
                    disabled={!activeProjectMeta}
                    title={activeProjectMeta ? "Gespeicherten Scan entfernen" : "Noch kein gespeicherter Scan vorhanden"}
                    type="button"
                  >
                    <i className="bi bi-trash3" /> Entfernen
                  </button>
                </div>
              </div>
            ) : (
              <div className="project-empty">
                <div>Noch kein Projekt aktiv. Waehle ein Verzeichnis ueber den Explorer, um den ersten Scan zu starten.</div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void handlePickProject()}
                  disabled={scanning}
                  type="button"
                >
                  <i className="bi bi-folder2-open" /> Projekt auswaehlen
                </button>
              </div>
            )}
          </div>

          <div className="project-library">
            <div className="project-library__header">
              <div className="project-library__title">Weitere gespeicherte Projekte</div>
              <span className="project-library__count">{libraryProjects.length}</span>
            </div>

            {libraryProjects.length > 0 ? (
              <div className="project-list">
                {libraryProjects.map((project) => (
                  <article
                    key={project.hash}
                    className={`project-card project-card--saved${sameProjectPath(project.projectPath, configuredProjectPath) ? " project-card--default" : ""}`}
                    onClick={() => void handleSwitchProject(project.projectPath)}
                    title={project.projectPath}
                  >
                    <div className="project-card__top">
                      <div className="project-card__title-wrap">
                        <div className="project-card__title">{project.name}</div>
                        <div className="project-card__path">{project.projectPath}</div>
                      </div>
                      <div className="project-card__badges">
                        {sameProjectPath(project.projectPath, configuredProjectPath) && (
                          <span className="project-pill project-pill--default">Env Default</span>
                        )}
                      </div>
                    </div>
                    <div className="project-card__meta">
                      <span>{formatProjectSymbolCount(project)}</span>
                      <span>{formatProjectTimestamp(project.lastScanned)}</span>
                    </div>
                    <div className="project-card__actions">
                      <button
                        className="btn btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleSwitchProject(project.projectPath);
                        }}
                        type="button"
                      >
                        <i className="bi bi-box-arrow-in-right" /> Oeffnen
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleOpenProjectFolderClick(project.projectPath);
                        }}
                        type="button"
                      >
                        <i className="bi bi-windows" /> Explorer
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRescanProject(project.projectPath);
                        }}
                        type="button"
                      >
                        <i className="bi bi-arrow-repeat" /> Rescan
                      </button>
                      <button
                        className="btn btn-sm btn-ghost-danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteProject(project.projectPath);
                        }}
                        type="button"
                      >
                        <i className="bi bi-trash3" /> Entfernen
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="project-empty">
                Keine weiteren gespeicherten Projekte vorhanden.
              </div>
            )}
          </div>

          <div className="project-library">
            <div className="project-library__header">
              <div className="project-library__title">Projektpaket</div>
            </div>
            <div className="project-transfer-actions">
              <button
                className="btn btn-sm btn-outline"
                onClick={() => importInputRef.current?.click()}
                disabled={scanning}
                title="Projektpaket (.dmpg-uml.json) importieren"
                type="button"
              >
                <i className="bi bi-box-arrow-in-down" /> Import Paket
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => graph && exportProjectPackage(graph)}
                disabled={!graph}
                title="Aktuelles UML-Projekt als importierbares Paket exportieren"
                type="button"
              >
                <i className="bi bi-box-arrow-up" /> Export Paket
              </button>
            </div>
          </div>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".dmpg-uml.json,.json,application/json"
          className="project-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleImportProject(file);
            }
          }}
        />
        {scanError && <div className="project-error">{scanError}</div>}
      </div>
      )}

      </div>{/* END sidebar-content */}

      {showBrowser && (
        <FolderBrowser
          onSelect={(p) => { void loadProjectWorkspace(p, { scanIfMissing: true }); }}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </div>
  );
}
