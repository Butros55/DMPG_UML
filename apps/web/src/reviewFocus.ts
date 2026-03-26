import type { ProjectGraph } from "@dmpg/shared";
import type { ReviewActionViewModel, ReviewHintViewModel, ViewReviewPanelModel } from "./reviewHints";
import { bestNavigableViewForTargetIds, resolveNavigableViewId } from "./viewNavigation";

export interface ReviewGraphTargetResolution {
  targetIds: string[];
  primaryTargetId: string | null;
  viewId: string | null;
  matchedBy: "target_ids" | "target_label" | "action_context" | "view_only" | "none";
}

export interface ReviewHighlightRequest {
  itemId: string;
  targetIds: string[];
  primaryTargetId: string | null;
  viewId: string | null;
  fitView: boolean;
}

type FocusableReviewEntry = ReviewHintViewModel | ReviewActionViewModel;

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

function getShortLabel(label: string): string {
  return label.split(".").pop()?.toLowerCase() ?? label.toLowerCase();
}

function chooseBestViewForTargetIds(
  graph: ProjectGraph,
  currentViewId: string | null,
  targetIds: readonly string[],
): string | null {
  return bestNavigableViewForTargetIds(graph, currentViewId, targetIds);
}

function choosePrimaryTargetId(
  graph: ProjectGraph,
  viewId: string | null,
  targetIds: readonly string[],
): string | null {
  if (!targetIds.length) return null;
  if (!viewId) return targetIds[0] ?? null;

  const view = graph.views.find((candidate) => candidate.id === viewId);
  if (!view) return targetIds[0] ?? null;

  return targetIds.find((id) => view.nodeRefs.includes(id)) ?? targetIds[0] ?? null;
}

function matchTargetIdsByLabel(
  graph: ProjectGraph,
  currentViewId: string | null,
  target: string,
): string[] {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return [];

  const currentView = currentViewId
    ? graph.views.find((candidate) => candidate.id === currentViewId) ?? null
    : null;
  const currentViewNodeIds = new Set(currentView?.nodeRefs ?? []);

  const symbolMatches = graph.symbols.filter((symbol) => {
    const fullLabel = symbol.label.toLowerCase();
    const shortLabel = getShortLabel(symbol.label);
    return (
      fullLabel === normalized ||
      shortLabel === normalized ||
      fullLabel.includes(normalized) ||
      normalized.includes(shortLabel)
    );
  });

  const currentMatches = symbolMatches.filter((symbol) => currentViewNodeIds.has(symbol.id)).map((symbol) => symbol.id);
  if (currentMatches.length > 0) return uniqueIds(currentMatches);

  return uniqueIds(symbolMatches.map((symbol) => symbol.id));
}

function deriveActionContextTargetIds(
  panel: ViewReviewPanelModel,
  action: ReviewActionViewModel,
): string[] {
  if (action.targetIds?.length) return uniqueIds(action.targetIds);

  const related = panel.items
    .filter((item) => item.source === action.source && item.status !== "dismissed" && item.targetIds?.length)
    .sort((left, right) => {
      const severityRank = (value: ReviewHintViewModel["severity"]) => value === "high" ? 0 : value === "medium" ? 1 : 2;
      return severityRank(left.severity) - severityRank(right.severity);
    })
    .flatMap((item) => item.targetIds ?? []);

  return uniqueIds(related).slice(0, 10);
}

export function resolveReviewEntryTargets(
  graph: ProjectGraph | null,
  currentViewId: string | null,
  entry: FocusableReviewEntry,
  panel?: ViewReviewPanelModel | null,
): ReviewGraphTargetResolution {
  if (!graph) {
    return {
      targetIds: [],
      primaryTargetId: null,
      viewId: currentViewId,
      matchedBy: "none",
    };
  }

  const entryTargetIds = "targetIds" in entry && entry.targetIds?.length
    ? uniqueIds(entry.targetIds)
    : [];
  if (entryTargetIds.length > 0) {
    const viewId = chooseBestViewForTargetIds(graph, currentViewId, entryTargetIds);
    return {
      targetIds: entryTargetIds,
      primaryTargetId: choosePrimaryTargetId(graph, viewId, entryTargetIds),
      viewId,
      matchedBy: "target_ids",
    };
  }

  const entryTarget = "target" in entry ? entry.target : undefined;
  if (entryTarget) {
    const matchedIds = matchTargetIdsByLabel(graph, currentViewId, entryTarget);
    if (matchedIds.length > 0) {
      const viewId = chooseBestViewForTargetIds(graph, currentViewId, matchedIds);
      return {
        targetIds: matchedIds,
        primaryTargetId: choosePrimaryTargetId(graph, viewId, matchedIds),
        viewId,
        matchedBy: "target_label",
      };
    }
  }

  const derivedActionIds = panel && "priority" in entry
    ? deriveActionContextTargetIds(panel, entry)
    : [];
  if (derivedActionIds.length > 0) {
    const viewId = chooseBestViewForTargetIds(graph, currentViewId, derivedActionIds);
    return {
      targetIds: derivedActionIds,
      primaryTargetId: choosePrimaryTargetId(graph, viewId, derivedActionIds),
      viewId,
      matchedBy: "action_context",
    };
  }

  return {
    targetIds: [],
    primaryTargetId: null,
    viewId: resolveNavigableViewId(graph, currentViewId, graph.rootViewId),
    matchedBy: currentViewId ? "view_only" : "none",
  };
}

export function buildReviewHighlightRequest(
  graph: ProjectGraph | null,
  currentViewId: string | null,
  entry: FocusableReviewEntry,
  panel?: ViewReviewPanelModel | null,
  options: { fitView?: boolean } = {},
): ReviewHighlightRequest {
  const resolution = resolveReviewEntryTargets(graph, currentViewId, entry, panel);
  return {
    itemId: entry.id,
    targetIds: resolution.targetIds,
    primaryTargetId: resolution.primaryTargetId,
    viewId: resolution.viewId,
    fitView: options.fitView ?? true,
  };
}
