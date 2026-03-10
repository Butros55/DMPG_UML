import {
  bestNavigableViewForSymbol,
  bestNavigableViewForTargetIds,
  collectNavigableSymbolIds,
  isManagedProcessLayoutViewId,
  isNavigableView,
  isTechnicalNavigationView,
  normalizeGraphForFrontend,
  resolveNavigableViewId,
  type DiagramView,
  type ProjectGraph,
} from "@dmpg/shared";

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

export {
  bestNavigableViewForSymbol,
  bestNavigableViewForTargetIds,
  collectNavigableSymbolIds,
  isManagedProcessLayoutViewId,
  isNavigableView,
  isTechnicalNavigationView,
  normalizeGraphForFrontend,
  resolveNavigableViewId,
};
