import type { DiagramView, ProjectGraph } from "@dmpg/shared";

function viewDepth(graph: Pick<ProjectGraph, "views">, viewId: string): number {
  const viewMap = new Map(graph.views.map((view) => [view.id, view]));
  let depth = 0;
  let cursor: string | null | undefined = viewId;
  while (cursor) {
    const view = viewMap.get(cursor);
    if (!view?.parentViewId) break;
    depth += 1;
    cursor = view.parentViewId;
    if (depth > 40) break;
  }
  return depth;
}

export function isTechnicalNavigationView(graph: ProjectGraph, view: DiagramView): boolean {
  if (view.hiddenInSidebar) return true;
  if (view.id.startsWith("view:artifacts:") || view.id.startsWith("view:art-cat:")) return true;
  if (graph.rootViewId !== "view:process-overview") return false;
  return (
    view.id === "view:root" ||
    view.id.startsWith("view:grp:domain:") ||
    view.id === "view:grp:dir:__root__"
  );
}

export function isNavigableView(graph: ProjectGraph, view: DiagramView): boolean {
  return !isTechnicalNavigationView(graph, view);
}

export function normalizeGraphForFrontend(graph: ProjectGraph): ProjectGraph {
  const keptViews = graph.views.filter((view) => isNavigableView(graph, view));
  if (keptViews.length === 0) return graph;

  const keptViewIds = new Set(keptViews.map((view) => view.id));
  const viewMap = new Map(graph.views.map((view) => [view.id, view]));

  const normalizedViews = keptViews.map((view) => {
    let parentViewId = view.parentViewId ?? null;

    while (parentViewId && !keptViewIds.has(parentViewId)) {
      parentViewId = viewMap.get(parentViewId)?.parentViewId ?? null;
    }

    return {
      ...view,
      parentViewId,
    };
  });

  const normalizedRootViewId = keptViewIds.has(graph.rootViewId)
    ? graph.rootViewId
    : normalizedViews.find((view) => view.parentViewId == null)?.id ?? normalizedViews[0].id;

  const normalizedSymbols = graph.symbols.map((symbol) => (
    symbol.childViewId && !keptViewIds.has(symbol.childViewId)
      ? { ...symbol, childViewId: undefined }
      : symbol
  ));

  return {
    ...graph,
    symbols: normalizedSymbols,
    views: normalizedViews.map((view) => (
      view.id === normalizedRootViewId
        ? { ...view, parentViewId: null }
        : view
    )),
    rootViewId: normalizedRootViewId,
  };
}

export function collectNavigableSymbolIds(graph: ProjectGraph): Set<string> {
  const ids = new Set<string>();
  for (const view of graph.views) {
    if (isTechnicalNavigationView(graph, view)) continue;
    for (const symbolId of view.nodeRefs) {
      ids.add(symbolId);
    }
  }
  return ids;
}

export function resolveNavigableViewId(
  graph: ProjectGraph,
  requestedViewId?: string | null,
  fallbackViewId?: string | null,
): string | null {
  if (requestedViewId) {
    const requestedView = graph.views.find((view) => view.id === requestedViewId);
    if (requestedView && isNavigableView(graph, requestedView)) {
      return requestedView.id;
    }
  }

  if (fallbackViewId) {
    const fallbackView = graph.views.find((view) => view.id === fallbackViewId);
    if (fallbackView && isNavigableView(graph, fallbackView)) {
      return fallbackView.id;
    }
  }

  const firstNavigableView = graph.views.find((view) => isNavigableView(graph, view));
  return firstNavigableView?.id ?? null;
}

function shouldIncludeAncestorInBreadcrumb(graph: ProjectGraph, view: DiagramView): boolean {
  if (view.hiddenInSidebar) return false;
  if (graph.rootViewId !== "view:process-overview") return true;
  return !(
    view.id === "view:root" ||
    view.id.startsWith("view:grp:domain:") ||
    view.id === "view:grp:dir:__root__"
  );
}

