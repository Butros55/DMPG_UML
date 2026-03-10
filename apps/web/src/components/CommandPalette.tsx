import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { Symbol as Sym } from "@dmpg/shared";
import { fetchAnalyzeStatus, fetchProjects, type ProjectMeta } from "../api";
import { collectNavigableSymbolIds, useAppStore } from "../store";

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

/** Navigate to the deepest view containing a symbol and focus it */
function goToSymbol(symbolId: string) {
  useAppStore.getState().focusSymbolInContext(symbolId);
}

type ActionCommand = {
  id: string;
  label: string;
  kind: string;
  summary?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
};

function dispatchSidebarCommand(action: string, projectPath?: string) {
  window.dispatchEvent(new CustomEvent("dmpg:sidebar-command", { detail: { action, projectPath } }));
}

function dispatchCanvasCommand(action: string) {
  window.dispatchEvent(new CustomEvent("dmpg:canvas-command", { detail: { action } }));
}

function dispatchInspectorCommand(action: string) {
  window.dispatchEvent(new CustomEvent("dmpg:inspector-command", { detail: { action } }));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [canResume, setCanResume] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const removeSymbol = useAppStore((s) => s.removeSymbol);
  const removeRelation = useAppStore((s) => s.removeRelation);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const syncGraphToServer = useAppStore((s) => s.syncGraphToServer);
  const applyDiagramLayout = useAppStore((s) => s.applyDiagramLayout);
  const resetDiagramSettings = useAppStore((s) => s.resetDiagramSettings);
  const undoGraphChange = useAppStore((s) => s.undoGraphChange);
  const redoGraphChange = useAppStore((s) => s.redoGraphChange);
  const historyCanUndo = useAppStore((s) => s.historyCanUndo);
  const historyCanRedo = useAppStore((s) => s.historyCanRedo);
  const inspectorCollapsed = useAppStore((s) => s.inspectorCollapsed);
  const toggleInspector = useAppStore((s) => s.toggleInspector);
  const aiRunning = useAppStore((s) => s.aiAnalysis?.running ?? false);
  const aiRunKind = useAppStore((s) => s.aiAnalysis?.runKind ?? null);
  const symbols = useMemo(() => {
    if (!graph) return [] as Sym[];
    const navigableIds = collectNavigableSymbolIds(graph);
    return graph.symbols.filter((symbol) => navigableIds.has(symbol.id));
  }, [graph]);
  const isActionMode = query.startsWith(">");
  const searchQuery = isActionMode ? "" : query.trim().toLowerCase();
  const actionQuery = isActionMode ? query.slice(1).trim().toLowerCase() : "";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "p") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
      setQuery(e.shiftKey ? ">" : "");
      setActiveIndex(0);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isActionMode) return;
    let cancelled = false;

    void fetchProjects()
      .then((res) => {
        if (cancelled) return;
        setProjects(res.projects);
        setActiveProjectPath(res.activeProject);
      })
      .catch(() => {
        if (cancelled) return;
        setProjects([]);
        setActiveProjectPath(null);
      });

    void fetchAnalyzeStatus()
      .then((status) => {
        if (!cancelled) {
          setCanResume(!!status.canResume && !status.running);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanResume(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, isActionMode]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const symbolResults = useMemo(() => {
    if (searchQuery.length < 1) return [] as Sym[];
    return symbols
      .filter((s) => {
        const label = s.label.toLowerCase();
        return (
          label.includes(searchQuery) ||
          s.kind.toLowerCase().includes(searchQuery) ||
          (s.doc?.summary ?? "").toLowerCase().includes(searchQuery)
        );
      })
      .slice(0, 40);
  }, [searchQuery, symbols]);

  const commands = useMemo<ActionCommand[]>(() => {
    const list: ActionCommand[] = [
      {
        id: "reload-window",
        label: "Fenster neu laden",
        kind: "system",
        keywords: ["reload", "refresh", "neu laden"],
        run: () => window.location.reload(),
      },
      {
        id: "save-graph",
        label: "Änderungen speichern",
        kind: "graph",
        keywords: ["save", "sync", "persist", "speichern"],
        disabled: !graph,
        run: () => { void syncGraphToServer(); },
      },
      {
        id: "export-project-package",
        label: "Projektpaket exportieren",
        kind: "export",
        keywords: ["export", "projekt", "package", "paket", "json", "teilen"],
        disabled: !graph,
        run: () => dispatchCanvasCommand("export-project-package"),
      },
      {
        id: "export-project-html",
        label: "HTML-Projekt exportieren",
        kind: "export",
        keywords: ["export", "project", "projekt", "html"],
        disabled: !graph,
        run: () => dispatchCanvasCommand("export-project-html"),
      },
      {
        id: "export-view",
        label: "HTML-View exportieren",
        kind: "export",
        keywords: ["export", "view", "diagramm", "html"],
        disabled: !graph || !currentViewId,
        run: () => dispatchCanvasCommand("export-view"),
      },
      {
        id: "scan-project",
        label: "Projekt scannen",
        kind: "project",
        keywords: ["scan", "analyse", "projekt"],
        run: () => dispatchSidebarCommand("scan"),
      },
      {
        id: "open-project-folder",
        label: "Neues Projekt öffnen…",
        kind: "project",
        keywords: ["open", "folder", "browse", "projektordner"],
        run: () => dispatchSidebarCommand("open-folder-browser"),
      },
      {
        id: "import-project-package",
        label: "Projektpaket importieren…",
        kind: "project",
        keywords: ["import", "projekt", "package", "paket", "json"],
        run: () => dispatchSidebarCommand("import-project-package"),
      },
      {
        id: "delete-active-project",
        label: "Aktives Projekt löschen",
        kind: "project",
        keywords: ["delete", "remove", "projekt löschen"],
        disabled: !activeProjectPath,
        run: () => {
          if (!activeProjectPath) return;
          if (!window.confirm("Aktives Projekt wirklich löschen?")) return;
          dispatchSidebarCommand("delete-active-project");
        },
      },
      {
        id: "ai-start",
        label: "AI Workspace starten",
        kind: "ai",
        keywords: ["ai", "workspace", "analyse", "start"],
        disabled: aiRunning,
        run: () => dispatchSidebarCommand("ai-start"),
      },
      {
        id: "ai-resume",
        label: "AI Projektanalyse fortsetzen",
        kind: "ai",
        keywords: ["ai", "resume", "fortsetzen"],
        disabled: aiRunning || !canResume,
        run: () => dispatchSidebarCommand("ai-resume"),
      },
      {
        id: "ai-pause",
        label: "AI Lauf pausieren",
        kind: "ai",
        keywords: ["ai", "pause", "pausieren"],
        disabled: !aiRunning || aiRunKind !== "project_analysis",
        run: () => dispatchSidebarCommand("ai-pause"),
      },
      {
        id: "ai-stop",
        label: "AI Lauf stoppen",
        kind: "ai",
        keywords: ["ai", "stop", "cancel"],
        disabled: !aiRunning,
        run: () => dispatchSidebarCommand("ai-stop"),
      },
      {
        id: "undo",
        label: "Undo (Canvas)",
        kind: "edit",
        keywords: ["undo", "rückgängig", "ctrl z"],
        disabled: !historyCanUndo,
        run: () => undoGraphChange(),
      },
      {
        id: "redo",
        label: "Redo (Canvas)",
        kind: "edit",
        keywords: ["redo", "wiederholen", "ctrl shift z"],
        disabled: !historyCanRedo,
        run: () => redoGraphChange(),
      },
      {
        id: "delete-selected-symbol",
        label: "Selektierten Node löschen",
        kind: "edit",
        keywords: ["delete", "node", "symbol"],
        disabled: !selectedSymbolId,
        run: () => {
          if (!selectedSymbolId) return;
          removeSymbol(selectedSymbolId);
          selectSymbol(null);
        },
      },
      {
        id: "delete-selected-edge",
        label: "Selektierte Kante löschen",
        kind: "edit",
        keywords: ["delete", "edge", "relation"],
        disabled: !selectedEdgeId,
        run: () => {
          if (!selectedEdgeId) return;
          const direct = graph?.relations.find((r) => r.id === selectedEdgeId);
          if (direct) {
            removeRelation(selectedEdgeId);
            selectEdge(null);
            return;
          }
          const parts = selectedEdgeId.split("|");
          if (parts.length >= 4) {
            const relId = parts[parts.length - 1];
            if (graph?.relations.some((r) => r.id === relId)) {
              removeRelation(relId);
              selectEdge(null);
              return;
            }
          }
          if (parts.length >= 2) {
            const [source, target] = parts;
            const type = parts.length >= 3 ? parts[2] : null;
            const matches = (graph?.relations ?? []).filter((r) =>
              r.source === source && r.target === target && (!type || r.type === type),
            );
            matches.forEach((r) => removeRelation(r.id));
          }
          selectEdge(null);
        },
      },
      {
        id: "open-settings",
        label: "Diagram Settings öffnen",
        kind: "ui",
        keywords: ["settings", "inspector", "diagram"],
        run: () => {
          if (inspectorCollapsed) toggleInspector();
          selectSymbol(null);
          selectEdge(null);
          dispatchInspectorCommand("open-settings");
        },
      },
      {
        id: "apply-layout",
        label: "Layout anwenden",
        kind: "layout",
        keywords: ["layout", "apply", "elk"],
        run: () => applyDiagramLayout(),
      },
      {
        id: "reset-diagram-settings",
        label: "Diagram Settings zurücksetzen",
        kind: "layout",
        keywords: ["settings", "reset", "default"],
        run: () => resetDiagramSettings(),
      },
    ];

    for (const project of projects) {
      list.push({
        id: `switch-project:${project.projectPath}`,
        label: `Projekt öffnen: ${project.name}`,
        kind: "project",
        summary: project.projectPath,
        keywords: ["switch", "project", "open", project.name, project.projectPath],
        disabled: project.projectPath === activeProjectPath,
        run: () => dispatchSidebarCommand("switch-project", project.projectPath),
      });
      list.push({
        id: `delete-project:${project.projectPath}`,
        label: `Projekt löschen: ${project.name}`,
        kind: "project",
        summary: project.projectPath,
        keywords: ["delete", "remove", "project", project.name, project.projectPath],
        run: () => {
          if (!window.confirm(`Projekt "${project.name}" wirklich löschen?`)) return;
          dispatchSidebarCommand("delete-project", project.projectPath);
        },
      });
    }

    return list;
  }, [
    activeProjectPath,
    aiRunning,
    aiRunKind,
    applyDiagramLayout,
    canResume,
    currentViewId,
    graph,
    historyCanRedo,
    historyCanUndo,
    inspectorCollapsed,
    projects,
    redoGraphChange,
    removeRelation,
    removeSymbol,
    resetDiagramSettings,
    selectEdge,
    selectSymbol,
    selectedEdgeId,
    selectedSymbolId,
    syncGraphToServer,
    toggleInspector,
    undoGraphChange,
  ]);

  const actionResults = useMemo(() => {
    if (!isActionMode) return [] as ActionCommand[];
    if (!actionQuery) return commands;
    return commands.filter((cmd) => {
      const haystack = [
        cmd.label,
        cmd.kind,
        cmd.summary ?? "",
        ...(cmd.keywords ?? []),
      ].join(" ").toLowerCase();
      return haystack.includes(actionQuery);
    });
  }, [actionQuery, commands, isActionMode]);

  useEffect(() => {
    setActiveIndex(0);
  }, [actionResults.length, isActionMode, query, symbolResults.length]);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, actionResults.length, isActionMode, symbolResults.length]);

  const selectSymbolResult = useCallback(
    (sym: Sym) => {
      goToSymbol(sym.id);
      close();
    },
    [close],
  );

  const runCommand = useCallback((cmd: ActionCommand | undefined) => {
    if (!cmd || cmd.disabled) return;
    close();
    cmd.run();
  }, [close]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const resultCount = isActionMode ? actionResults.length : symbolResults.length;
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, Math.max(0, resultCount - 1)));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (isActionMode) {
            runCommand(actionResults[activeIndex]);
          } else if (symbolResults[activeIndex]) {
            selectSymbolResult(symbolResults[activeIndex]);
          }
          break;
        default:
          break;
      }
    },
    [actionResults, activeIndex, close, isActionMode, runCommand, selectSymbolResult, symbolResults],
  );

  const showResults = isActionMode || searchQuery.length >= 1;
  const clearTo = isActionMode ? ">" : "";
  const iconClass = isActionMode ? "bi bi-terminal cmd-palette__icon" : "bi bi-search cmd-palette__icon";
  const placeholder = isActionMode
    ? "> Aktion ausführen…"
    : "Symbol suchen…  (\">\" für Aktionen)";

  if (!open) return null;

  return (
    <div className="cmd-palette-backdrop" ref={backdropRef} onMouseDown={(e) => {
      if (e.target === backdropRef.current) close();
    }}>
      <div className="cmd-palette">
        <div className="cmd-palette__input-wrap">
          <i className={iconClass} />
          <input
            ref={inputRef}
            className="cmd-palette__input"
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {query && (
            <button className="cmd-palette__clear" onClick={() => { setQuery(clearTo); inputRef.current?.focus(); }}>
              <i className="bi bi-x-lg" />
            </button>
          )}
          <kbd className="cmd-palette__kbd">Esc</kbd>
        </div>

        {showResults && (
          <div className="cmd-palette__results" ref={listRef}>
            {!isActionMode && symbolResults.length === 0 && (
              <div className="cmd-palette__empty">Keine Ergebnisse</div>
            )}

            {!isActionMode && symbolResults.length > 0 && symbolResults.map((sym, idx) => {
              const badge = KIND_BADGE[sym.kind] ?? { letter: sym.kind[0]?.toUpperCase() ?? "?", color: "#888" };
              return (
                <div
                  key={sym.id}
                  className={`cmd-palette__result${idx === activeIndex ? " cmd-palette__result--active" : ""}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSymbolResult(sym);
                  }}
                >
                  <span
                    className="kind-badge"
                    style={{ background: `${badge.color}22`, color: badge.color }}
                    title={sym.kind}
                  >
                    {badge.letter}
                  </span>
                  <span className="cmd-palette__result-label">{sym.label}</span>
                  <span className="cmd-palette__result-kind">{sym.kind}</span>
                  {sym.doc?.summary && (
                    <span className="cmd-palette__result-summary">{sym.doc.summary}</span>
                  )}
                </div>
              );
            })}

            {isActionMode && actionResults.length === 0 && (
              <div className="cmd-palette__empty">Keine Aktionen gefunden</div>
            )}

            {isActionMode && actionResults.length > 0 && actionResults.map((cmd, idx) => (
              <div
                key={cmd.id}
                className={`cmd-palette__result${idx === activeIndex ? " cmd-palette__result--active" : ""}${cmd.disabled ? " cmd-palette__result--disabled" : ""}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  runCommand(cmd);
                }}
              >
                <span className="cmd-palette__result-label">{cmd.label}</span>
                <span className="cmd-palette__result-kind">{cmd.kind}</span>
                {cmd.summary && (
                  <span className="cmd-palette__result-summary">{cmd.summary}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
