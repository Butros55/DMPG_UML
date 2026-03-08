import type {
  DiagramView,
  ProjectGraph,
  ReviewCategory,
  ReviewItemSource,
  ReviewItemStatus,
  ReviewSeverity,
} from "@dmpg/shared";

export type ReviewFilterKey = "all" | "structure" | "context" | "labels" | "vision_compare";

export interface ReviewHintStorageRef {
  kind: "item";
  collection: "reviewHints" | "contextSuggestions" | "labelSuggestions" | "graphSuggestions";
  id: string;
}

export interface ReviewActionStorageRef {
  kind: "action";
  collection: "reviewActions";
  id: string;
}

export interface ReviewHintViewModel {
  id: string;
  source: ReviewItemSource;
  category: ReviewCategory;
  severity: ReviewSeverity;
  title: string;
  message: string;
  suggestion?: string;
  target?: string;
  targetIds?: string[];
  targetLabels?: string[];
  status: ReviewItemStatus;
  confidence?: number;
  createdAt?: string;
  sourceLabel: string;
  storage: ReviewHintStorageRef;
}

export interface ReviewActionViewModel {
  id: string;
  source: ReviewItemSource;
  priority: number;
  action: string;
  target?: string;
  targetIds?: string[];
  targetLabels?: string[];
  status: ReviewItemStatus;
  createdAt?: string;
  sourceLabel: string;
  storage: ReviewActionStorageRef;
}

export interface ReviewSummaryViewModel {
  source: ReviewItemSource;
  summary: string;
  umlQualityDelta?: "better_reference" | "roughly_equal" | "better_current";
  mainProblem?: "notation" | "grouping" | "relations" | "context" | "layering" | "naming";
  isCurrentDiagramTooUiLike?: boolean;
  createdAt?: string;
}

export interface ReviewCounts {
  total: number;
  high: number;
  medium: number;
  low: number;
  unresolved: number;
}

export interface ViewReviewPanelModel {
  viewId: string;
  viewTitle: string;
  items: ReviewHintViewModel[];
  topActions: ReviewActionViewModel[];
  counts: ReviewCounts;
  reviewSummary?: ReviewSummaryViewModel;
}

type ViewReviewHint = NonNullable<DiagramView["reviewHints"]>[number];
type ViewGraphSuggestion = NonNullable<DiagramView["graphSuggestions"]>[number];

const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function getSourceLabel(source: ReviewItemSource): string {
  switch (source) {
    case "structure_review":
      return "Structure Review";
    case "external_context_review":
      return "Context Review";
    case "label_improvement":
      return "Label Improvement";
    case "vision_review":
      return "Vision Review";
    case "uml_reference_compare":
      return "UML Reference Compare";
    default:
      return source;
  }
}

function fallbackIssueCategory(issueType: ViewReviewHint["type"]): ReviewCategory {
  switch (issueType) {
    case "missing_context":
      return "context";
    case "group_too_broad":
    case "group_too_thin":
      return "grouping";
    case "naming_unclear":
      return "naming";
    case "external_dependency_overload":
      return "relation_visibility";
    case "layering_issue":
    case "sparse_view":
    default:
      return "layering";
  }
}

function fallbackIssueTitle(issueType: ViewReviewHint["type"]): string {
  switch (issueType) {
    case "sparse_view":
      return "View too sparse";
    case "missing_context":
      return "Missing external context";
    case "group_too_broad":
      return "Group too broad";
    case "group_too_thin":
      return "Group too thin";
    case "naming_unclear":
      return "Naming unclear";
    case "external_dependency_overload":
      return "Relation visibility weak";
    case "layering_issue":
    default:
      return "Layering issue";
  }
}

function graphSuggestionCategory(type: ViewGraphSuggestion["type"]): ReviewCategory {
  switch (type) {
    case "context_stub_addition":
      return "context";
    case "relation_aggregation":
      return "relation_visibility";
    case "node_type_change":
      return "notation";
    case "view_refactor":
    default:
      return "layering";
  }
}

function graphSuggestionSeverity(type: ViewGraphSuggestion["type"]): ReviewSeverity {
  switch (type) {
    case "node_type_change":
    case "view_refactor":
      return "high";
    case "context_stub_addition":
    case "relation_aggregation":
    default:
      return "medium";
  }
}

