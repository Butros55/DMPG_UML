import { useCallback, useMemo, useState } from "react";
import type { ReviewItemStatus, UmlReferenceAutorefactorResponse } from "@dmpg/shared";
import {
  fetchGraph,
  improveCurrentViewLabels,
  reviewCurrentViewStructure,
  runReferenceDrivenAutorefactor,
  undoReferenceDrivenAutorefactor,
} from "../api";
import { buildReviewHighlightRequest, resolveReviewEntryTargets } from "../reviewFocus";
import {
  buildReferenceAutorefactorRequest,
  captureCurrentViewAsVisionImage,
  fileToVisionImageInput,
} from "../referenceAutorefactor";
import {
  filterReviewItems,
  normalizeViewReviewPanel,
  updateReviewEntityStatus,
  type ReviewActionViewModel,
  type ReviewFilterKey,
  type ReviewHintViewModel,
} from "../reviewHints";
import { useAppStore } from "../store";
import { ReferenceAutorefactorDialog } from "./ReferenceAutorefactorDialog";

const FILTERS: Array<{ key: ReviewFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "structure", label: "Structure" },
  { key: "context", label: "Context" },
  { key: "labels", label: "Labels" },
  { key: "vision_compare", label: "Vision Compare" },
];

const STATUS_ACTIONS: Array<{ key: ReviewItemStatus; label: string; icon: string }> = [
  { key: "acknowledged", label: "Acknowledge", icon: "bi-eye" },
  { key: "applied", label: "Applied", icon: "bi-check2-square" },
  { key: "dismissed", label: "Dismiss", icon: "bi-x-circle" },
];

function severityLabel(severity: ReviewHintViewModel["severity"]) {
  return severity.toUpperCase();
}

function categoryLabel(category: ReviewHintViewModel["category"]) {
  switch (category) {
    case "missing_element":
      return "Missing Element";
    case "relation_visibility":
      return "Relations";
    default:
      return category.replace(/_/g, " ");
  }
}

function mapSummaryProblemToCategory(
  mainProblem?: "notation" | "grouping" | "relations" | "context" | "layering" | "naming",
): ReviewHintViewModel["category"] {
  switch (mainProblem) {
    case "context":
    case "grouping":
    case "layering":
    case "naming":
    case "notation":
      return mainProblem;
    case "relations":
      return "relation_visibility";
    default:
      return "notation";
  }
}

function formatConfidence(confidence?: number) {
  if (confidence == null) return null;
  return `${Math.round(confidence * 100)}%`;
}