export function buildBreadcrumbPath(
  graph: Pick<ProjectGraph, "rootViewId" | "views">,
  viewId: string,
): string[] {
  const projectGraph = graph as ProjectGraph;
  const viewMap = new Map(graph.views.map((view) => [view.id, view]));
  const chain: string[] = [];
  let cursor: string | null | undefined = viewId;
  let depth = 0;

  while (cursor && depth < 40) {
    const view = viewMap.get(cursor);
    if (!view) break;
    if (cursor === viewId || shouldIncludeAncestorInBreadcrumb(projectGraph, view)) {
      chain.unshift(cursor);
    }
    if (cursor === graph.rootViewId) break;
    cursor = view.parentViewId ?? null;
    depth += 1;
  }

  if (!chain.includes(graph.rootViewId)) {
    const rootView = viewMap.get(graph.rootViewId);
    if (rootView && shouldIncludeAncestorInBreadcrumb(projectGraph, rootView)) {
      chain.unshift(graph.rootViewId);
    }
  }

  return chain.length > 0 ? chain : [viewId];
}

function normalizeSymbolLabel(label: string): string {
  return label.trim().replace(/\\/g, "/").toLowerCase();
}

function labelBasename(label: string): string {
  const normalized = normalizeSymbolLabel(label);
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

export function resolveNavigableSymbolId(
  graph: ProjectGraph,
  symbolIdOrLabel: string,
): string | null {
  const navigableIds = collectNavigableSymbolIds(graph);
  if (navigableIds.has(symbolIdOrLabel)) return symbolIdOrLabel;

  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const rawSymbol = symbolsById.get(symbolIdOrLabel);
  const rawLabel = rawSymbol?.label ?? symbolIdOrLabel;
  const normalizedLabel = normalizeSymbolLabel(rawLabel);
  const basename = labelBasename(rawLabel);

  const candidates = graph.symbols.filter((symbol) => navigableIds.has(symbol.id));
  const scored = candidates
    .map((symbol) => {
      const candidateLabel = normalizeSymbolLabel(symbol.label);
      const candidateBasename = labelBasename(symbol.label);

      let score = Number.POSITIVE_INFINITY;
      if (candidateLabel === normalizedLabel) score = 0;
      else if (candidateBasename === basename && basename.length > 0) score = 10;
      else if (candidateLabel.endsWith(`/${basename}`) && basename.length > 0) score = 20;

      return { symbol, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) =>
      left.score - right.score ||
      left.symbol.label.length - right.symbol.label.length ||
      left.symbol.id.localeCompare(right.symbol.id),
    );

  return scored[0]?.symbol.id ?? null;
}

export function bestNavigableViewForSymbol(
  graph: ProjectGraph,
  symbolId: string,
  options: {
    preferredViewId?: string | null;
    currentViewId?: string | null;
  } = {},
): string | null {
  const containingViews = graph.views.filter((view) => view.nodeRefs.includes(symbolId));
  if (containingViews.length === 0) return null;

  if (options.preferredViewId) {
    const preferredView = containingViews.find(
      (view) => view.id === options.preferredViewId && isNavigableView(graph, view),
    );
    if (preferredView) return preferredView.id;
  }

  if (options.currentViewId) {
    const currentView = containingViews.find(
      (view) => view.id === options.currentViewId && isNavigableView(graph, view),
    );
    if (currentView) return currentView.id;
  }

  const candidates = containingViews
    .filter((view) => isNavigableView(graph, view))
    .sort((left, right) =>
      viewDepth(graph, right.id) - viewDepth(graph, left.id) ||
      left.id.localeCompare(right.id),
    );

  return candidates[0]?.id ?? null;
}

export function bestNavigableViewForTargetIds(
  graph: ProjectGraph,
  currentViewId: string | null,
  targetIds: readonly string[],
): string | null {
  const uniqueTargetIds = Array.from(new Set(targetIds))
    .filter((id) => graph.symbols.some((symbol) => symbol.id === id));
  if (uniqueTargetIds.length === 0) {
    return resolveNavigableViewId(graph, currentViewId, graph.rootViewId);
  }

  const scored = graph.views
    .filter((view) => isNavigableView(graph, view))
    .map((view) => {
      const matchCount = uniqueTargetIds.filter((id) => view.nodeRefs.includes(id)).length;
      return {
        view,
        matchCount,
        depth: viewDepth(graph, view.id),
        isCurrent: view.id === currentViewId,
      };
    })
    .filter((entry) => entry.matchCount > 0)
    .sort((left, right) =>
      right.matchCount - left.matchCount ||
      Number(right.isCurrent) - Number(left.isCurrent) ||
      right.depth - left.depth ||
      left.view.id.localeCompare(right.view.id),
    );

  return scored[0]?.view.id ?? resolveNavigableViewId(graph, currentViewId, graph.rootViewId);
}