function graphSuggestionTitle(type: ViewGraphSuggestion["type"]): string {
  switch (type) {
    case "context_stub_addition":
      return "Add external context";
    case "relation_aggregation":
      return "Aggregate visible relations";
    case "node_type_change":
      return "Adjust UML notation";
    case "view_refactor":
    default:
      return "Refactor current view";
  }
}

function getTargetLabels(graph: ProjectGraph, targetIds?: string[]): string[] | undefined {
  if (!targetIds?.length) return undefined;
  const labels = targetIds
    .map((targetId) => graph.symbols.find((symbol) => symbol.id === targetId)?.label ?? targetId)
    .filter(Boolean);
  return labels.length > 0 ? labels : undefined;
}

function toTimestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortReviewItems(items: readonly ReviewHintViewModel[]): ReviewHintViewModel[] {
  return [...items].sort((left, right) => {
    const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (severityDiff !== 0) return severityDiff;
    const sourceDiff = left.source.localeCompare(right.source);
    if (sourceDiff !== 0) return sourceDiff;
    return toTimestampValue(right.createdAt) - toTimestampValue(left.createdAt);
  });
}

export function filterReviewItems(
  items: readonly ReviewHintViewModel[],
  filter: ReviewFilterKey,
  showDismissed: boolean,
): ReviewHintViewModel[] {
  return items.filter((item) => {
    if (!showDismissed && item.status === "dismissed") return false;
    switch (filter) {
      case "structure":
        return item.source === "structure_review" || item.source === "vision_review";
      case "context":
        return item.source === "external_context_review" || item.category === "context";
      case "labels":
        return item.source === "label_improvement" || item.category === "naming";
      case "vision_compare":
        return item.source === "uml_reference_compare";
      case "all":
      default:
        return true;
    }
  });
}

