import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectAnalysisFinding, UmlReferenceAutorefactorOptions } from "@dmpg/shared";
import {
  cancelAnalysis,
  fetchLocalOllamaModels,
  fetchAnalyzeStatus,
  fetchGraph,
  getPreferredLocalAiModel,
  openInIde,
  setPreferredLocalAiModel,
  pauseAnalysis,
  startAnalysis,
  startViewWorkspaceRun,
  undoReferenceDrivenAutorefactor,
  type AnalyzeEvent,
  type LocalOllamaModel,
} from "../api";
import {
  captureCurrentViewAsVisionImage,
  DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION,
  DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS,
  fileToVisionImageInput,
} from "../referenceAutorefactor";
import { useAppStore } from "../store";
import { bestNavigableViewForSymbol, isTechnicalNavigationView, resolveNavigableViewId } from "../viewNavigation";
import { formatViewTitle } from "../viewTitles";
import { ReviewHintsPanel } from "./ReviewHintsPanel";

function stepLabel(step?: AnalyzeEvent["step"]) {
  switch (step) {
    case "structure":
      return "Struktur";
    case "context":
      return "Kontext";
    case "labels":
      return "Labels";
    case "reference":
      return "Referenz";
    default:
      return "Workspace";
  }
}

function phaseLabel(event?: AnalyzeEvent | null) {
  if (!event) return "Startet";
  if (event.runKind === "view_workspace" && event.step) {
    return stepLabel(event.step);
  }
  if (event.phase === "dead-code") {
    return "Code Hygiene";
  }
  return event.phase || "Startet";
}

function latestEventForRun(log: AnalyzeEvent[] | undefined, runKind: "project_analysis" | "view_workspace") {
  return [...(log ?? [])].reverse().find((entry) => (entry.runKind ?? "project_analysis") === runKind) ?? null;
}

function latestProgressEvent(log: AnalyzeEvent[] | undefined, runKind: "project_analysis" | "view_workspace") {
  return [...(log ?? [])].reverse().find((entry) =>
    (entry.runKind ?? "project_analysis") === runKind &&
    (entry.action === "progress" || entry.action === "saved" || entry.action === "poll-progress"),
  ) ?? null;
}

function findingTypeLabel(finding: ProjectAnalysisFinding) {
  if (finding.type === "commented_out_code") return "Auskommentiert";
  if (finding.deadCodeKind === "unused_symbol") return "Ungenutztes Symbol";
  if (finding.deadCodeKind === "unreachable_code") return "Unerreichbar";
  return "Dead Code";
}

function findingLocationLabel(finding: ProjectAnalysisFinding) {
  const end = finding.endLine && finding.endLine !== finding.startLine ? `-${finding.endLine}` : "";
  return `${finding.file}:${finding.startLine}${end}`;
}

function renderProjectAnalysisLogEntry(ev: AnalyzeEvent) {
  if (ev.action === "start") {
    return <span>Phase gestartet…</span>;
  }
  if (ev.action === "error" || ev.phase === "error") {
    return <span style={{ color: "var(--red)" }}><i className="bi bi-exclamation-triangle" /> {ev.message ?? "Fehler"}</span>;
  }
  if (ev.phase === "labels" && !ev.action) {
    return <span><i className="bi bi-pencil" /> {ev.old} → {ev.new_}</span>;
  }
  if (ev.phase === "docs" && ev.action === "generated") {
    return <span><i className="bi bi-file-text" /> {ev.symbolLabel}: {ev.summary?.slice(0, 60)}</span>;
  }
  if (ev.phase === "relations" && ev.action === "added") {
    return <span><i className="bi bi-link-45deg" /> +{ev.relationType}: {ev.sourceLabel} → {ev.targetLabel}</span>;
  }
  if (ev.phase === "dead-code" && ev.action === "unreachable") {
    return <span><i className="bi bi-sign-turn-slight-right-fill" /> {ev.symbolLabel ?? ev.file} — {ev.reason}</span>;
  }
  if (ev.phase === "dead-code" && ev.action === "commented-out") {
    return <span><i className="bi bi-chat-left-quote" /> {ev.file}:{ev.startLine} — {ev.reason}</span>;
  }
  if (ev.phase === "dead-code" && !ev.action) {
    return <span><i className="bi bi-x-circle" /> {ev.symbolLabel} — {ev.reason}</span>;
  }
  if (ev.phase === "structure" && ev.action === "rename") {
    return <span><i className="bi bi-collection" /> {ev.old} → {ev.new_}</span>;
  }
  if (ev.phase === "structure" && ev.action === "move") {
    return <span><i className="bi bi-collection" /> {ev.moduleLabel}: {ev.fromGroup} → {ev.toGroup}</span>;
  }
  if (ev.phase === "structure" && ev.action === "merge") {
    return <span><i className="bi bi-collection" /> {ev.sourceGroup} → {ev.targetGroup}</span>;
  }
  if (ev.phase === "structure" && ev.action === "split") {
    return <span><i className="bi bi-scissors" /> {ev.groupLabel} → {ev.subGroupCount} Sub-Gruppen</span>;
  }
  if (ev.phase === "structure" && ev.action === "split-subgroup") {
    return <span><i className="bi bi-box" /> {ev.parentGroup} → {ev.subGroupLabel} ({ev.moduleCount})</span>;
  }
  if (ev.phase === "done") {
    return <span><i className="bi bi-check-circle" /> Fertig!</span>;
  }
  if (ev.phase === "cancelled") {
    return <span><i className="bi bi-slash-circle" /> Abgebrochen</span>;
  }
  if (ev.phase === "paused") {
    return <span><i className="bi bi-pause-circle" /> Pausiert</span>;
  }
  return <span>{ev.message ?? ev.phase}</span>;
}

