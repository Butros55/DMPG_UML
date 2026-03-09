import type { AnalyzeEvent } from "./api";

export interface WorkspaceCompletionHighlight {
  nodeIds: string[];
  primaryNodeId: string | null;
  viewId: string | null;
}

export function resolveEventRunKind(
  event: AnalyzeEvent,
  fallback: "project_analysis" | "view_workspace",
): "project_analysis" | "view_workspace" {
  return event.runKind ?? fallback;
}

export function isWorkspaceNavigationEvent(
  event: AnalyzeEvent,
  runKind: "project_analysis" | "view_workspace",
): boolean {
  return runKind === "view_workspace" && !!event.symbolId && (event.action === "focus" || event.action === "saved");
}

export function isAiDataEvent(
  event: AnalyzeEvent,
  runKind: "project_analysis" | "view_workspace",
): boolean {
  return event.action === "generated"
    || (event.phase === "labels" && !event.action && !!event.new_)
    || (event.phase === "dead-code" && !event.action && !!event.reason)
    || (event.phase === "relations" && event.action === "added")
    || isWorkspaceNavigationEvent(event, runKind);
}

export function buildWorkspaceCompletionHighlight(event: AnalyzeEvent): WorkspaceCompletionHighlight | null {
  const nodeIds = Array.isArray(event.targetIds)
    ? Array.from(new Set(event.targetIds.filter((value) => value.length > 0)))
    : [];
  if (nodeIds.length === 0 && !event.focusViewId) {
    return null;
  }
  const primaryNodeId = event.symbolId ?? nodeIds[0] ?? null;
  return {
    nodeIds,
    primaryNodeId,
    viewId: event.focusViewId ?? event.viewId ?? null,
  };
}
