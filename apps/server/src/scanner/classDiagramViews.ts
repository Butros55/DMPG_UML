import type {
  DiagramView,
  ProjectGraph,
  Relation,
  RelationType,
  Symbol,
} from "@dmpg/shared";

export const CLASS_DIAGRAM_RELATION_TYPES = [
  "inherits",
  "realizes",
  "association",
  "aggregation",
  "composition",
  "dependency",
  "instantiates",
] as const satisfies readonly RelationType[];

export const CLASS_DIAGRAM_RELATION_TYPE_SET = new Set<RelationType>(CLASS_DIAGRAM_RELATION_TYPES);

const CLASS_DIAGRAM_VIEW_RELATION_TYPES = [
  ...CLASS_DIAGRAM_RELATION_TYPES,
  "imports",
  "calls",
  "uses_config",
] as const satisfies readonly RelationType[];

const CLASS_DIAGRAM_VIEW_RELATION_TYPE_SET = new Set<RelationType>(CLASS_DIAGRAM_VIEW_RELATION_TYPES);

function isClassSymbol(symbol: Symbol | undefined): boolean {
  return symbol?.kind === "class" || symbol?.kind === "interface";
}

function isClassifierSymbol(symbol: Symbol | undefined): boolean {
  return isClassSymbol(symbol) || symbol?.kind === "module";
}

function getChildrenByParent(symbols: readonly Symbol[]): Map<string, Symbol[]> {
  const childrenByParent = new Map<string, Symbol[]>();
  for (const symbol of symbols) {
    if (!symbol.parentId) continue;
    childrenByParent.set(symbol.parentId, [...(childrenByParent.get(symbol.parentId) ?? []), symbol]);
  }
  return childrenByParent;
}

function findClassifierAncestorId(
  symbolId: string,
  symbolsById: Map<string, Symbol>,
): string | undefined {
  let cursor: string | undefined = symbolId;
  let depth = 0;
  while (cursor && depth < 40) {
    const symbol = symbolsById.get(cursor);
    if (!symbol) return undefined;
    if (isClassifierSymbol(symbol)) return symbol.id;
    cursor = symbol.parentId;
    depth += 1;
  }
  return undefined;
}

function collectClassifierNodesFromRefs(
  nodeRefs: readonly string[],
  symbolsById: Map<string, Symbol>,
  childrenByParent: Map<string, Symbol[]>,
): string[] {
  const result = new Set<string>();
  const visited = new Set<string>();
  const queue = [...nodeRefs];

  while (queue.length > 0) {
    const symbolId = queue.shift();
    if (!symbolId || visited.has(symbolId)) continue;
    visited.add(symbolId);

    const symbol = symbolsById.get(symbolId);
    if (!symbol) continue;

    const classifierAncestorId = findClassifierAncestorId(symbol.id, symbolsById);
    if (classifierAncestorId) {
      result.add(classifierAncestorId);
      if (symbol.id !== classifierAncestorId) continue;
    }

    for (const child of childrenByParent.get(symbol.id) ?? []) {
      queue.push(child.id);
    }
  }

  return [...result];
}

function classifierSortKey(symbol: Symbol | undefined): string {
  const priority = symbol?.kind === "module" ? "0" : "1";
  return `${priority}:${symbol?.label ?? symbol?.id ?? ""}`;
}

export function collectAllowedClassNodeIds(graph: ProjectGraph, view: DiagramView): string[] {
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const childrenByParent = getChildrenByParent(graph.symbols);
  const seedRefs = [...view.nodeRefs];
  if (view.id.startsWith("view:")) {
    const scopedSymbolId = view.id.slice("view:".length);
    if (symbolsById.has(scopedSymbolId)) seedRefs.push(scopedSymbolId);
  }

  const initial = new Set(collectClassifierNodesFromRefs(seedRefs, symbolsById, childrenByParent));

  if (view.scope === "class") {
    for (const relation of graph.relations) {
      if (!CLASS_DIAGRAM_RELATION_TYPE_SET.has(relation.type)) continue;
      const sourceClassifierId = findClassifierAncestorId(relation.source, symbolsById);
      const targetClassifierId = findClassifierAncestorId(relation.target, symbolsById);
      if (!sourceClassifierId || !targetClassifierId || sourceClassifierId === targetClassifierId) continue;
      const sourceVisible = initial.has(sourceClassifierId);
      const targetVisible = initial.has(targetClassifierId);
      if (sourceVisible === targetVisible) continue;
      const otherId = sourceVisible ? targetClassifierId : sourceClassifierId;
      if (isClassifierSymbol(symbolsById.get(otherId)) && !initial.has(otherId)) {
        initial.add(otherId);
      }
    }
  }

  return [...initial].sort((left, right) =>
    classifierSortKey(symbolsById.get(left)).localeCompare(classifierSortKey(symbolsById.get(right))),
  );
}

function stableListKey(values: readonly string[]): string {
  return values.join("\u0000");
}

function relationProjectsIntoNodeSet(
  relation: Relation,
  visibleNodeIds: ReadonlySet<string>,
  symbolsById: Map<string, Symbol>,
): boolean {
  if (!CLASS_DIAGRAM_VIEW_RELATION_TYPE_SET.has(relation.type)) return false;
  const sourceClassifierId = findClassifierAncestorId(relation.source, symbolsById);
  const targetClassifierId = findClassifierAncestorId(relation.target, symbolsById);
  return !!sourceClassifierId &&
    !!targetClassifierId &&
    sourceClassifierId !== targetClassifierId &&
    visibleNodeIds.has(sourceClassifierId) &&
    visibleNodeIds.has(targetClassifierId);
}

export function ensureClassDiagramViewNodePools(graph: ProjectGraph): number {
  let prepared = 0;
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));

  for (const view of graph.views) {
    if (view.diagramType !== "class") continue;
    const nodeRefs = collectAllowedClassNodeIds(graph, view);
    const nodeRefSet = new Set(nodeRefs);
    const edgeRefs = graph.relations
      .filter((relation) => relationProjectsIntoNodeSet(relation, nodeRefSet, symbolsById))
      .map((relation) => relation.id);

    const nodeRefsChanged = stableListKey(view.nodeRefs) !== stableListKey(nodeRefs);
    const edgeRefsChanged = stableListKey(view.edgeRefs) !== stableListKey(edgeRefs);
    if (nodeRefsChanged || edgeRefsChanged) prepared += 1;

    view.nodeRefs = nodeRefs;
    view.edgeRefs = edgeRefs;
    for (const nodeRef of nodeRefs) {
      const symbol = symbolsById.get(nodeRef);
      if (symbol?.kind === "module" && !symbol.stereotype) symbol.stereotype = "module";
    }
    if (nodeRefs.length === 0) {
      view.hiddenInSidebar = true;
    } else if (view.hiddenInSidebar) {
      delete view.hiddenInSidebar;
    }
    if (view.nodePositions) {
      const visibleNodeSet = new Set(nodeRefs);
      view.nodePositions = view.nodePositions.filter((position) => visibleNodeSet.has(position.symbolId));
    }
  }
  return prepared;
}