function renderWorkspaceLogEntry(ev: AnalyzeEvent) {
  if (ev.phase === "done") {
    return <span><i className="bi bi-check-circle" /> {ev.message ?? "Workspace abgeschlossen"}</span>;
  }
  if (ev.phase === "error") {
    return <span style={{ color: "var(--red)" }}><i className="bi bi-x-octagon" /> {ev.message ?? "Workspace fehlgeschlagen"}</span>;
  }
  if (ev.action === "saved") {
    return (
      <span>
        <i className="bi bi-magic" /> {stepLabel(ev.step)}: {ev.message}
      </span>
    );
  }
  if (ev.action === "skipped") {
    return (
      <span>
        <i className="bi bi-skip-forward-circle" /> {stepLabel(ev.step)}: {ev.message}
      </span>
    );
  }
  if (ev.action === "progress") {
    return (
      <span>
        <i className="bi bi-arrow-repeat" /> {stepLabel(ev.step)}: {ev.message}
      </span>
    );
  }
  if (ev.action === "start") {
    return <span><i className="bi bi-stars" /> {ev.message ?? "Workspace startet"}</span>;
  }
  return <span>{ev.message ?? ev.phase}</span>;
}

export function AiWorkspacePanel({
  aiProvider,
  ollamaModel,
}: {
  aiProvider: string;
  ollamaModel: string;
}) {
  const graph = useAppStore((state) => state.graph);
  const currentViewId = useAppStore((state) => state.currentViewId);
  const selectedSymbolId = useAppStore((state) => state.selectedSymbolId);
  const aiAnalysis = useAppStore((state) => state.aiAnalysis);
  const addAiEvent = useAppStore((state) => state.addAiEvent);
  const startAiAnalysis = useAppStore((state) => state.startAiAnalysis);
  const stopAiAnalysis = useAppStore((state) => state.stopAiAnalysis);
  const updateGraph = useAppStore((state) => state.updateGraph);
  const clearReviewHighlight = useAppStore((state) => state.clearReviewHighlight);
  const exitValidateMode = useAppStore((state) => state.exitValidateMode);
  const resetPlaybackQueue = useAppStore((state) => state.resetPlaybackQueue);
  const navigateToView = useAppStore((state) => state.navigateToView);
  const setFocusNode = useAppStore((state) => state.setFocusNode);
  const openSourceViewer = useAppStore((state) => state.openSourceViewer);

  const [analyzeScope, setAnalyzeScope] = useState<"all" | "view">("all");
  const [canResume, setCanResume] = useState(false);
  const [abortFn, setAbortFn] = useState<(() => void) | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceInstruction, setReferenceInstruction] = useState(DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION);
  const [referenceOptions, setReferenceOptions] = useState<Required<UmlReferenceAutorefactorOptions>>(DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS);
  const [includeStructure, setIncludeStructure] = useState(true);
  const [includeContext, setIncludeContext] = useState(true);
  const [includeLabels, setIncludeLabels] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [selectedLocalModel, setSelectedLocalModel] = useState(() => getPreferredLocalAiModel() || ollamaModel);
  const [localModelMenuOpen, setLocalModelMenuOpen] = useState(false);
  const [localModels, setLocalModels] = useState<LocalOllamaModel[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelsError, setLocalModelsError] = useState("");
  const [localModelsCheckedAt, setLocalModelsCheckedAt] = useState("");
  const [runLogExpanded, setRunLogExpanded] = useState(true);
  const [deadCodeExpanded, setDeadCodeExpanded] = useState(true);
  const [commentedCodeExpanded, setCommentedCodeExpanded] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const localModelMenuRef = useRef<HTMLDivElement>(null);

  const activeRunKind = aiAnalysis?.runKind ?? "project_analysis";
  const projectAnalysisActive = !!aiAnalysis?.running && activeRunKind === "project_analysis";
  const lastWorkspaceEvent = useMemo(() => latestEventForRun(aiAnalysis?.log, "view_workspace"), [aiAnalysis?.log]);
  const lastWorkspaceProgress = useMemo(() => latestProgressEvent(aiAnalysis?.log, "view_workspace"), [aiAnalysis?.log]);
  const lastProjectProgress = useMemo(() => latestProgressEvent(aiAnalysis?.log, "project_analysis"), [aiAnalysis?.log]);
  const workspaceViewId = useMemo(() => {
    if (!graph) return currentViewId;

    const currentView = currentViewId
      ? graph.views.find((view) => view.id === currentViewId) ?? null
      : null;
    if (currentView && !isTechnicalNavigationView(graph, currentView)) {
      return currentView.id;
    }

    if (selectedSymbolId) {
      const symbolViewId = bestNavigableViewForSymbol(graph, selectedSymbolId, { currentViewId });
      if (symbolViewId) return symbolViewId;
    }

    return resolveNavigableViewId(graph, currentViewId, graph.rootViewId);
  }, [currentViewId, graph, selectedSymbolId]);
  const currentViewTitle = useMemo(
    () => formatViewTitle(
      graph?.views.find((view) => view.id === workspaceViewId)?.title,
      workspaceViewId ?? "Kein View ausgewaehlt",
    ),
    [workspaceViewId, graph?.views],
  );
  const localModelMissing = aiProvider === "local" && !selectedLocalModel.trim();
  const selectedLocalModelVisible = selectedLocalModel
    ? localModels.some((model) => model.name === selectedLocalModel)
    : false;
  const analysisFindings = useMemo(
    () => [...(graph?.analysisFindings ?? [])].sort((left, right) =>
      left.type.localeCompare(right.type) ||
      left.file.localeCompare(right.file) ||
      left.startLine - right.startLine,
    ),
    [graph?.analysisFindings],
  );
  const deadCodeFindings = useMemo(
    () => analysisFindings.filter((finding) => finding.type === "dead_code"),
    [analysisFindings],
  );
  const commentedCodeFindings = useMemo(
    () => analysisFindings.filter((finding) => finding.type === "commented_out_code"),
    [analysisFindings],
  );

  const refreshLocalModels = useCallback(async (autoSelectFirst = false) => {
    setLocalModelsLoading(true);
    setLocalModelsError("");
    try {
      const result = await fetchLocalOllamaModels();
      setLocalModels(result.models);
      setLocalModelsCheckedAt(result.checkedAt ?? "");
      setLocalModelsError(result.error ?? "");

      if (autoSelectFirst && !getPreferredLocalAiModel() && !selectedLocalModel && result.models.length > 0) {
        const nextModel = result.models[0].name;
        setSelectedLocalModel(nextModel);
        setPreferredLocalAiModel(nextModel);
      }
    } catch (error) {
      setLocalModels([]);
      setLocalModelsCheckedAt("");
      setLocalModelsError(error instanceof Error ? error.message : "Lokale Ollama-Modelle konnten nicht geladen werden.");
    } finally {
      setLocalModelsLoading(false);
    }
  }, [selectedLocalModel]);

  useEffect(() => {
    fetchAnalyzeStatus()
      .then((status) => setCanResume(!!status.canResume && !status.running))
      .catch(() => setCanResume(false));
  }, []);

  useEffect(() => {
    const preferredModel = getPreferredLocalAiModel();
    if (preferredModel) {
      setSelectedLocalModel((current) => current === preferredModel ? current : preferredModel);
      return;
    }

    if (aiProvider === "local" && ollamaModel && !selectedLocalModel) {
      setSelectedLocalModel(ollamaModel);
      setPreferredLocalAiModel(ollamaModel);
    }
  }, [aiProvider, ollamaModel, selectedLocalModel]);

  useEffect(() => {
    if (aiProvider !== "local" || selectedLocalModel) return;
    void refreshLocalModels(true);
  }, [aiProvider, refreshLocalModels, selectedLocalModel]);

  useEffect(() => {
    if (aiAnalysis?.running) return;
    if (activeRunKind !== "project_analysis") return;
    fetchAnalyzeStatus()
      .then((status) => setCanResume(!!status.canResume && !status.running))
      .catch(() => {});
  }, [activeRunKind, aiAnalysis?.phase, aiAnalysis?.running]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [aiAnalysis?.log.length]);

  useEffect(() => {
    if (!localModelMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!localModelMenuRef.current?.contains(event.target as Node)) {
        setLocalModelMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLocalModelMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [localModelMenuOpen]);

  const handlePrepareRun = useCallback(async () => {
    exitValidateMode();
    resetPlaybackQueue();
    setWorkspaceError("");
    try {
      const freshGraph = await fetchGraph();
      updateGraph(freshGraph);
    } catch {
      // Keep the current in-memory graph if the refresh fails.
    }
  }, [exitValidateMode, resetPlaybackQueue, updateGraph]);

  const handleProjectAnalysisEvent = useCallback((event: AnalyzeEvent) => {
    addAiEvent({ ...event, runKind: "project_analysis" });
    if (event.phase === "paused" || event.phase === "cancelled" || event.phase === "error") {
      setCanResume(true);
    }
  }, [addAiEvent]);

  const handleWorkspaceEvent = useCallback((event: AnalyzeEvent) => {
    addAiEvent({ ...event, runKind: "view_workspace" });
    if (event.phase === "error") {
      setWorkspaceError(event.message ?? "Workspace run failed");
    }
  }, [addAiEvent]);

  const handleSelectLocalModel = useCallback((model: string) => {
    setSelectedLocalModel(model);
    setPreferredLocalAiModel(model);
    setLocalModelMenuOpen(false);
    setWorkspaceError("");
  }, []);

  const handleToggleLocalModelMenu = useCallback(() => {
    if (aiProvider !== "local" || !!aiAnalysis?.running) return;

    setLocalModelMenuOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        void refreshLocalModels(!selectedLocalModel.trim());
      }
      return nextOpen;
    });
  }, [aiAnalysis?.running, aiProvider, refreshLocalModels, selectedLocalModel]);

  const handleStartProjectAnalysis = useCallback(async (resume = false) => {
    if (localModelMissing) {
      setWorkspaceError("Bitte zuerst ein laufendes Ollama-Modell auswaehlen.");
      return;
    }

    await handlePrepareRun();
    startAiAnalysis("project_analysis");
    setCanResume(false);

    const viewId = analyzeScope === "view" ? currentViewId ?? undefined : undefined;
    const abort = startAnalysis(
      handleProjectAnalysisEvent,
      (err) => {
        handleProjectAnalysisEvent({
          runKind: "project_analysis",
          phase: "error",
          message: err.message ?? "Verbindungsfehler",
        });
        setCanResume(true);
      },
      viewId,
      resume,
    );
    setAbortFn(() => abort);
  }, [analyzeScope, currentViewId, handlePrepareRun, handleProjectAnalysisEvent, localModelMissing, startAiAnalysis]);

  const handleStartViewWorkspace = useCallback(async () => {
    if (!workspaceViewId) {
      setWorkspaceError("Keine gueltige View aus dem Views-Tree ausgewaehlt.");
      return;
    }

    await handlePrepareRun();
    startAiAnalysis("view_workspace");

    try {
      const request = {
        viewId: workspaceViewId,
        includeStructure,
        includeContext,
        includeLabels,
        instruction: referenceFile ? referenceInstruction : undefined,
        options: referenceFile ? referenceOptions : undefined,
      };

      const withReference = referenceFile
        ? {
            ...request,
            currentViewImage: await captureCurrentViewAsVisionImage(),
            referenceImage: await fileToVisionImageInput(referenceFile, "reference_view"),
          }
        : request;

      const abort = startViewWorkspaceRun(
        handleWorkspaceEvent,
        (err) => {
          handleWorkspaceEvent({
            runKind: "view_workspace",
            phase: "error",
            message: err.message ?? "Workspace run failed",
          });
        },
        withReference,
      );
      setAbortFn(() => abort);
    } catch (err) {
      handleWorkspaceEvent({
        runKind: "view_workspace",
        phase: "error",
        message: err instanceof Error ? err.message : "Workspace run failed",
      });
    }
  }, [
    handlePrepareRun,
    handleWorkspaceEvent,
    includeContext,
    includeLabels,
    includeStructure,
    localModelMissing,
    referenceFile,
    referenceInstruction,
    referenceOptions,
    startAiAnalysis,
    workspaceViewId,
  ]);

  const handleStartRequestedRun = useCallback(async (resume = false) => {
    if (localModelMissing) {
      setWorkspaceError("Bitte zuerst ein laufendes Ollama-Modell auswaehlen.");
      return;
    }

    if (analyzeScope === "all") {
      await handleStartProjectAnalysis(resume);
      return;
    }
    await handleStartViewWorkspace();
  }, [analyzeScope, handleStartProjectAnalysis, handleStartViewWorkspace, localModelMissing]);

  const handleStopRun = useCallback(() => {
    if (activeRunKind === "project_analysis") {
      cancelAnalysis().catch(() => {});
    }
    if (abortFn) {
      abortFn();
      setAbortFn(null);
    }
    stopAiAnalysis();
    if (activeRunKind === "project_analysis") {
      setCanResume(true);
    }
    fetch("/api/graph").then((response) => response.json()).then((freshGraph) => updateGraph(freshGraph)).catch(() => {});
  }, [abortFn, activeRunKind, stopAiAnalysis, updateGraph]);

  const handlePauseRun = useCallback(() => {
    if (activeRunKind !== "project_analysis") return;
    pauseAnalysis().catch(() => {});
  }, [activeRunKind]);

  const handleUndoLatestReferenceRun = useCallback(async () => {
    const snapshotId = lastWorkspaceEvent?.undoSnapshotId;
    if (!snapshotId) return;

    try {
      const result = await undoReferenceDrivenAutorefactor(snapshotId);
      updateGraph(result.graph);
      clearReviewHighlight();
      setWorkspaceError("");
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : "Undo failed");
    }
  }, [clearReviewHighlight, lastWorkspaceEvent?.undoSnapshotId, updateGraph]);

  const handleFocusFinding = useCallback((finding: ProjectAnalysisFinding) => {
    if (finding.viewId) {
      navigateToView(finding.viewId);
    }
    if (finding.symbolId) {
      setFocusNode(finding.symbolId);
    }
  }, [navigateToView, setFocusNode]);

  const handleInspectFinding = useCallback((finding: ProjectAnalysisFinding) => {
    if (finding.symbolId && finding.symbolLabel) {
      openSourceViewer(finding.symbolId, finding.symbolLabel);
      return;
    }

    openInIde("vscode", finding.file, finding.startLine).catch((error) => {
      setWorkspaceError(error instanceof Error ? error.message : "Datei konnte nicht geoeffnet werden.");
    });
  }, [openSourceViewer]);

  const handleOpenFindingInIde = useCallback((finding: ProjectAnalysisFinding) => {
    openInIde("vscode", finding.file, finding.startLine).catch((error) => {
      setWorkspaceError(error instanceof Error ? error.message : "Datei konnte nicht geoeffnet werden.");
    });
  }, []);

  useEffect(() => {
    const onWorkspaceCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = detail?.action;
      if (!action) return;

      switch (action) {
        case "ai-start":
          void handleStartRequestedRun(false);
          break;
        case "ai-resume":
          void handleStartRequestedRun(analyzeScope === "all" && canResume);
          break;
        case "ai-pause":
          handlePauseRun();
          break;
        case "ai-stop":
          handleStopRun();
          break;
        default:
          break;
      }
    };

    window.addEventListener("dmpg:ai-workspace-command", onWorkspaceCommand as EventListener);
    return () => window.removeEventListener("dmpg:ai-workspace-command", onWorkspaceCommand as EventListener);
  }, [analyzeScope, canResume, handlePauseRun, handleStartRequestedRun, handleStopRun]);

  return (
    <div className="ai-workspace">
      <div className="sidebar-section">
        <h2 className="ai-workspace__title">AI Workspace</h2>

        <div className="ai-provider-info">
          {aiProvider === "local" ? (
            <div className="ai-provider-picker" ref={localModelMenuRef}>
              <button
                type="button"
                className={`ai-provider-select${localModelMenuOpen ? " ai-provider-select--open" : ""}`}
                onClick={handleToggleLocalModelMenu}
                disabled={!!aiAnalysis?.running}
                aria-haspopup="listbox"
                aria-expanded={localModelMenuOpen}
              >
                <span className={`ai-provider-badge ai-provider-badge--${aiProvider}`}>
                  <i className="bi bi-pc-display" /> Lokal
                </span>
                <span className={`ai-provider-model${selectedLocalModel ? "" : " ai-provider-model--empty"}`}>
                  {selectedLocalModel || "Modell waehlen"}
                </span>
                <span className="ai-provider-select__icon">
                  <i className={`bi ${localModelMenuOpen ? "bi-chevron-up" : "bi-chevron-down"}`} />
                </span>
              </button>

              {localModelMenuOpen && (
                <div className="ai-provider-menu" role="listbox" aria-label="Lokale Ollama-Modelle">
                  {localModelsLoading && (
                    <div className="ai-provider-menu__status">
                      <i className="bi bi-arrow-repeat ai-provider-menu__spinner" /> Lade `ollama ps`…
                    </div>
                  )}
                  {!localModelsLoading && localModelsError && (
                    <div className="ai-provider-menu__status ai-provider-menu__status--error">
                      <i className="bi bi-exclamation-triangle" /> {localModelsError}
                    </div>
                  )}
                  {!localModelsLoading && !localModelsError && localModels.length === 0 && (
                    <div className="ai-provider-menu__status">
                      Keine aktiven Modelle in `ollama ps`.
                    </div>
                  )}
                  {!localModelsLoading && !localModelsError && localModels.map((model) => (
                    <button
                      key={`${model.name}-${model.id ?? "no-id"}`}
                      type="button"
                      className={`ai-provider-menu__item${model.name === selectedLocalModel ? " ai-provider-menu__item--active" : ""}`}
                      onClick={() => handleSelectLocalModel(model.name)}
                      role="option"
                      aria-selected={model.name === selectedLocalModel}
                    >
                      <span className="ai-provider-menu__name">{model.name}</span>
                      <span className="ai-provider-menu__meta">
                        {[model.processor, model.size, model.until].filter(Boolean).join(" • ") || "aktives Modell"}
                      </span>
                    </button>
                  ))}
                  {!localModelsLoading && !localModelsError && selectedLocalModel && localModels.length > 0 && !selectedLocalModelVisible && (
                    <div className="ai-provider-menu__status ai-provider-menu__status--warning">
                      Ausgewaehltes Modell ist aktuell nicht in `ollama ps` sichtbar.
                    </div>
                  )}
                  {!localModelsLoading && localModelsCheckedAt && (
                    <div className="ai-provider-menu__footer">
                      Zuletzt geprueft: {new Date(localModelsCheckedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <span className={`ai-provider-badge ai-provider-badge--${aiProvider}`}>
                <i className="bi bi-cloud" /> Cloud
              </span>
              {ollamaModel && <span className="ai-provider-model">{ollamaModel}</span>}
            </>
          )}
        </div>

        <div className={`ai-provider-hint${aiProvider === "local" && localModelMissing ? " ai-provider-hint--error" : ""}`}>
          {aiProvider === "local"
            ? (localModelMissing
              ? "Waehle ein laufendes Ollama-Modell aus dem Dropdown."
              : "Beim Oeffnen des Dropdowns wird die Liste jedes Mal mit `ollama ps` aktualisiert. Lokal nutzt der Workspace immer genau das ausgewaehlte Modell.")
            : "Cloud-Routing nutzt die hinterlegte Task-Verteilung; Vision-Schritte werden versucht und bei nicht passendem Modell sauber uebersprungen."}
        </div>

        <div className="ai-workspace__summary-grid">
          <div className="ai-workspace__summary-card">
            <span className="ai-workspace__summary-label">Scope</span>
            <strong>{analyzeScope === "all" ? "Gesamtes Projekt" : currentViewTitle}</strong>
          </div>
          <div className="ai-workspace__summary-card">
            <span className="ai-workspace__summary-label">Model</span>
            <strong>{aiProvider === "local" ? (selectedLocalModel || "Nicht gesetzt") : (ollamaModel || "Task-Routing")}</strong>
          </div>
        </div>

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

        {analyzeScope === "view" && (
          <div className="ai-workspace__config-card">
            <div className="ai-workspace__config-header">
              <span className="ai-workspace__config-title">Aktueller View</span>
              <span className="ai-workspace__config-subtitle">{currentViewTitle}</span>
            </div>

            <div className="ai-workspace__step-toggles">
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={includeStructure}
                  onChange={(event) => setIncludeStructure(event.target.checked)}
                  disabled={!!aiAnalysis?.running}
                />
                Struktur pruefen
              </label>
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(event) => setIncludeContext(event.target.checked)}
                  disabled={!!aiAnalysis?.running}
                />
                Kontext pruefen
              </label>
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={includeLabels}
                  onChange={(event) => setIncludeLabels(event.target.checked)}
                  disabled={!!aiAnalysis?.running}
                />
                Labels pruefen
              </label>
            </div>

            <label className="reference-autorefactor-field">
              <span className="reference-autorefactor-field__label">Referenzbild (optional)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp"
                onChange={(event) => {
                  setReferenceFile(event.target.files?.[0] ?? null);
                  setWorkspaceError("");
                }}
                disabled={!!aiAnalysis?.running}
              />
              <span className="reference-autorefactor-field__hint">
                Wenn gesetzt, wird der aktuelle View mit dem Referenzbild verglichen und sichere Aenderungen werden direkt in denselben Workspace-Lauf eingebunden.
              </span>
              {referenceFile && (
                <span className="reference-autorefactor-field__file">
                  <i className="bi bi-image" /> {referenceFile.name}
                </span>
              )}
            </label>

            <label className="reference-autorefactor-field">
              <span className="reference-autorefactor-field__label">Referenz-Instruktion</span>
              <textarea
                className="reference-autorefactor-field__textarea"
                rows={6}
                value={referenceInstruction}
                onChange={(event) => setReferenceInstruction(event.target.value)}
                disabled={!!aiAnalysis?.running || !referenceFile}
              />
            </label>

            <div className="reference-autorefactor-options">
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={referenceOptions.autoApply}
                  onChange={(event) => setReferenceOptions((current) => ({ ...current, autoApply: event.target.checked }))}
                  disabled={!!aiAnalysis?.running || !referenceFile}
                />
                Aenderungen automatisch anwenden
              </label>
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={referenceOptions.allowStructuralChanges}
                  onChange={(event) => setReferenceOptions((current) => ({ ...current, allowStructuralChanges: event.target.checked }))}
                  disabled={!!aiAnalysis?.running || !referenceFile}
                />
                Struktur- und Layer-Aenderungen erlauben
              </label>
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={referenceOptions.allowLabelChanges}
                  onChange={(event) => setReferenceOptions((current) => ({ ...current, allowLabelChanges: event.target.checked }))}
                  disabled={!!aiAnalysis?.running || !referenceFile}
                />
                Label-Aenderungen erlauben
              </label>
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={referenceOptions.allowRelationChanges}
                  onChange={(event) => setReferenceOptions((current) => ({ ...current, allowRelationChanges: event.target.checked }))}
                  disabled={!!aiAnalysis?.running || !referenceFile}
                />
                Relations- und Kontext-Anpassungen erlauben
              </label>
              <label className="reference-autorefactor-option">
                <input
                  type="checkbox"
                  checked={referenceOptions.persistSuggestions}
                  onChange={(event) => setReferenceOptions((current) => ({ ...current, persistSuggestions: event.target.checked }))}
                  disabled={!!aiAnalysis?.running || !referenceFile}
                />
                Ergebnisse als ReviewHints speichern
              </label>
            </div>
          </div>
        )}

        {!aiAnalysis?.running ? (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              className="btn ai-analyze-btn ai-analyze-btn--start"
              onClick={() => void handleStartRequestedRun(false)}
              style={{ flex: 1 }}
              disabled={!graph || (analyzeScope === "view" && !workspaceViewId) || localModelMissing}
            >
              <i className="bi bi-cpu" /> {analyzeScope === "all" ? "AI Analyse starten" : "AI Workspace starten"}
            </button>
            {analyzeScope === "all" && canResume && (
              <button className="btn ai-analyze-btn ai-analyze-btn--resume" onClick={() => void handleStartRequestedRun(true)} style={{ flex: 1 }}>
                <i className="bi bi-play-fill" /> Fortsetzen
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 4 }}>
            {projectAnalysisActive && (
              <button className="btn ai-analyze-btn ai-analyze-btn--pause" onClick={handlePauseRun} style={{ flex: 1 }}>
                <i className="bi bi-pause-fill" /> Pausieren
              </button>
            )}
            <button className="btn ai-analyze-btn ai-analyze-btn--stop" onClick={handleStopRun} style={{ flex: 1 }}>
              <i className="bi bi-stop-fill" /> Stoppen
            </button>
            {projectAnalysisActive && (
              <button
                className={`btn ai-analyze-btn ${aiAnalysis?.navPaused ? "ai-analyze-btn--resume" : "ai-analyze-btn--nav-pause"}`}
                onClick={() => useAppStore.getState().toggleAiNavPaused()}
                title={aiAnalysis?.navPaused ? "Auto-Navigation fortsetzen" : "Auto-Navigation pausieren"}
                style={{ flex: 1 }}
              >
                {aiAnalysis?.navPaused ? <><i className="bi bi-compass" /><i className="bi bi-play-fill" /> Nav</> : <><i className="bi bi-compass" /><i className="bi bi-pause-fill" /> Nav</>}
              </button>
            )}
          </div>
        )}

        {(workspaceError || (lastWorkspaceEvent?.phase === "error" ? lastWorkspaceEvent.message : "")) && (
          <div className="review-panel__error">{workspaceError || lastWorkspaceEvent?.message}</div>
        )}
      </div>

      {aiAnalysis && (
        <div className="sidebar-section ai-log-panel">
          <div className="ai-log-panel__header">
            <div>
              <div className="review-section-title">Laufdetails</div>
              <div className="ai-workspace__run-kind">{activeRunKind === "view_workspace" ? "View Workspace" : "Project Analysis"}</div>
            </div>
            <button
              type="button"
              className="review-item__focus-btn"
              onClick={() => setRunLogExpanded((current) => !current)}
            >
              <i className={`bi ${runLogExpanded ? "bi-chevron-up" : "bi-chevron-down"}`} /> {runLogExpanded ? "Minimieren" : "Oeffnen"}
            </button>
          </div>

          {runLogExpanded && aiAnalysis.running && (
            <div className="ai-workspace__run-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="ai-spinner" />
                <span className={`ai-phase-badge ai-phase-badge--${aiAnalysis.phase}`}>{phaseLabel(activeRunKind === "view_workspace" ? lastWorkspaceProgress : lastProjectProgress)}</span>
                <span className="ai-workspace__run-kind">
                  {activeRunKind === "view_workspace" ? "View Workspace" : "Project Analysis"}
                </span>
              </div>
              {(activeRunKind === "view_workspace" ? lastWorkspaceProgress?.message : lastProjectProgress?.message) && (
                <div className="ai-workspace__run-message">
                  {activeRunKind === "view_workspace" ? lastWorkspaceProgress?.message : lastProjectProgress?.message}
                </div>
              )}
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
              {aiAnalysis.thought && (
                <div className="ai-thought-line">
                  <span className="ai-thought-icon"><i className="bi bi-lightbulb" /></span>
                  <span className="ai-thought-text">{aiAnalysis.thought}</span>
                </div>
              )}
            </div>
          )}

          {runLogExpanded && !aiAnalysis.running && aiAnalysis.phase === "done" && activeRunKind === "project_analysis" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--green)" }}>
              <i className="bi bi-check-circle" /> Analyse abgeschlossen
            </div>
          )}
          {runLogExpanded && !aiAnalysis.running && aiAnalysis.phase === "done" && activeRunKind === "view_workspace" && (
            <div className="ai-workspace-result-card">
              <div className="ai-workspace-result-card__header">
                <span className="review-tag review-tag--source">AI Workspace</span>
                <span className="review-tag review-tag--category">
                  {(lastWorkspaceEvent?.appliedCount ?? 0) > 0 ? "auto-apply" : "review-only"}
                </span>
                <span className="review-tag review-tag--delta">
                  {lastWorkspaceEvent?.appliedCount ?? 0} applied / {lastWorkspaceEvent?.reviewOnlyCount ?? 0} review-only
                </span>
              </div>
              <p className="review-summary-card__text">{lastWorkspaceEvent?.message ?? "AI Workspace abgeschlossen."}</p>
              <div className="review-item__targets">
                <span className="review-item__target-pill">{lastWorkspaceEvent?.targetIds?.length ?? 0} focus targets</span>
                {lastWorkspaceEvent?.focusViewId && (
                  <span className="review-item__target-pill">{lastWorkspaceEvent.focusViewId}</span>
                )}
              </div>
              {lastWorkspaceEvent?.undoSnapshotId && (
                <div className="review-summary-card__actions">
                  <button className="review-item__focus-btn" onClick={handleUndoLatestReferenceRun}>
                    <i className="bi bi-arrow-counterclockwise" /> Letzten Referenz-Lauf rueckgaengig
                  </button>
                </div>
              )}
            </div>
          )}
          {runLogExpanded && !aiAnalysis.running && aiAnalysis.phase === "paused" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--cyan, #66d9ef)" }}>
              <i className="bi bi-pause-circle" /> Analyse pausiert
            </div>
          )}
          {runLogExpanded && !aiAnalysis.running && aiAnalysis.phase === "cancelled" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--yellow)" }}>
              <i className="bi bi-slash-circle" /> Lauf abgebrochen
            </div>
          )}
          {runLogExpanded && !aiAnalysis.running && aiAnalysis.phase === "stopped" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--yellow)" }}>
              <i className="bi bi-stop-circle" /> Lauf gestoppt
            </div>
          )}

          {runLogExpanded && activeRunKind === "project_analysis" && aiAnalysis.log.some((entry) => entry.phase === "done" || entry.phase === "cancelled" || entry.phase === "paused") && (() => {
            const stats = (aiAnalysis.log.find((entry) => entry.phase === "done")
              ?? aiAnalysis.log.find((entry) => entry.phase === "paused")
              ?? aiAnalysis.log.find((entry) => entry.phase === "cancelled"))?.stats;
            return stats ? (
              <div className="ai-stats">
                <div className="ai-stat"><span><i className="bi bi-pencil" /></span><span className="num">{stats.labelsFixed ?? 0}</span> Labels</div>
                <div className="ai-stat"><span><i className="bi bi-file-text" /></span><span className="num">{stats.docsGenerated ?? 0}</span> Docs</div>
                <div className="ai-stat"><span><i className="bi bi-link-45deg" /></span><span className="num">{stats.relationsAdded ?? 0}</span> Relations</div>
                <div className="ai-stat"><span><i className="bi bi-x-circle" /></span><span className="num">{stats.deadCodeFound ?? 0}</span> Dead Code</div>
                <div className="ai-stat"><span><i className="bi bi-chat-left-quote" /></span><span className="num">{stats.commentedOutFound ?? 0}</span> Auskommentiert</div>
                <div className="ai-stat"><span><i className="bi bi-collection" /></span><span className="num">{stats.groupsReviewed ?? 0}</span> Gruppen</div>
              </div>
            ) : null;
          })()}

          {runLogExpanded && !aiAnalysis.running && activeRunKind === "project_analysis" && (aiAnalysis.phase === "done" || aiAnalysis.phase === "cancelled" || aiAnalysis.phase === "paused" || aiAnalysis.phase === "stopped") && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
              <button
                className="btn ai-analyze-btn ai-analyze-btn--validate"
                onClick={() => useAppStore.getState().enterValidateMode()}
                style={{ width: "100%" }}
              >
                <i className="bi bi-patch-check" /> AI-Aenderungen pruefen
              </button>
            </div>
          )}

          {runLogExpanded && (
            <div className="ai-log-entries" ref={logRef}>
            {(aiAnalysis.log ?? [])
              .filter((entry) => entry.action !== "poll-progress" && entry.action !== "focus")
              .slice(-100)
              .map((entry, index) => (
                <div key={index} className="ai-log-entry">
                  <span className={`ai-log-phase ai-log-phase--${entry.phase}`}>{entry.runKind === "view_workspace" && entry.step ? stepLabel(entry.step) : entry.phase}</span>
                  <span className="ai-log-text">
                    {(entry.runKind ?? "project_analysis") === "view_workspace"
                      ? renderWorkspaceLogEntry(entry)
                      : renderProjectAnalysisLogEntry(entry)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sidebar-section ai-code-hygiene">
        <div className="review-panel__header">
          <div>
            <div className="review-section-title">Code Hygiene</div>
            <div className="review-panel__subtitle">Statische Quellcode-Findings fuer Dead Code und auskommentierte Bloecke.</div>
          </div>
          <div className="review-panel__summary">
            <span className="review-count review-count--high">{deadCodeFindings.length} dead</span>
            <span className="review-count review-count--medium">{commentedCodeFindings.length} comments</span>
          </div>
        </div>

        <div className="ai-code-hygiene__sections">
          <div className="ai-code-hygiene__section">
            <button
              type="button"
              className="ai-code-hygiene__toggle"
              onClick={() => setDeadCodeExpanded((current) => !current)}
            >
              <span className="ai-code-hygiene__toggle-main">
                <i className={`bi ${deadCodeExpanded ? "bi-chevron-down" : "bi-chevron-right"}`} />
                Dead Code
              </span>
              <span className="review-tag review-tag--category">{deadCodeFindings.length}</span>
            </button>

            {deadCodeExpanded && (
              deadCodeFindings.length > 0 ? (
                <div className="ai-code-hygiene__list">
                  {deadCodeFindings.map((finding) => (
                    <article key={finding.id} className="ai-code-hygiene__item">
                      <div className="review-item__header">
                        <span className="review-badge review-badge--high">{findingTypeLabel(finding)}</span>
                        {finding.symbolLabel && <span className="review-tag review-tag--source">{finding.symbolLabel}</span>}
                        <span className="review-tag review-tag--confidence">{findingLocationLabel(finding)}</span>
                      </div>
                      <h3 className="review-item__title">{finding.title}</h3>
                      <p className="review-item__message">{finding.summary}</p>
                      {finding.codePreview && (
                        <pre className="ai-code-hygiene__preview"><code>{finding.codePreview}</code></pre>
                      )}
                      <div className="review-item__footer">
                        <div className="review-item__action-buttons">
                          <button
                            className="review-item__focus-btn"
                            onClick={() => handleFocusFinding(finding)}
                            disabled={!finding.symbolId && !finding.viewId}
                          >
                            <i className="bi bi-crosshair2" /> Focus
                          </button>
                          <button className="review-item__focus-btn" onClick={() => handleInspectFinding(finding)}>
                            <i className="bi bi-search" /> Inspect
                          </button>
                          <button className="review-item__focus-btn" onClick={() => handleOpenFindingInIde(finding)}>
                            <i className="bi bi-box-arrow-up-right" /> Open file
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="review-panel-empty">Keine Dead-Code-Findings im aktuellen Graphen.</div>
              )
            )}
          </div>

          <div className="ai-code-hygiene__section">
            <button
              type="button"
              className="ai-code-hygiene__toggle"
              onClick={() => setCommentedCodeExpanded((current) => !current)}
            >
              <span className="ai-code-hygiene__toggle-main">
                <i className={`bi ${commentedCodeExpanded ? "bi-chevron-down" : "bi-chevron-right"}`} />
                Auskommentierter Code
              </span>
              <span className="review-tag review-tag--category">{commentedCodeFindings.length}</span>
            </button>

            {commentedCodeExpanded && (
              commentedCodeFindings.length > 0 ? (
                <div className="ai-code-hygiene__list">
                  {commentedCodeFindings.map((finding) => (
                    <article key={finding.id} className="ai-code-hygiene__item ai-code-hygiene__item--commented">
                      <div className="review-item__header">
                        <span className="review-badge review-badge--medium">{findingTypeLabel(finding)}</span>
                        {finding.symbolLabel && <span className="review-tag review-tag--source">{finding.symbolLabel}</span>}
                        <span className="review-tag review-tag--confidence">{findingLocationLabel(finding)}</span>
                      </div>
                      <h3 className="review-item__title">{finding.title}</h3>
                      <p className="review-item__message">{finding.summary}</p>
                      {finding.codePreview && (
                        <pre className="ai-code-hygiene__preview"><code>{finding.codePreview}</code></pre>
                      )}
                      <div className="review-item__footer">
                        <div className="review-item__action-buttons">
                          <button
                            className="review-item__focus-btn"
                            onClick={() => handleFocusFinding(finding)}
                            disabled={!finding.symbolId && !finding.viewId}
                          >
                            <i className="bi bi-crosshair2" /> Focus
                          </button>
                          <button className="review-item__focus-btn" onClick={() => handleInspectFinding(finding)}>
                            <i className="bi bi-search" /> Inspect
                          </button>
                          <button className="review-item__focus-btn" onClick={() => handleOpenFindingInIde(finding)}>
                            <i className="bi bi-box-arrow-up-right" /> Open file
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="review-panel-empty">Keine auskommentierten Codebloecke erkannt.</div>
              )
            )}
          </div>
        </div>
      </div>

      <ReviewHintsPanel embedded />
    </div>
  );
}
