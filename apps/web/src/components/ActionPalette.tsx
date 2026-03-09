import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAppStore } from "../store";
import { fetchAnalyzeStatus, fetchProjects, type ProjectMeta } from "../api";

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

export function ActionPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [canResume, setCanResume] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        setQuery("");
        setActiveIndex(0);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    fetchProjects()
      .then((res) => {
        setProjects(res.projects);
        setActiveProjectPath(res.activeProject);
      })
      .catch(() => {
        setProjects([]);
        setActiveProjectPath(null);
      });
    fetchAnalyzeStatus()
      .then((status) => setCanResume(!!status.canResume && !status.running))
      .catch(() => setCanResume(false));
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

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
        label: "AI Analyse starten",
        kind: "ai",
        keywords: ["ai", "analyse", "start"],
        disabled: aiRunning,
        run: () => dispatchSidebarCommand("ai-start"),
      },
      {
        id: "ai-resume",
        label: "AI Analyse fortsetzen",
        kind: "ai",
        keywords: ["ai", "resume", "fortsetzen"],
        disabled: aiRunning || !canResume,
        run: () => dispatchSidebarCommand("ai-resume"),
      },
      {
        id: "ai-pause",
        label: "AI Analyse pausieren",
        kind: "ai",
        keywords: ["ai", "pause", "pausieren"],
        disabled: !aiRunning,
        run: () => dispatchSidebarCommand("ai-pause"),
      },
      {
        id: "ai-stop",
        label: "AI Analyse stoppen",
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

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const haystack = [
        cmd.label,
        cmd.kind,
        cmd.summary ?? "",
        ...(cmd.keywords ?? []),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length]);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const runCommand = useCallback((cmd: ActionCommand | undefined) => {
    if (!cmd || cmd.disabled) return;
    close();
    cmd.run();
  }, [close]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        close();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        runCommand(results[activeIndex]);
        break;
      default:
        break;
    }
  }, [activeIndex, close, results, runCommand]);

  if (!open) return null;

  return (
    <div
      className="cmd-palette-backdrop"
      ref={backdropRef}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) close();
      }}
    >
      <div className="cmd-palette">
        <div className="cmd-palette__input-wrap">
          <i className="bi bi-terminal cmd-palette__icon" />
          <input
            ref={inputRef}
            className="cmd-palette__input"
            type="text"
            placeholder="Aktion ausführen…  (Ctrl+Shift+P)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {query && (
            <button className="cmd-palette__clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
              <i className="bi bi-x-lg" />
            </button>
          )}
          <kbd className="cmd-palette__kbd">Esc</kbd>
        </div>

        <div className="cmd-palette__results" ref={listRef}>
          {results.length === 0 ? (
            <div className="cmd-palette__empty">Keine Aktionen gefunden</div>
          ) : (
            results.map((cmd, idx) => (
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
