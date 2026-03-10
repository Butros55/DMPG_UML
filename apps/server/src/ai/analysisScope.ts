import {
  collectNavigableSymbolIds,
  normalizeGraphForFrontend,
  type DiagramView,
  type ProjectGraph,
} from "@dmpg/shared";

export interface ProjectAnalysisScope {
  normalizedGraph: ProjectGraph;
  scopeView: DiagramView | null;
  navigableSymbolIds: Set<string>;
  targetSymbolIds: Set<string>;
  targetFiles: Set<string>;
}

export function resolveProjectAnalysisScope(
  graph: ProjectGraph,
  scopeViewId?: string,
): ProjectAnalysisScope {
  const normalizedGraph = normalizeGraphForFrontend(graph);
  const navigableSymbolIds = collectNavigableSymbolIds(normalizedGraph);
  const symbolMap = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const scopeView = scopeViewId
    ? normalizedGraph.views.find((view) => view.id === scopeViewId) ?? null
    : null;

  const targetSymbolIds = scopeView
    ? new Set(scopeView.nodeRefs.filter((symbolId) => navigableSymbolIds.has(symbolId)))
    : new Set(navigableSymbolIds);

  const targetFiles = new Set<string>();
  for (const symbolId of targetSymbolIds) {
    const file = symbolMap.get(symbolId)?.location?.file?.trim();
    if (file) {
      targetFiles.add(file);
    }
  }

  return {
    normalizedGraph,
    scopeView,
    navigableSymbolIds,
    targetSymbolIds,
    targetFiles,
  };
}
