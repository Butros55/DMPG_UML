import { useCallback, useMemo, useState } from "react";
import type { ReviewItemStatus } from "@dmpg/shared";
import { buildReviewHighlightRequest, resolveReviewEntryTargets } from "../reviewFocus";
import {
  filterReviewItems,
  normalizeViewReviewPanel,
  updateReviewEntityStatus,
  type ReviewActionViewModel,
  type ReviewFilterKey,
  type ReviewHintViewModel,
} from "../reviewHints";
import { useAppStore } from "../store";

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
            title={canResolveTarget ? "Betroffene Symbole oder Gruppen fokussieren" : "Keine verknuepften Symbole"}
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

interface ReviewHintsPanelProps {
  embedded?: boolean;
}

export function ReviewHintsPanel({ embedded = false }: ReviewHintsPanelProps) {
  const graph = useAppStore((state) => state.graph);
  const currentViewId = useAppStore((state) => state.currentViewId);
  const reviewHighlight = useAppStore((state) => state.reviewHighlight);
  const updateView = useAppStore((state) => state.updateView);
  const activateReviewHighlight = useAppStore((state) => state.activateReviewHighlight);
  const previewReviewHighlight = useAppStore((state) => state.previewReviewHighlight);
  const clearReviewHighlight = useAppStore((state) => state.clearReviewHighlight);

  const [filter, setFilter] = useState<ReviewFilterKey>("all");
  const [showDismissed, setShowDismissed] = useState(false);

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

  if (!panel) {
    return (
      <div className={`sidebar-section review-panel${embedded ? " review-panel--embedded" : ""}`}>
        <h2>Review</h2>
        <div className="review-panel-empty">No current view loaded.</div>
      </div>
    );
  }

  return (
    <div className={`sidebar-section review-panel${embedded ? " review-panel--embedded" : ""}`}>
      <div className="review-panel__header">
        <div>
          <h2>{embedded ? "Workspace Results" : "Review Hints"}</h2>
          <div className="review-panel__subtitle">{panel.viewTitle}</div>
        </div>
        <div className="review-panel__summary">
          <span className="review-count review-count--high">{panel.counts.high} high</span>
          <span className="review-count review-count--medium">{panel.counts.medium} medium</span>
          <span className="review-count review-count--low">{panel.counts.low} low</span>
        </div>
      </div>

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
