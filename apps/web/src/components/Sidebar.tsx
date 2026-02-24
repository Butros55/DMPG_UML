import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store";
import { scanProject, browseFolders, fetchConfig, startAnalysis, cancelAnalysis, pauseAnalysis, fetchAnalyzeStatus, fetchGraph } from "../api";
import type { DiagramView } from "@dmpg/shared";

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

const SCOPE_ICONS: Record<string, string> = {
  root: "🌐",
  group: "📦",
  module: "📄",
  class: "🏛️",
};

/* ─── View Tree Item (recursive) ─── */
function ViewTreeItem({
  view,
  childMap,
  currentViewId,
  navigateToView,
  collapsed,
  toggleCollapse,
  deadSymbolIds,
  level,
}: {
  view: DiagramView;
  childMap: Map<string, DiagramView[]>;
  currentViewId: string | null;
  navigateToView: (id: string) => void;
  collapsed: Record<string, boolean>;
  toggleCollapse: (id: string) => void;
  deadSymbolIds: Set<string>;
  level: number;
}) {
  const children = childMap.get(view.id) ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed[view.id] ?? (level > 1);
  const isActive = view.id === currentViewId;
  const scope = (view as any).scope as string | undefined;
  const icon = SCOPE_ICONS[scope ?? ""] ?? "📂";

  // Check if this view contains dead-code nodes
  const hasDeadCode = view.nodeRefs.some((id) => deadSymbolIds.has(id));

  return (
    <>
      <div
        className={`view-tree-item ${isActive ? "view-tree-item--active" : ""} ${hasDeadCode ? "view-tree-item--has-dead" : ""}`}
        style={{ paddingLeft: 8 + level * 16 }}
        onClick={() => navigateToView(view.id)}
      >
        {hasChildren ? (
          <span
            className={`view-tree-chevron ${isCollapsed ? "" : "view-tree-chevron--open"}`}
            onClick={(e) => { e.stopPropagation(); toggleCollapse(view.id); }}
          >
            ▸
          </span>
        ) : (
          <span className="view-tree-chevron view-tree-chevron--leaf" />
        )}
        <span className="view-tree-icon">{icon}</span>
        <span className="view-tree-label">{view.title}</span>
      </div>
      {hasChildren && !isCollapsed && children.map((child) => (
        <ViewTreeItem
          key={child.id}
          view={child}
          childMap={childMap}
          currentViewId={currentViewId}
          navigateToView={navigateToView}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          deadSymbolIds={deadSymbolIds}
          level={level + 1}
        />
      ))}
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
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 16, color: "var(--text-dim)" }}>✕</button>
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
              <span>📁</span> <span style={{ color: "var(--text-dim)" }}>..</span>
            </div>
          )}

          {folders.map((f) => (
            <div key={f.path} className="folder-item" onClick={() => loadDir(f.path)}>
              <span>📁</span> <span>{f.name}</span>
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
  const updateGraph = useAppStore((s) => s.updateGraph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const aiAnalysis = useAppStore((s) => s.aiAnalysis);
  const addAiEvent = useAppStore((s) => s.addAiEvent);
  const startAiAnalysis = useAppStore((s) => s.startAiAnalysis);
  const stopAiAnalysis = useAppStore((s) => s.stopAiAnalysis);

  const [scanPath, setScanPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const abortRef = useCallback(() => {}, []);
  const [abortFn, setAbortFn] = useState<(() => void) | null>(null);
  const [analyzeScope, setAnalyzeScope] = useState<"all" | "view">("all");
  const [aiProvider, setAiProvider] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [canResume, setCanResume] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lastNavTimeRef = useRef(0);
  const NAV_THROTTLE_MS = 2000; // auto-navigate every 2 seconds

  // Load default scan path and AI config from server on mount
  useEffect(() => {
    fetchConfig().then((cfg) => {
      if (cfg.scanProjectPath) {
        setScanPath((prev) => prev || cfg.scanProjectPath);
      }
      setAiProvider(cfg.aiProvider ?? "cloud");
      setOllamaModel(cfg.ollamaModel ?? "");
    });
    // Check if there is a resumable AI analysis from a previous session
    fetchAnalyzeStatus().then((status) => {
      if (status.canResume && !status.running) {
        setCanResume(true);
      }
    }).catch(() => {});
  }, []);

  const handleScan = useCallback(async () => {
    if (!scanPath.trim()) return;
    setScanning(true);
    setScanError("");
    try {
      const g = await scanProject(scanPath.trim());
      setGraph(g);
    } catch (err: any) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  }, [scanPath, setGraph]);

  // Auto-scroll AI log when new entries arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [aiAnalysis?.log.length]);

  /* ── AI Analysis ── */
  const handleStartAnalysis = useCallback(async (resume = false) => {
    console.log(`[AI] Starting AI analysis... (resume=${resume})`);

    // Ensure server has the latest full graph before starting
    try {
      const freshGraph = await fetchGraph();
      updateGraph(freshGraph);
    } catch { /* continue with what server has */ }

    startAiAnalysis();
    setCanResume(false);

    // Determine scope
    const viewId = analyzeScope === "view" ? currentViewId ?? undefined : undefined;
    console.log(`[AI] Scope: ${viewId ? `view ${viewId}` : "all"}, resume: ${resume}`);

    // Helper: navigate to the view containing a symbol so the user sees the change
    const navigateToSymbol = (symbolId: string) => {
      const now = Date.now();
      if (now - lastNavTimeRef.current < NAV_THROTTLE_MS) return; // throttle
      const g = useAppStore.getState().graph;
      if (!g) return;
      // Find the deepest view containing this symbol
      let bestView: string | null = null;
      for (const v of g.views) {
        if (v.nodeRefs.includes(symbolId)) {
          // Prefer deeper views (more specific)
          if (!bestView || (v.parentViewId && v.parentViewId !== g.rootViewId)) {
            bestView = v.id;
          }
        }
      }
      if (bestView) {
        lastNavTimeRef.current = now;
        if (bestView !== useAppStore.getState().currentViewId) {
          navigateToView(bestView);
        }
        // Zoom + highlight the node
        useAppStore.getState().setFocusNode(symbolId);
      }
    };

    const abort = startAnalysis(
      (event) => {
        console.log("[AI] SSE event:", event.phase, event.action ?? "", event.symbolLabel ?? event.symbolId ?? "", JSON.stringify(event));
        addAiEvent(event);

        // Auto-navigate to the view containing the changed symbol (throttled)
        if (event.symbolId && event.action !== "start" && event.action !== "error" && event.action !== "saved") {
          navigateToSymbol(event.symbolId);
        }

        // Periodically refresh graph from server when a batch is saved
        if (event.action === "saved" || event.action === "start") {
          fetch("/api/graph").then((r) => r.json()).then((g) => updateGraph(g)).catch(() => {});
        }

        if (event.phase === "done" || event.phase === "cancelled") {
          console.log("[AI] Analysis", event.phase, event.stats);
          // Final refresh
          fetch("/api/graph").then((r) => r.json()).then((g) => updateGraph(g)).catch(() => {});
        }
        if (event.phase === "paused") {
          console.log("[AI] Analysis paused", event.stats);
          setCanResume(true);
          stopAiAnalysis();
          fetch("/api/graph").then((r) => r.json()).then((g) => updateGraph(g)).catch(() => {});
        }
        if (event.phase === "error") {
          console.error("[AI] Analysis error:", event.message);
          setCanResume(true); // can resume after errors too
          fetch("/api/graph").then((r) => r.json()).then((g) => updateGraph(g)).catch(() => {});
        }
      },
      (err) => {
        console.error("[AI] Connection error:", err);
        addAiEvent({ phase: "error", message: err.message ?? "Verbindungsfehler" });
        stopAiAnalysis();
        // Re-fetch on error too
        fetch("/api/graph").then((r) => r.json()).then((g) => updateGraph(g)).catch(() => {});
      },
      viewId,
      resume,
    );
    setAbortFn(() => abort);
  }, [startAiAnalysis, addAiEvent, stopAiAnalysis, updateGraph, navigateToView, analyzeScope, currentViewId]);

  const handleStopAnalysis = useCallback(() => {
    // Tell the server to stop processing
    cancelAnalysis().catch(() => {});
    if (abortFn) abortFn();
    stopAiAnalysis();
    setCanResume(true); // cancelled analysis can be resumed
    // Re-fetch graph to get whatever was saved server-side
    fetch("/api/graph").then((r) => r.json()).then((g) => updateGraph(g)).catch(() => {});
  }, [abortFn, stopAiAnalysis, updateGraph]);

  const handlePauseAnalysis = useCallback(() => {
    // Tell the server to pause (saves progress, can resume)
    pauseAnalysis().catch(() => {});
    // Don't abort the SSE — let it receive the "paused" event naturally
  }, []);

  const onDragStart = (e: React.DragEvent, kind: string) => {
    e.dataTransfer.setData("application/uml-kind", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  const toggleCollapse = useCallback((viewId: string) => {
    setCollapsed((prev) => ({ ...prev, [viewId]: !prev[viewId] }));
  }, []);

  // Build view tree structure
  const views = graph?.views ?? [];
  const { rootViews, childMap } = useMemo(() => {
    const cMap = new Map<string, DiagramView[]>();
    const roots: DiagramView[] = [];
    for (const v of views) {
      if (!v.parentViewId) {
        roots.push(v);
      } else {
        const siblings = cMap.get(v.parentViewId) ?? [];
        siblings.push(v);
        cMap.set(v.parentViewId, siblings);
      }
    }
    return { rootViews: roots, childMap: cMap };
  }, [views]);

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
    <div className="sidebar">
      <div className="sidebar-section">
        <h2>UML Nodes</h2>
        {NODE_KINDS.map((nk) => (
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

      {/* ── Collapsible View Tree ── */}
      <div className="sidebar-section">
        <h2>Views</h2>
        <div className="view-tree">
          {rootViews.map((v) => (
            <ViewTreeItem
              key={v.id}
              view={v}
              childMap={childMap}
              currentViewId={currentViewId}
              navigateToView={navigateToView}
              collapsed={collapsed}
              toggleCollapse={toggleCollapse}
              deadSymbolIds={deadSymbolIds}
              level={0}
            />
          ))}
        </div>
      </div>

      {/* ── Dead Code Section ── */}
      {deadCodeSymbols.length > 0 && (
        <div className="sidebar-section">
          <h2>⚠️ Dead Code ({deadCodeSymbols.length})</h2>
          {deadCodeSymbols.map((sym) => (
            <div
              key={sym.id}
              className="node-palette-item dead-code-item"
              onClick={() => {
                const store = useAppStore.getState();
                const g = store.graph;
                if (!g) return;
                // Find the deepest view containing this symbol
                let bestView: string | null = null;
                for (const v of g.views) {
                  if (v.nodeRefs.includes(sym.id)) {
                    if (!bestView || (v.parentViewId && v.parentViewId !== g.rootViewId)) {
                      bestView = v.id;
                    }
                  }
                }
                if (bestView && bestView !== store.currentViewId) {
                  store.navigateToView(bestView);
                }
                store.setFocusNode(sym.id);
              }}
            >
              <span className="dead-code-icon">💀</span>
              <span>{sym.label.split(".").pop()}</span>
              <span className="dead-code-kind">{sym.kind}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── AI Analysis ── */}
      {graph && (
        <div className="sidebar-section">
          <h2>AI Analysis</h2>

          {/* Provider info */}
          <div className="ai-provider-info">
            <span className={`ai-provider-badge ai-provider-badge--${aiProvider}`}>
              {aiProvider === "local" ? "🖥️ Lokal" : "☁️ Cloud"}
            </span>
            {ollamaModel && <span className="ai-provider-model">{ollamaModel}</span>}
          </div>

          {/* Scope toggle */}
          <div className="ai-scope-toggle">
            <label>
              <input
                type="radio"
                name="aiScope"
                value="all"
                checked={analyzeScope === "all"}
                onChange={() => setAnalyzeScope("all")}
                disabled={!!aiAnalysis?.running}
              />
              Gesamtes Projekt
            </label>
            <label>
              <input
                type="radio"
                name="aiScope"
                value="view"
                checked={analyzeScope === "view"}
                onChange={() => setAnalyzeScope("view")}
                disabled={!!aiAnalysis?.running}
              />
              Nur aktuelle View
            </label>
          </div>

          {!aiAnalysis?.running ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button className="btn ai-analyze-btn ai-analyze-btn--start" onClick={() => handleStartAnalysis(false)} style={{ flex: 1 }}>
                🤖 AI Analyse starten
              </button>
              {canResume && (
                <button className="btn ai-analyze-btn ai-analyze-btn--resume" onClick={() => handleStartAnalysis(true)} style={{ flex: 1 }}>
                  ▶️ Fortsetzen
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn ai-analyze-btn ai-analyze-btn--pause" onClick={handlePauseAnalysis} style={{ flex: 1 }}>
                ⏸ Pausieren
              </button>
              <button className="btn ai-analyze-btn ai-analyze-btn--stop" onClick={handleStopAnalysis} style={{ flex: 1 }}>
                ⏹ Stoppen
              </button>
            </div>
          )}
          {aiAnalysis && (
            <div className="ai-log-panel">
              {aiAnalysis.running && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="ai-spinner" />
                    <span className={`ai-phase-badge ai-phase-badge--${aiAnalysis.phase}`}>{aiAnalysis.phase || "starting…"}</span>
                    {/* Show progress text from last progress event */}
                    {(() => {
                      const last = [...aiAnalysis.log].reverse().find((e) => e.action === "progress" || e.action === "saved");
                      return last?.message ? <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 4 }}>{last.message}</span> : null;
                    })()}
                  </div>
                  {/* Progress bar */}
                  {aiAnalysis.current != null && aiAnalysis.total != null && aiAnalysis.total > 0 && (
                    <div className="ai-progress-bar">
                      <div
                        className="ai-progress-bar__fill"
                        style={{ width: `${Math.min(100, Math.round((aiAnalysis.current / aiAnalysis.total) * 100))}%` }}
                      />
                      <span className="ai-progress-bar__text">
                        {aiAnalysis.current} / {aiAnalysis.total}
                      </span>
                    </div>
                  )}
                  {/* AI thought — what the LLM is currently processing */}
                  {aiAnalysis.thought && (
                    <div className="ai-thought-line">
                      <span className="ai-thought-icon">🧠</span>
                      <span className="ai-thought-text">{aiAnalysis.thought}</span>
                    </div>
                  )}
                </div>
              )}
              {!aiAnalysis.running && aiAnalysis.phase === "done" && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--green)" }}>
                  ✅ Analyse abgeschlossen
                </div>
              )}
              {!aiAnalysis.running && aiAnalysis.phase === "error" && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--red)" }}>
                  ❌ Analyse fehlgeschlagen
                </div>
              )}
              {!aiAnalysis.running && aiAnalysis.phase === "stopped" && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--yellow)" }}>
                  ⏹ Analyse gestoppt — Änderungen bis hier gespeichert
                </div>
              )}
              {!aiAnalysis.running && aiAnalysis.phase === "cancelled" && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--yellow)" }}>
                  🚫 Analyse abgebrochen — Änderungen bis hier gespeichert
                </div>
              )}
              {!aiAnalysis.running && aiAnalysis.phase === "paused" && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--cyan, #66d9ef)" }}>
                  ⏸ Analyse pausiert — Fortschritt gespeichert, Fortsetzen möglich
                </div>
              )}
              {/* Stats summary after completion */}
              {aiAnalysis.log.some((e) => e.phase === "done" || e.phase === "cancelled" || e.phase === "paused") && (() => {
                const s = (aiAnalysis.log.find((e) => e.phase === "done") ?? aiAnalysis.log.find((e) => e.phase === "paused") ?? aiAnalysis.log.find((e) => e.phase === "cancelled"))?.stats;
                return s ? (
                  <div className="ai-stats">
                    <div className="ai-stat"><span>✏️</span><span className="num">{s?.labelsFixed ?? 0}</span> Labels</div>
                    <div className="ai-stat"><span>📝</span><span className="num">{s?.docsGenerated ?? 0}</span> Docs</div>
                    <div className="ai-stat"><span>🔗</span><span className="num">{s?.relationsAdded ?? 0}</span> Relations</div>
                    <div className="ai-stat"><span>💀</span><span className="num">{s?.deadCodeFound ?? 0}</span> Dead Code</div>
                  </div>
                ) : null;
              })()}
              <div className="ai-log-entries" ref={logRef}>
                {aiAnalysis.log.filter((e) => e.action !== "progress" && e.action !== "saved").slice(-100).map((ev, i) => (
                  <div key={i} className={`ai-log-entry`}>
                    <span className={`ai-log-phase ai-log-phase--${ev.phase}`}>{ev.phase}</span>
                    <span className="ai-log-text">
                      {ev.action === "start" && `Phase gestartet…`}
                      {ev.action === "error" && <span style={{ color: "var(--red)" }}>⚠️ {ev.message ?? "Fehler"} ({ev.symbolLabel ?? ""})</span>}
                      {ev.phase === "labels" && !ev.action && <span>✏️ {ev.old} → {ev.new_}</span>}
                      {ev.phase === "docs" && ev.action === "generated" && <span>📝 {ev.symbolLabel}: {ev.summary?.slice(0, 60)}</span>}
                      {ev.phase === "relations" && ev.action === "added" && <span>🔗 +{ev.relationType}: {ev.sourceLabel} → {ev.targetLabel}</span>}
                      {ev.phase === "dead-code" && !ev.action && <span>💀 {ev.symbolLabel} — {ev.reason}</span>}
                      {ev.phase === "done" && <span>✅ Fertig!</span>}
                      {ev.phase === "cancelled" && <span>🚫 Abgebrochen</span>}
                      {ev.phase === "paused" && <span>⏸ Pausiert</span>}
                      {ev.phase === "error" && !ev.action && <span style={{ color: "var(--red)" }}>❌ {ev.message}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="sidebar-section scan-section">
        <h2>Scan Project</h2>
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
            📂
          </button>
        </div>
        <button className="btn" onClick={handleScan} disabled={scanning} style={{ marginTop: 4 }}>
          {scanning ? "Scanning…" : "Scan"}
        </button>
        {scanError && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{scanError}</div>}
      </div>

      {showBrowser && (
        <FolderBrowser
          onSelect={(p) => setScanPath(p)}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </div>
  );
}
