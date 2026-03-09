import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { collectNavigableSymbolIds, useAppStore } from "../store";
import {
  scanProject,
  browseFolders,
  fetchConfig,
  fetchProjects,
  switchProject as switchProjectApi,
  deleteProjectApi,
  replaceGraph,
} from "../api";
import type { ProjectMeta } from "../api";
import type { DiagramView, Symbol as Sym } from "@dmpg/shared";
import { AiWorkspacePanel } from "./AiWorkspacePanel";
import { exportProjectPackage, importProjectPackageFile } from "../projectTransfer";
import { formatViewTitle } from "../viewTitles";

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

/** Navigate to the deepest view containing a symbol and focus it */
function goToSymbol(symbolId: string) {
  useAppStore.getState().focusSymbolInContext(symbolId);
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
  symbolsByView: Map<string, Sym[]>;
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
  const isActive = view.id === currentViewId;
  const isSearchMatch = searchActive && matchedViewIds.has(view.id);
  const scope = (view as any).scope as string | undefined;
  const icon = SCOPE_ICONS[scope ?? ""] ?? "bi-folder";

  // Check if this view contains dead-code nodes
  const hasDeadCode = view.nodeRefs.some((id) => deadSymbolIds.has(id));

  return (
    <>
      <div
        className={`view-tree-item ${isActive ? "view-tree-item--active" : ""} ${hasDeadCode ? "view-tree-item--has-dead" : ""}${isSearchMatch ? " view-tree-item--search-match" : ""}`}
        style={{ paddingLeft: 8 + level * 16 }}
        onClick={() => navigateToView(view.id)}
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
          {viewSymbols.map((sym) => (
            <div
              key={sym.id}
              className={`view-tree-item view-tree-symbol ${deadSymbolIds.has(sym.id) ? "view-tree-symbol--dead" : ""}${searchActive && matchedSymbolIds.has(sym.id) ? " view-tree-item--search-match" : ""}`}
              style={{ paddingLeft: 8 + (level + 1) * 16 }}
              onClick={(e) => {
                e.stopPropagation();
                goToSymbol(sym.id);
              }}
            >
              <span className="view-tree-chevron view-tree-chevron--leaf" />
              <KindBadge kind={sym.kind} />
              <span className="view-tree-label">
                <HighlightText text={sym.label.split(".").pop() ?? sym.label} query={searchQuery} />
              </span>
            </div>
          ))}
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
          <h3>Select Project Folder</h3>
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
          {loading && <div style={{ padding: 12, color: "var(--text-dim)" }}>Loading…</div>}
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
            <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 11 }}>No subfolders</div>
          )}
        </div>

        <div className="folder-browser-actions">
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => { onSelect(currentDir); onClose(); }}>
            Select "{currentDir.split(/[\\/]/).pop()}"
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const graph = useAppStore((s) => s.graph);
  const setGraph = useAppStore((s) => s.setGraph);
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

  const handleActivityTabClick = useCallback((tab: SidebarTab) => {
    if (!sidebarCollapsed && activeTab === tab) {
      setSidebarCollapsed(true);
      return;
    }
    setActiveTab(tab);
    setSidebarCollapsed(false);
  }, [activeTab, sidebarCollapsed, setSidebarCollapsed]);

  // Load default scan path, AI config, and project list on mount
  useEffect(() => {
    fetchConfig().then((cfg) => {
      if (cfg.scanProjectPath) {
        setScanPath((prev) => prev || cfg.scanProjectPath);
      }
      setAiProvider(cfg.aiProvider ?? "cloud");
      setOllamaModel(cfg.ollamaModel ?? "");
    });
    refreshProjects().catch(() => {});
  }, [refreshProjects]);

  const handleScan = useCallback(async () => {
    if (!scanPath.trim()) return;
    setScanning(true);
    setScanError("");
    try {
      exitValidateMode();
      resetPlaybackQueue();
      const g = await scanProject(scanPath.trim());
      setGraph(g);
      // Refresh project list after successful scan
      await refreshProjects();
    } catch (err: any) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  }, [scanPath, setGraph, exitValidateMode, refreshProjects, resetPlaybackQueue]);

  const handleImportProject = useCallback(async (file: File) => {
    setScanning(true);
    setScanError("");
    try {
      exitValidateMode();
      resetPlaybackQueue();
      const importedGraph = await importProjectPackageFile(file);
      const normalizedGraph = await replaceGraph(importedGraph);
      setGraph(normalizedGraph);
      setScanPath(normalizedGraph.sourceProjectPath ?? "");
      await refreshProjects();
    } catch (err: any) {
      setScanError(err.message ?? "Import failed");
    } finally {
      setScanning(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }, [exitValidateMode, refreshProjects, resetPlaybackQueue, setGraph]);

  const handleSwitchProject = useCallback(async (projectPath: string) => {
    try {
      const { graph: g } = await switchProjectApi(projectPath);
      if (g) {
        setGraph(g);
      }
      setScanPath(g?.sourceProjectPath ?? projectPath);
      setActiveProjectPath(projectPath);
      setScanError("");
    } catch (err: any) {
      setScanError(err.message);
    }
  }, [setGraph]);

  const handleDeleteProject = useCallback(async (projectPath: string) => {
    try {
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
        useAppStore.getState().selectSymbol(null);
        useAppStore.getState().selectEdge(null);
        // setGraph with a null-like empty state: use the raw setter
        useAppStore.setState({
          graph: null,
          currentViewId: null,
          selectedSymbolId: null,
          selectedEdgeId: null,
          breadcrumb: [],
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
        setScanPath("");
      }
      setScanError("");
    } catch { /* ignore */ }
  }, [setGraph, exitValidateMode, resetPlaybackQueue]);

  useEffect(() => {
    const onSidebarCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; projectPath?: string }>).detail;
      const action = detail?.action;
      if (!action) return;

      switch (action) {
        case "scan":
          activateTab("project");
          void handleScan();
          break;
        case "open-folder-browser":
          activateTab("project");
          setShowBrowser(true);
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
    handleScan,
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
  const sidebarViews = useMemo(
    () => views.filter((view) => !view.hiddenInSidebar),
    [views],
  );
  const allSymbols = graph?.symbols ?? [];
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
    const map = new Map<string, Sym[]>();
    // A symbol that owns any child view should not be rendered as a leaf item.
    const viewOwnerIds = new Set(
      allSymbols
        .filter((sym) => Boolean(sym.childViewId))
        .map((sym) => sym.id),
    );
    for (const v of sidebarViews) {
      const syms: Sym[] = [];
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
  }, [sidebarViews, allSymbols]);

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
    const isSymbolMatch = (sym: Sym) =>
      queryMatches(sym.label, normalizedViewSearch) ||
      queryMatches(sym.kind, normalizedViewSearch) ||
      queryMatches(sym.doc?.summary ?? "", normalizedViewSearch);

    const matchedViewIds = new Set<string>();
    const matchedSymbolIds = new Set<string>();
    for (const sym of allSymbols) {
      if (isSymbolMatch(sym)) matchedSymbolIds.add(sym.id);
    }

    const visibleViewIds = new Set<string>();
    const filteredSymbolsByView = new Map<string, Sym[]>();

    const visit = (view: DiagramView): boolean => {
      const selfMatch = isViewMatch(view);
      if (selfMatch) matchedViewIds.add(view.id);

      const children = childMap.get(view.id) ?? [];
      const childVisible = children.some((child) => visit(child));

      const viewSymbols = symbolsByView.get(view.id) ?? [];
      const visibleSymbols = viewSymbols.filter((sym) => matchedSymbolIds.has(sym.id));
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

  // Collect dead-code symbols for dedicated section
  const deadCodeSymbols = useMemo(() => {
    return (graph?.symbols ?? []).filter((s) => s.tags?.includes("dead-code"));
  }, [graph]);

  return (
    <div className={`sidebar sidebar--vscode${sidebarCollapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar-activity" role="tablist" aria-label="Sidebar Tabs">
        <button
          className={`sidebar-activity-btn${activeTab === "views" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("views")}
          title="Views"
          role="tab"
          aria-selected={activeTab === "views"}
        >
          <i className="bi bi-diagram-3" />
        </button>
        <button
          className={`sidebar-activity-btn${activeTab === "nodes" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("nodes")}
          title="UML Nodes"
          role="tab"
          aria-selected={activeTab === "nodes"}
        >
          <i className="bi bi-boxes" />
        </button>
        <button
          className={`sidebar-activity-btn${activeTab === "ai" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("ai")}
          title="AI Workspace"
          role="tab"
          aria-selected={activeTab === "ai"}
        >
          <i className="bi bi-cpu" />
        </button>
        <button
          className={`sidebar-activity-btn${activeTab === "project" ? " sidebar-activity-btn--active" : ""}`}
          onClick={() => handleActivityTabClick("project")}
          title="Projects / Scan"
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
          UML Nodes
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
          Views
          <button
            className="sidebar-section__action"
            onClick={(e) => { e.stopPropagation(); collapseAllViews(); }}
            title="Alle Views einklappen"
          >
            <i className="bi bi-dash-square" />
          </button>
        </h2>
        {!sectionCollapsed.views && (
          <div className="view-tree">
            {filteredRootViews.length === 0 ? (
              <div className="view-tree-empty">Keine passenden Views</div>
            ) : (
              filteredRootViews.map((v) => (
                <ViewTreeItem
                  key={v.id}
                  view={v}
                  childMap={childMap}
                  symbolsByView={filteredSymbolsByView}
                  currentViewId={currentViewId}
                  navigateToView={navigateToView}
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

      {/* ── Dead Code Section ── */}
      {activeTab === "views" && deadCodeSymbols.length > 0 && (
        <div className="sidebar-section">
          <h2><i className="bi bi-exclamation-triangle" /> Dead Code ({deadCodeSymbols.length})</h2>
          {deadCodeSymbols.map((sym) => (
            <div
              key={sym.id}
              className="node-palette-item dead-code-item"
              onClick={() => goToSymbol(sym.id)}
            >
              <span className="dead-code-icon"><i className="bi bi-x-circle" /></span>
              <KindBadge kind={sym.kind} />
              <span>{sym.label.split(".").pop()}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "ai" && (
        <AiWorkspacePanel aiProvider={aiProvider} ollamaModel={ollamaModel} />
      )}

      {activeTab === "project" && (
      <div className="sidebar-section scan-section">
        <h2>Scan Project</h2>

        {/* ── Project Quick-Switch List ── */}
        {projects.length > 0 && (
          <div className="project-list">
            {projects.map((p) => (
              <div
                key={p.hash}
                className={`project-item${p.projectPath === activeProjectPath ? " project-item--active" : ""}`}
                onClick={() => handleSwitchProject(p.projectPath)}
                title={p.projectPath}
              >
                <div className="project-item__info">
                  <span className="project-item__name">{p.name}</span>
                  <span className="project-item__meta">
                    {p.symbolCount} Symbole · {new Date(p.lastScanned).toLocaleDateString("de-DE")}
                  </span>
                </div>
                <button
                  className="project-item__delete"
                  onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.projectPath); }}
                  title="Projekt entfernen"
                >
                  <i className="bi bi-x-lg" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="text"
            placeholder="Project path…"
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleScan()}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-sm btn-outline"
            onClick={() => setShowBrowser(true)}
            title="Browse folders"
            style={{ whiteSpace: "nowrap" }}
          >
            <i className="bi bi-folder2-open" />
          </button>
        </div>
        <button className="btn" onClick={handleScan} disabled={scanning} style={{ marginTop: 4 }}>
          {scanning ? "Scanning…" : "Scan"}
        </button>
        <div className="project-transfer-actions">
          <button
            className="btn btn-sm btn-outline"
            onClick={() => importInputRef.current?.click()}
            disabled={scanning}
            title="Projektpaket (.dmpg-uml.json) importieren"
          >
            <i className="bi bi-box-arrow-in-down" /> Import Paket
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => graph && exportProjectPackage(graph)}
            disabled={!graph}
            title="Aktuelles UML-Projekt als importierbares Paket exportieren"
          >
            <i className="bi bi-box-arrow-up" /> Export Paket
          </button>
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
        {scanError && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{scanError}</div>}
      </div>
      )}

      </div>{/* END sidebar-content */}

      {showBrowser && (
        <FolderBrowser
          onSelect={(p) => setScanPath(p)}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </div>
  );
}
