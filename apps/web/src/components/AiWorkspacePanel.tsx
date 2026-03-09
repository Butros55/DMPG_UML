import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UmlReferenceAutorefactorOptions } from "@dmpg/shared";
import {
  cancelAnalysis,
  fetchAnalyzeStatus,
  fetchGraph,
  pauseAnalysis,
  startAnalysis,
  startViewWorkspaceRun,
  undoReferenceDrivenAutorefactor,
  type AnalyzeEvent,
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
  const logRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    fetchAnalyzeStatus()
      .then((status) => setCanResume(!!status.canResume && !status.running))
      .catch(() => setCanResume(false));
  }, []);

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

  const handleStartProjectAnalysis = useCallback(async (resume = false) => {
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
  }, [analyzeScope, currentViewId, handlePrepareRun, handleProjectAnalysisEvent, startAiAnalysis]);

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
    referenceFile,
    referenceInstruction,
    referenceOptions,
    startAiAnalysis,
    workspaceViewId,
  ]);

  const handleStartRequestedRun = useCallback(async (resume = false) => {
    if (analyzeScope === "all") {
      await handleStartProjectAnalysis(resume);
      return;
    }
    await handleStartViewWorkspace();
  }, [analyzeScope, handleStartProjectAnalysis, handleStartViewWorkspace]);

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
          <span className={`ai-provider-badge ai-provider-badge--${aiProvider}`}>
            {aiProvider === "local" ? <><i className="bi bi-pc-display" /> Lokal</> : <><i className="bi bi-cloud" /> Cloud</>}
          </span>
          {ollamaModel && <span className="ai-provider-model">{ollamaModel}</span>}
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
              disabled={!graph || (analyzeScope === "view" && !workspaceViewId)}
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
          {aiAnalysis.running && (
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

          {!aiAnalysis.running && aiAnalysis.phase === "done" && activeRunKind === "project_analysis" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--green)" }}>
              <i className="bi bi-check-circle" /> Analyse abgeschlossen
            </div>
          )}
          {!aiAnalysis.running && aiAnalysis.phase === "done" && activeRunKind === "view_workspace" && (
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
          {!aiAnalysis.running && aiAnalysis.phase === "paused" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--cyan, #66d9ef)" }}>
              <i className="bi bi-pause-circle" /> Analyse pausiert
            </div>
          )}
          {!aiAnalysis.running && aiAnalysis.phase === "cancelled" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--yellow)" }}>
              <i className="bi bi-slash-circle" /> Lauf abgebrochen
            </div>
          )}
          {!aiAnalysis.running && aiAnalysis.phase === "stopped" && (
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--yellow)" }}>
              <i className="bi bi-stop-circle" /> Lauf gestoppt
            </div>
          )}

          {activeRunKind === "project_analysis" && aiAnalysis.log.some((entry) => entry.phase === "done" || entry.phase === "cancelled" || entry.phase === "paused") && (() => {
            const stats = (aiAnalysis.log.find((entry) => entry.phase === "done")
              ?? aiAnalysis.log.find((entry) => entry.phase === "paused")
              ?? aiAnalysis.log.find((entry) => entry.phase === "cancelled"))?.stats;
            return stats ? (
              <div className="ai-stats">
                <div className="ai-stat"><span><i className="bi bi-pencil" /></span><span className="num">{stats.labelsFixed ?? 0}</span> Labels</div>
                <div className="ai-stat"><span><i className="bi bi-file-text" /></span><span className="num">{stats.docsGenerated ?? 0}</span> Docs</div>
                <div className="ai-stat"><span><i className="bi bi-link-45deg" /></span><span className="num">{stats.relationsAdded ?? 0}</span> Relations</div>
                <div className="ai-stat"><span><i className="bi bi-x-circle" /></span><span className="num">{stats.deadCodeFound ?? 0}</span> Dead Code</div>
                <div className="ai-stat"><span><i className="bi bi-collection" /></span><span className="num">{stats.groupsReviewed ?? 0}</span> Gruppen</div>
              </div>
            ) : null;
          })()}

          {!aiAnalysis.running && activeRunKind === "project_analysis" && (aiAnalysis.phase === "done" || aiAnalysis.phase === "cancelled" || aiAnalysis.phase === "paused" || aiAnalysis.phase === "stopped") && (
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

          <div className="ai-log-entries" ref={logRef}>
            {(aiAnalysis.log ?? [])
              .filter((entry) => entry.action !== "poll-progress")
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
        </div>
      )}

      <ReviewHintsPanel embedded />
    </div>
  );
}