function ReviewStatusButtons({
  status,
  onChange,
}: {
  status: ReviewItemStatus;
  onChange: (next: ReviewItemStatus) => void;
}) {
  return (
    <div className="review-item__status-actions">
      {STATUS_ACTIONS.map((action) => (
        <button
          key={action.key}
          className={`review-item__status-btn${status === action.key ? " review-item__status-btn--active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onChange(action.key);
          }}
          title={action.label}
        >
          <i className={`bi ${action.icon}`} />
        </button>
      ))}
    </div>
  );
}

function TopActionCard({
  action,
  onStatusChange,
  onFocus,
  onOpenView,
  onHoverStart,
  onHoverEnd,
  isActive,
}: {
  action: ReviewActionViewModel;
  onStatusChange: (next: ReviewItemStatus) => void;
  onFocus: () => void;
  onOpenView: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  isActive: boolean;
}) {
  return (
    <div
      className={`review-action-card review-action-card--${action.status}${isActive ? " review-item--active" : ""}`}
      onClick={onFocus}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
    >
      <div className="review-action-card__header">
        <span className="review-action-card__priority">#{action.priority}</span>
        <span className="review-tag review-tag--source">{action.sourceLabel}</span>
        <span className={`review-tag review-tag--status review-tag--status-${action.status}`}>{action.status}</span>
      </div>
      <div className="review-action-card__text">{action.action}</div>
      {(action.targetLabels?.length || action.target) && (
        <div className="review-item__targets">
          {action.target && <span className="review-item__target-pill">{action.target}</span>}
          {action.targetLabels?.map((label) => (
            <span key={label} className="review-item__target-pill">{label}</span>
          ))}
        </div>
      )}
      <div className="review-item__footer">
        <div className="review-item__action-buttons">
          <button className="review-item__focus-btn" onClick={(event) => { event.stopPropagation(); onFocus(); }}>
            <i className="bi bi-crosshair2" /> Focus
          </button>
          <button className="review-item__focus-btn" onClick={(event) => { event.stopPropagation(); onOpenView(); }}>
            <i className="bi bi-box-arrow-up-right" /> Open view
          </button>
        </div>
        <ReviewStatusButtons status={action.status} onChange={onStatusChange} />
      </div>
    </div>
  );
}

function ReviewHintCard({
  item,
  onStatusChange,
  onFocusTarget,
  onOpenView,
  onInspectTarget,
  onHoverStart,
  onHoverEnd,
  isActive,
}: {
  item: ReviewHintViewModel;
  onStatusChange: (next: ReviewItemStatus) => void;
  onFocusTarget: () => void;
  onOpenView: () => void;
  onInspectTarget: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  isActive: boolean;
}) {
  const confidence = formatConfidence(item.confidence);
  const canResolveTarget = !!item.targetIds?.length || !!item.target;

  return (
    <article
      className={`review-item review-item--${item.severity} review-item--${item.status}${isActive ? " review-item--active" : ""}`}
      onClick={onFocusTarget}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
    >
      <div className="review-item__header">
        <span className={`review-badge review-badge--${item.severity}`}>{severityLabel(item.severity)}</span>
        <span className="review-tag review-tag--source">{item.sourceLabel}</span>
        <span className="review-tag review-tag--category">{categoryLabel(item.category)}</span>
        <span className={`review-tag review-tag--status review-tag--status-${item.status}`}>{item.status}</span>
        {confidence && <span className="review-tag review-tag--confidence">{confidence}</span>}
      </div>
      <h3 className="review-item__title">{item.title}</h3>
      <p className="review-item__message">{item.message}</p>
      {item.suggestion && <div className="review-item__suggestion">{item.suggestion}</div>}
      {(item.target || item.targetLabels?.length) && (
        <div className="review-item__targets">
          {item.target && <span className="review-item__target-pill">{item.target}</span>}
          {item.targetLabels?.map((label) => (
            <span key={label} className="review-item__target-pill">{label}</span>
          ))}
        </div>
      )}
      <div className="review-item__footer">
        <div className="review-item__action-buttons">
          <button
            className="review-item__focus-btn"
            onClick={(event) => { event.stopPropagation(); onFocusTarget(); }}
            disabled={!canResolveTarget}
            title={canResolveTarget ? "Betroffene Symbole oder Gruppen fokussieren" : "Keine verknüpften Symbole"}
          >
            <i className="bi bi-crosshair2" /> Focus
          </button>
          <button
            className="review-item__focus-btn"
            onClick={(event) => { event.stopPropagation(); onOpenView(); }}
          >
            <i className="bi bi-box-arrow-up-right" /> Open view
          </button>
          <button
            className="review-item__focus-btn"
            onClick={(event) => { event.stopPropagation(); onInspectTarget(); }}
            disabled={!canResolveTarget}
          >
            <i className="bi bi-search" /> Inspect
          </button>
        </div>
        <ReviewStatusButtons status={item.status} onChange={onStatusChange} />
      </div>
    </article>
  );
}

export function ReviewHintsPanel() {
  const graph = useAppStore((state) => state.graph);
  const currentViewId = useAppStore((state) => state.currentViewId);
  const reviewHighlight = useAppStore((state) => state.reviewHighlight);
  const updateGraph = useAppStore((state) => state.updateGraph);
  const updateView = useAppStore((state) => state.updateView);
  const activateReviewHighlight = useAppStore((state) => state.activateReviewHighlight);
  const previewReviewHighlight = useAppStore((state) => state.previewReviewHighlight);
  const clearReviewHighlight = useAppStore((state) => state.clearReviewHighlight);
  const navigateToView = useAppStore((state) => state.navigateToView);

  const [filter, setFilter] = useState<ReviewFilterKey>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState<"structure" | "labels" | null>(null);
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
  const [autorefactorRunning, setAutorefactorRunning] = useState(false);
  const [lastAutorefactor, setLastAutorefactor] = useState<UmlReferenceAutorefactorResponse | null>(null);
  const [error, setError] = useState("");

  const panel = useMemo(() => normalizeViewReviewPanel(graph, currentViewId), [graph, currentViewId]);

  const filteredItems = useMemo(() => {
    if (!panel) return [];
    return filterReviewItems(panel.items, filter, showDismissed);
  }, [filter, panel, showDismissed]);

  const visibleActions = useMemo(() => {
    if (!panel) return [];
    return panel.topActions.filter((action) => showDismissed || action.status !== "dismissed");
  }, [panel, showDismissed]);

  const compareTargetIds = useMemo(() => {
    if (!panel) return [];
    return Array.from(new Set(
      panel.items
        .filter((item) => item.source === "uml_reference_compare" && item.status !== "dismissed")
        .flatMap((item) => item.targetIds ?? []),
    ));
  }, [panel]);

  const compareSummaryFocusRequest = useMemo(() => {
    if (!panel || compareTargetIds.length === 0) return null;
    return buildReviewHighlightRequest(
      graph,
      currentViewId,
      {
        id: "summary:uml_reference_compare",
        source: "uml_reference_compare",
        category: mapSummaryProblemToCategory(panel.reviewSummary?.mainProblem),
        severity: "high",
        title: "Compare summary",
        message: panel.reviewSummary?.summary ?? "Focus compare findings",
        targetIds: compareTargetIds,
        status: "new",
        sourceLabel: "Professor / Reference Compare",
        storage: { kind: "item", collection: "reviewHints", id: "summary:uml_reference_compare" },
      },
      panel,
      { fitView: true },
    );
  }, [compareTargetIds, currentViewId, graph, panel]);

  const handleStatusUpdate = useCallback((
    storage: ReviewHintViewModel["storage"] | ReviewActionViewModel["storage"],
    nextStatus: ReviewItemStatus,
  ) => {
    if (!graph || !currentViewId) return;
    const view = graph.views.find((candidate) => candidate.id === currentViewId);
    if (!view) return;

    const nextView = updateReviewEntityStatus(view, storage, nextStatus);
    updateView(currentViewId, {
      reviewHints: nextView.reviewHints,
      contextSuggestions: nextView.contextSuggestions,
      labelSuggestions: nextView.labelSuggestions,
      graphSuggestions: nextView.graphSuggestions,
      reviewActions: nextView.reviewActions,
    });
  }, [currentViewId, graph, updateView]);

  const handleActivateEntry = useCallback((
    entry: ReviewHintViewModel | ReviewActionViewModel,
    options: { fitView?: boolean; inspectPrimary?: boolean } = {},
  ) => {
    if (!panel) return;
    const request = buildReviewHighlightRequest(graph, currentViewId, entry, panel, {
      fitView: options.fitView ?? true,
    });
    activateReviewHighlight({
      itemId: request.itemId,
      nodeIds: request.targetIds,
      primaryNodeId: request.primaryTargetId,
      viewId: request.viewId,
      fitView: request.fitView,
      inspectPrimary: options.inspectPrimary ?? true,
    });
  }, [activateReviewHighlight, currentViewId, graph, panel]);

  const handlePreviewEntry = useCallback((entry: ReviewHintViewModel | ReviewActionViewModel) => {
    if (!panel || !graph) return;
    const resolution = resolveReviewEntryTargets(graph, currentViewId, entry, panel);
    if (resolution.viewId !== currentViewId || resolution.targetIds.length === 0) {
      previewReviewHighlight([]);
      return;
    }
    previewReviewHighlight(resolution.targetIds);
  }, [currentViewId, graph, panel, previewReviewHighlight]);

  const handleStructureRefresh = useCallback(async () => {
    if (!currentViewId) return;
    setRefreshing("structure");
    setError("");
    try {
      await reviewCurrentViewStructure(currentViewId, { persist: true, includeContextReview: true });
      const freshGraph = await fetchGraph();
      updateGraph(freshGraph);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Structure review failed");
    } finally {
      setRefreshing(null);
    }
  }, [currentViewId, updateGraph]);

  const handleLabelRefresh = useCallback(async () => {
    if (!currentViewId) return;
    setRefreshing("labels");
    setError("");
    try {
      await improveCurrentViewLabels(currentViewId, { persist: true });
      const freshGraph = await fetchGraph();
      updateGraph(freshGraph);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Label improvement failed");
    } finally {
      setRefreshing(null);
    }
  }, [currentViewId, updateGraph]);

  const handleReferenceAutorefactor = useCallback(async (payload: {
    referenceFile: File;
    instruction: string;
    options: Parameters<typeof buildReferenceAutorefactorRequest>[0]["options"];
  }) => {
    if (!graph || !currentViewId) return;

    setAutorefactorRunning(true);
    setError("");
    try {
      const currentView = graph.views.find((candidate) => candidate.id === currentViewId);
      const currentViewImage = await captureCurrentViewAsVisionImage();
      const referenceImage = await fileToVisionImageInput(payload.referenceFile, "reference_view");
      const request = buildReferenceAutorefactorRequest({
        currentViewImage,
        referenceImage,
        viewId: currentViewId,
        instruction: payload.instruction,
        options: payload.options,
        graphContext: {
          viewId: currentViewId,
          viewTitle: currentView?.title ?? currentViewId,
          currentSummary: panel?.reviewSummary?.summary,
        },
      });
      const result = await runReferenceDrivenAutorefactor(request);
      if (result.graph) {
        updateGraph(result.graph);
      }

      if (result.highlightTargetIds.length > 0 || result.focusViewId) {
        activateReviewHighlight({
          itemId: `reference-autorefactor:${Date.now()}`,
          nodeIds: result.highlightTargetIds,
          primaryNodeId: result.primaryFocusTargetIds[0] ?? result.highlightTargetIds[0] ?? null,
          viewId: result.focusViewId ?? currentViewId,
          fitView: true,
          inspectPrimary: true,
        });
      } else if (result.focusViewId) {
        navigateToView(result.focusViewId);
      }

      setLastAutorefactor(result);
      setReferenceDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reference-driven UML autorefactor failed");
    } finally {
      setAutorefactorRunning(false);
    }
  }, [activateReviewHighlight, currentViewId, graph, navigateToView, panel?.reviewSummary?.summary, updateGraph]);

  const handleUndoAutorefactor = useCallback(async () => {
    const snapshotId = lastAutorefactor?.undoInfo?.snapshotId;
    if (!snapshotId) return;

    setAutorefactorRunning(true);
    setError("");
    try {
      const result = await undoReferenceDrivenAutorefactor(snapshotId);
      updateGraph(result.graph);
      clearReviewHighlight();
      setLastAutorefactor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo for reference-driven UML autorefactor failed");
    } finally {
      setAutorefactorRunning(false);
    }
  }, [clearReviewHighlight, lastAutorefactor?.undoInfo?.snapshotId, updateGraph]);

  if (!panel) {
    return (
      <div className="sidebar-section">
        <h2>Review</h2>
        <div className="review-panel-empty">No current view loaded.</div>
      </div>
    );
  }

  return (
    <div className="sidebar-section review-panel">
      <ReferenceAutorefactorDialog
        open={referenceDialogOpen}
        viewTitle={panel.viewTitle}
        running={autorefactorRunning}
        error={error}
        onClose={() => {
          setReferenceDialogOpen(false);
          setError("");
        }}
        onSubmit={handleReferenceAutorefactor}
      />

      <div className="review-panel__header">
        <div>
          <h2>Review Hints</h2>
          <div className="review-panel__subtitle">{panel.viewTitle}</div>
        </div>
        <div className="review-panel__summary">
          <span className="review-count review-count--high">{panel.counts.high} high</span>
          <span className="review-count review-count--medium">{panel.counts.medium} medium</span>
          <span className="review-count review-count--low">{panel.counts.low} low</span>
        </div>
      </div>

      <div className="review-toolbar review-toolbar--actions">
        <button
          className="btn btn-sm review-toolbar__action"
          onClick={() => {
            setError("");
            setReferenceDialogOpen(true);
          }}
          disabled={!currentViewId || autorefactorRunning}
        >
          <i className="bi bi-magic" /> Mit Referenz anpassen
        </button>
        {lastAutorefactor?.undoInfo && (
          <button
            className="btn btn-sm btn-outline review-toolbar__action"
            onClick={handleUndoAutorefactor}
            disabled={autorefactorRunning}
          >
            <i className="bi bi-arrow-counterclockwise" /> Rückgängig
          </button>
        )}
      </div>

      {lastAutorefactor && (
        <div className={`review-summary-card${lastAutorefactor.compare.isCurrentDiagramTooUiLike ? " review-summary-card--warning" : ""}`}>
          <div className="review-summary-card__header">
            <span className="review-tag review-tag--source">Reference Autorefactor</span>
            <span className="review-tag review-tag--category">
              {lastAutorefactor.autoApplied ? "auto-applied" : "review / dry-run"}
            </span>
            <span className="review-tag review-tag--delta">
              {lastAutorefactor.appliedActions.length} applied / {lastAutorefactor.reviewOnlyActions.length} review-only
            </span>
          </div>
          <p className="review-summary-card__text">{lastAutorefactor.plan.summary}</p>
          <div className="review-item__targets">
            <span className="review-item__target-pill">{lastAutorefactor.changedTargetIds.length} changed targets</span>
            <span className="review-item__target-pill">{lastAutorefactor.changedViewIds.length} changed views</span>
            <span className="review-item__target-pill">{lastAutorefactor.skippedActions.length} skipped</span>
          </div>
          <div className="review-summary-card__actions">
            <button
              className="review-item__focus-btn"
              onClick={() => activateReviewHighlight({
                itemId: `reference-autorefactor:summary:${lastAutorefactor.undoInfo?.applyRunId ?? "latest"}`,
                nodeIds: lastAutorefactor.highlightTargetIds,
                primaryNodeId: lastAutorefactor.primaryFocusTargetIds[0] ?? lastAutorefactor.highlightTargetIds[0] ?? null,
                viewId: lastAutorefactor.focusViewId ?? currentViewId,
                fitView: true,
                inspectPrimary: true,
              })}
            >
              <i className="bi bi-crosshair2" /> Geänderte Stellen fokussieren
            </button>
            {lastAutorefactor.undoInfo && (
              <button
                className="review-item__focus-btn"
                onClick={handleUndoAutorefactor}
                disabled={autorefactorRunning}
              >
                <i className="bi bi-arrow-counterclockwise" /> Letzten Lauf rückgängig
              </button>
            )}
          </div>
        </div>
      )}

      {panel.reviewSummary && (
        <div className={`review-summary-card${panel.reviewSummary.isCurrentDiagramTooUiLike ? " review-summary-card--warning" : ""}`}>
          <div className="review-summary-card__header">
            <span className="review-tag review-tag--source">{panel.reviewSummary.source === "uml_reference_compare" ? "Professor / Reference Compare" : "Review Summary"}</span>
            {panel.reviewSummary.mainProblem && (
              <span className="review-tag review-tag--category">{panel.reviewSummary.mainProblem}</span>
            )}
            {panel.reviewSummary.umlQualityDelta && (
              <span className="review-tag review-tag--delta">{panel.reviewSummary.umlQualityDelta}</span>
            )}
          </div>
          <p className="review-summary-card__text">{panel.reviewSummary.summary}</p>
          {panel.reviewSummary.isCurrentDiagramTooUiLike && (
            <div className="review-summary-card__warning">
              <i className="bi bi-exclamation-triangle" /> The current diagram still reads more like UI cards than UML notation.
            </div>
          )}
          {compareSummaryFocusRequest?.targetIds.length ? (
            <div className="review-summary-card__actions">
              <button
                className="review-item__focus-btn"
                onClick={() => activateReviewHighlight({
                  itemId: compareSummaryFocusRequest.itemId,
                  nodeIds: compareSummaryFocusRequest.targetIds,
                  primaryNodeId: compareSummaryFocusRequest.primaryTargetId,
                  viewId: compareSummaryFocusRequest.viewId,
                  fitView: compareSummaryFocusRequest.fitView,
                })}
              >
                <i className="bi bi-crosshair2" /> Focus compare targets
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className="review-toolbar">
        <div className="review-filters" role="tablist" aria-label="Review filters">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              className={`review-filter-btn${filter === entry.key ? " review-filter-btn--active" : ""}`}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label className="review-toolbar__toggle">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(event) => setShowDismissed(event.target.checked)}
          />
          Show dismissed
        </label>
        <button className="review-item__focus-btn" onClick={clearReviewHighlight}>
          <i className="bi bi-slash-circle" /> Clear highlight
        </button>
      </div>

      <div className="review-toolbar review-toolbar--actions">
        <button
          className="btn btn-sm btn-outline review-toolbar__action"
          onClick={handleStructureRefresh}
          disabled={refreshing !== null}
        >
          <i className="bi bi-arrow-repeat" /> {refreshing === "structure" ? "Running…" : "Re-run structure review"}
        </button>
        <button
          className="btn btn-sm btn-outline review-toolbar__action"
          onClick={handleLabelRefresh}
          disabled={refreshing !== null}
        >
          <i className="bi bi-type" /> {refreshing === "labels" ? "Running…" : "Re-run label review"}
        </button>
      </div>

      {error && <div className="review-panel__error">{error}</div>}

      {visibleActions.length > 0 && (
        <div className="review-top-actions">
          <div className="review-section-title">Top Actions</div>
          <div className="review-top-actions__list">
            {visibleActions.map((action) => (
              <TopActionCard
                key={action.id}
                action={action}
                onStatusChange={(nextStatus) => handleStatusUpdate(action.storage, nextStatus)}
                onFocus={() => handleActivateEntry(action, { fitView: true, inspectPrimary: true })}
                onOpenView={() => handleActivateEntry(action, { fitView: false, inspectPrimary: false })}
                onHoverStart={() => handlePreviewEntry(action)}
                onHoverEnd={() => previewReviewHighlight([])}
                isActive={reviewHighlight.activeItemId === action.id}
              />
            ))}
          </div>
        </div>
      )}

      <div className="review-section-title">
        Review Items <span className="review-section-title__count">{filteredItems.length}</span>
      </div>

      {filteredItems.length === 0 ? (
        <div className="review-panel-empty">
          No review items for the selected filter.
        </div>
      ) : (
        <div className="review-list">
          {filteredItems.map((item) => (
            <ReviewHintCard
              key={item.id}
              item={item}
              onStatusChange={(nextStatus) => handleStatusUpdate(item.storage, nextStatus)}
              onFocusTarget={() => handleActivateEntry(item, { fitView: true, inspectPrimary: true })}
              onOpenView={() => handleActivateEntry(item, { fitView: false, inspectPrimary: false })}
              onInspectTarget={() => handleActivateEntry(item, { fitView: false, inspectPrimary: true })}
              onHoverStart={() => handlePreviewEntry(item)}
              onHoverEnd={() => previewReviewHighlight([])}
              isActive={reviewHighlight.activeItemId === item.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