export function normalizeViewReviewPanel(
  graph: ProjectGraph | null,
  viewId: string | null,
): ViewReviewPanelModel | null {
  if (!graph || !viewId) return null;
  const view = graph.views.find((candidate) => candidate.id === viewId);
  if (!view) return null;

  const reviewHints: ReviewHintViewModel[] = (view.reviewHints ?? []).map((hint, index) => {
    const id = hint.reviewId ?? `reviewHints:${view.id}:${index}`;
    const source = hint.source ?? "structure_review";
    return {
      id,
      source,
      category: hint.category ?? fallbackIssueCategory(hint.type),
      severity: hint.severity,
      title: hint.title ?? fallbackIssueTitle(hint.type),
      message: hint.message,
      suggestion: hint.suggestedAction,
      target: hint.target,
      targetIds: hint.targetIds,
      targetLabels: getTargetLabels(graph, hint.targetIds),
      status: hint.status ?? "new",
      confidence: hint.confidence,
      createdAt: hint.createdAt,
      sourceLabel: getSourceLabel(source),
      storage: {
        kind: "item",
        collection: "reviewHints",
        id,
      },
    };
  });

  const contextHints: ReviewHintViewModel[] = (view.contextSuggestions ?? []).map((suggestion, index) => {
    const id = suggestion.reviewId ?? `contextSuggestions:${view.id}:${index}`;
    const source = suggestion.source ?? "external_context_review";
    return {
      id,
      source,
      category: "context",
      severity: "medium",
      title: `Add context stub for ${suggestion.label}`,
      message: suggestion.reason,
      suggestion: `Expose ${suggestion.label} as an external context node or aggregated dependency.`,
      target: suggestion.label,
      targetIds: suggestion.relatedSymbolIds,
      targetLabels: getTargetLabels(graph, suggestion.relatedSymbolIds),
      status: suggestion.status ?? "new",
      confidence: suggestion.confidence,
      createdAt: suggestion.createdAt,
      sourceLabel: getSourceLabel(source),
      storage: {
        kind: "item",
        collection: "contextSuggestions",
        id,
      },
    };
  });

  const labelHints: ReviewHintViewModel[] = (view.labelSuggestions ?? []).map((improvement, index) => {
    const id = improvement.reviewId ?? `labelSuggestions:${view.id}:${index}`;
    const source = improvement.source ?? "label_improvement";
    return {
      id,
      source,
      category: "naming",
      severity: "low",
      title: `Improve label: ${improvement.oldLabel}`,
      message: improvement.reason ?? `Rename "${improvement.oldLabel}" to improve readability.`,
      suggestion: `${improvement.oldLabel} -> ${improvement.newLabel}`,
      target: improvement.oldLabel,
      targetIds: [improvement.targetId],
      targetLabels: getTargetLabels(graph, [improvement.targetId]),
      status: improvement.status ?? "new",
      confidence: improvement.confidence,
      createdAt: improvement.createdAt,
      sourceLabel: getSourceLabel(source),
      storage: {
        kind: "item",
        collection: "labelSuggestions",
        id,
      },
    };
  });

  const graphHints: ReviewHintViewModel[] = (view.graphSuggestions ?? []).map((suggestion, index) => {
    const id = suggestion.id ?? `graphSuggestions:${view.id}:${index}`;
    const source = suggestion.source ?? "uml_reference_compare";
    return {
      id,
      source,
      category: graphSuggestionCategory(suggestion.type),
      severity: graphSuggestionSeverity(suggestion.type),
      title: graphSuggestionTitle(suggestion.type),
      message: suggestion.message,
      targetIds: suggestion.targetIds,
      targetLabels: getTargetLabels(graph, suggestion.targetIds),
      status: suggestion.status ?? "new",
      confidence: suggestion.confidence,
      createdAt: suggestion.createdAt,
      sourceLabel: getSourceLabel(source),
      storage: {
        kind: "item",
        collection: "graphSuggestions",
        id,
      },
    };
  });

  const items = sortReviewItems([
    ...reviewHints,
    ...contextHints,
    ...labelHints,
    ...graphHints,
  ]);

  const topActions = [...(view.reviewActions ?? [])]
    .map((action, index) => {
      const id = action.id ?? `reviewActions:${view.id}:${index}`;
      const source = action.source ?? "uml_reference_compare";
      return {
        id,
        source,
        priority: action.priority,
        action: action.action,
        target: action.target,
        targetIds: action.targetIds,
        targetLabels: getTargetLabels(graph, action.targetIds),
        status: action.status ?? "new",
        createdAt: action.createdAt,
        sourceLabel: getSourceLabel(source),
        storage: {
          kind: "action" as const,
          collection: "reviewActions" as const,
          id,
        },
      };
    })
    .sort((left, right) => left.priority - right.priority);

  const counts = items.reduce<ReviewCounts>((acc, item) => {
    acc.total += 1;
    acc[item.severity] += 1;
    if (item.status !== "applied" && item.status !== "dismissed") {
      acc.unresolved += 1;
    }
    return acc;
  }, { total: 0, high: 0, medium: 0, low: 0, unresolved: 0 });

  return {
    viewId: view.id,
    viewTitle: view.title,
    items,
    topActions,
    counts,
    reviewSummary: view.reviewSummary ? {
      source: view.reviewSummary.source ?? "uml_reference_compare",
      summary: view.reviewSummary.summary,
      umlQualityDelta: view.reviewSummary.umlQualityDelta,
      mainProblem: view.reviewSummary.mainProblem,
      isCurrentDiagramTooUiLike: view.reviewSummary.isCurrentDiagramTooUiLike,
      createdAt: view.reviewSummary.createdAt,
    } : undefined,
  };
}

export function updateReviewEntityStatus(
  view: DiagramView,
  storage: ReviewHintStorageRef | ReviewActionStorageRef,
  status: ReviewItemStatus,
): DiagramView {
  switch (storage.collection) {
    case "reviewHints":
      return {
        ...view,
        reviewHints: (view.reviewHints ?? []).map((hint) =>
          (hint.reviewId ?? "") === storage.id ? { ...hint, status } : hint
        ),
      };
    case "contextSuggestions":
      return {
        ...view,
        contextSuggestions: (view.contextSuggestions ?? []).map((suggestion) =>
          (suggestion.reviewId ?? "") === storage.id ? { ...suggestion, status } : suggestion
        ),
      };
    case "labelSuggestions":
      return {
        ...view,
        labelSuggestions: (view.labelSuggestions ?? []).map((suggestion) =>
          (suggestion.reviewId ?? "") === storage.id ? { ...suggestion, status } : suggestion
        ),
      };
    case "graphSuggestions":
      return {
        ...view,
        graphSuggestions: (view.graphSuggestions ?? []).map((suggestion) =>
          (suggestion.id ?? "") === storage.id ? { ...suggestion, status } : suggestion
        ),
      };
    case "reviewActions":
      return {
        ...view,
        reviewActions: (view.reviewActions ?? []).map((action) =>
          (action.id ?? "") === storage.id ? { ...action, status } : action
        ),
      };
    default:
      return view;
  }
}
