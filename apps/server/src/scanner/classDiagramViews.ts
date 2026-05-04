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

const PROCESS_STAGE_VIEW_PREFIX = "view:process-stage:";
const PROCESS_STAGE_CLASS_VIEW_MAX_NODES = 16;

const DEPENDENCY_SOURCE_RELATION_TYPE_SET = new Set<RelationType>([
  "imports",
  "calls",
  "uses_config",
]);

const STAGE_IGNORED_CLASSIFIER_LABELS = new Set([
  "any",
  "bool",
  "bytes",
  "dataframe",
  "dict",
  "float",
  "frozenset",
  "int",
  "list",
  "ndarray",
  "none",
  "object",
  "series",
  "set",
  "str",
  "tuple",
  "type",
]);

interface ClassViewNodePool {
  nodeRefs: string[];
  seedClassifierIds: Set<string>;
  isProcessStageClassView: boolean;
}

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

function hasClassDescendant(
  symbolId: string,
  childrenByParent: Map<string, Symbol[]>,
): boolean {
  const queue = [...(childrenByParent.get(symbolId) ?? [])];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const child = queue.shift();
    if (!child || visited.has(child.id)) continue;
    visited.add(child.id);
    if (isClassSymbol(child)) return true;
    queue.push(...(childrenByParent.get(child.id) ?? []));
  }

  return false;
}

function collectClassDescendantIds(
  symbolId: string,
  childrenByParent: Map<string, Symbol[]>,
  symbolsById: Map<string, Symbol>,
): string[] {
  const classIds: string[] = [];
  const queue = [...(childrenByParent.get(symbolId) ?? [])];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const child = queue.shift();
    if (!child || visited.has(child.id)) continue;
    visited.add(child.id);
    if (isClassSymbol(child) && !isIgnoredStageClassifier(child)) {
      classIds.push(child.id);
      continue;
    }
    if (symbolsById.has(child.id)) queue.push(...(childrenByParent.get(child.id) ?? []));
  }

  return classIds;
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

function isProcessStageClassView(view: DiagramView): boolean {
  return view.diagramType === "class" && view.id.startsWith(PROCESS_STAGE_VIEW_PREFIX);
}

function isIgnoredStageClassifier(symbol: Symbol | undefined): boolean {
  if (!symbol) return true;
  if (symbol.kind === "external" || symbol.id.startsWith("ext:")) return true;

  const label = symbol.label.trim().toLowerCase();
  const id = symbol.id.trim().toLowerCase();
  if (STAGE_IGNORED_CLASSIFIER_LABELS.has(label)) return true;
  if (/\b(pandas|numpy|sklearn|scipy|matplotlib|typing|collections)\b/.test(id)) return true;
  return false;
}

function collectProcessStageSeedClassifierIds(
  view: DiagramView,
  symbolsById: Map<string, Symbol>,
  childrenByParent: Map<string, Symbol[]>,
): string[] {
  const classSeeds = new Set<string>();
  const moduleSeeds = new Set<string>();
  const visited = new Set<string>();
  const queue = [...view.nodeRefs];

  const addClassifier = (symbol: Symbol): void => {
    if (isIgnoredStageClassifier(symbol)) return;
    if (isClassSymbol(symbol)) {
      classSeeds.add(symbol.id);
      return;
    }
    if (symbol.kind === "module" && !hasClassDescendant(symbol.id, childrenByParent)) {
      moduleSeeds.add(symbol.id);
    }
  };

  while (queue.length > 0) {
    const symbolId = queue.shift();
    if (!symbolId || visited.has(symbolId)) continue;
    visited.add(symbolId);

    const symbol = symbolsById.get(symbolId);
    if (!symbol || isIgnoredStageClassifier(symbol)) continue;

    if (isClassSymbol(symbol)) {
      addClassifier(symbol);
      continue;
    }

    if (symbol.kind === "module") {
      const classChildren = collectClassDescendantIds(symbol.id, childrenByParent, symbolsById);
      if (classChildren.length > 0) {
        for (const childId of classChildren) classSeeds.add(childId);
      } else {
        addClassifier(symbol);
      }
      continue;
    }

    const ancestorId = findClassifierAncestorId(symbol.id, symbolsById);
    if (ancestorId && ancestorId !== symbol.id) {
      const ancestor = symbolsById.get(ancestorId);
      if (ancestor) addClassifier(ancestor);
      continue;
    }

    queue.push(...(childrenByParent.get(symbol.id) ?? []).map((child) => child.id));
  }

  return [...classSeeds, ...moduleSeeds];
}

function classifierSortKey(symbol: Symbol | undefined): string {
  const priority = symbol?.kind === "module" ? "0" : "1";
  return `${priority}:${symbol?.label ?? symbol?.id ?? ""}`;
}

function stageRelationWeight(type: RelationType): number {
  switch (type) {
    case "composition":
      return 900;
    case "aggregation":
      return 850;
    case "association":
      return 800;
    case "inherits":
    case "realizes":
      return 780;
    case "instantiates":
      return 520;
    case "dependency":
      return 500;
    case "calls":
    case "imports":
    case "uses_config":
      return 180;
    default:
      return 0;
  }
}

function addStageCandidateScore(
  scores: Map<string, number>,
  candidateId: string,
  relation: Relation,
  symbolsById: Map<string, Symbol>,
): void {
  const symbol = symbolsById.get(candidateId);
  if (!isClassifierSymbol(symbol) || isIgnoredStageClassifier(symbol)) return;

  let score = stageRelationWeight(relation.type);
  if (isClassSymbol(symbol)) score += 20;
  if (relation.targetRole || relation.sourceRole) score += 12;
  if (relation.targetMultiplicity || relation.sourceMultiplicity) score += 8;
  if (relation.confidence != null) score += Math.round(relation.confidence * 10);

  scores.set(candidateId, Math.max(scores.get(candidateId) ?? 0, score));
}

function collectProcessStageClassNodePool(
  graph: ProjectGraph,
  view: DiagramView,
  symbolsById: Map<string, Symbol>,
  childrenByParent: Map<string, Symbol[]>,
): ClassViewNodePool {
  const seedIds = collectProcessStageSeedClassifierIds(view, symbolsById, childrenByParent);
  const seedSet = new Set(seedIds);
  const candidateScores = new Map<string, number>();

  for (const seedId of seedIds) {
    candidateScores.set(seedId, Number.MAX_SAFE_INTEGER);
  }

  for (const relation of graph.relations) {
    if (!CLASS_DIAGRAM_VIEW_RELATION_TYPE_SET.has(relation.type)) continue;

    const sourceClassifierId = findClassifierAncestorId(relation.source, symbolsById);
    const targetClassifierId = findClassifierAncestorId(relation.target, symbolsById);
    if (!sourceClassifierId || !targetClassifierId || sourceClassifierId === targetClassifierId) continue;

    const sourceSymbol = symbolsById.get(sourceClassifierId);
    const targetSymbol = symbolsById.get(targetClassifierId);
    if (isIgnoredStageClassifier(sourceSymbol) || isIgnoredStageClassifier(targetSymbol)) continue;

    const sourceSeed = seedSet.has(sourceClassifierId);
    const targetSeed = seedSet.has(targetClassifierId);
    if (!sourceSeed && !targetSeed) continue;

    if (DEPENDENCY_SOURCE_RELATION_TYPE_SET.has(relation.type)) {
      if (!sourceSeed && !targetSeed) continue;
    } else if (!CLASS_DIAGRAM_RELATION_TYPE_SET.has(relation.type)) {
      continue;
    }

    if (sourceSeed && !targetSeed) {
      addStageCandidateScore(candidateScores, targetClassifierId, relation, symbolsById);
    }
    if (targetSeed && !sourceSeed) {
      addStageCandidateScore(candidateScores, sourceClassifierId, relation, symbolsById);
    }
  }

  const seedOrder = new Map(seedIds.map((id, index) => [id, index]));
  const nodeRefs = [...candidateScores.entries()]
    .sort((left, right) => {
      const leftSeedIndex = seedOrder.get(left[0]);
      const rightSeedIndex = seedOrder.get(right[0]);
      if (leftSeedIndex != null && rightSeedIndex != null) return leftSeedIndex - rightSeedIndex;
      if (leftSeedIndex != null) return -1;
      if (rightSeedIndex != null) return 1;
      return right[1] - left[1] ||
        classifierSortKey(symbolsById.get(left[0])).localeCompare(classifierSortKey(symbolsById.get(right[0])));
    })
    .slice(0, PROCESS_STAGE_CLASS_VIEW_MAX_NODES)
    .map(([nodeId]) => nodeId);

  return {
    nodeRefs,
    seedClassifierIds: new Set(nodeRefs.filter((nodeId) => seedSet.has(nodeId))),
    isProcessStageClassView: true,
  };
}

function buildClassViewNodePool(graph: ProjectGraph, view: DiagramView): ClassViewNodePool {
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const childrenByParent = getChildrenByParent(graph.symbols);

  if (isProcessStageClassView(view)) {
    return collectProcessStageClassNodePool(graph, view, symbolsById, childrenByParent);
  }

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

  const nodeRefs = [...initial].sort((left, right) =>
    classifierSortKey(symbolsById.get(left)).localeCompare(classifierSortKey(symbolsById.get(right))),
  );
  return {
    nodeRefs,
    seedClassifierIds: new Set(nodeRefs),
    isProcessStageClassView: false,
  };
}

export function collectAllowedClassNodeIds(graph: ProjectGraph, view: DiagramView): string[] {
  return buildClassViewNodePool(graph, view).nodeRefs;
}

function stableListKey(values: readonly string[]): string {
  return values.join("\u0000");
}

function relationProjectsIntoNodeSet(
  relation: Relation,
  visibleNodeIds: ReadonlySet<string>,
  symbolsById: Map<string, Symbol>,
  pool: ClassViewNodePool,
): boolean {
  if (!CLASS_DIAGRAM_VIEW_RELATION_TYPE_SET.has(relation.type)) return false;
  const sourceClassifierId = findClassifierAncestorId(relation.source, symbolsById);
  const targetClassifierId = findClassifierAncestorId(relation.target, symbolsById);
  const projectsIntoVisibleSet = !!sourceClassifierId &&
    !!targetClassifierId &&
    sourceClassifierId !== targetClassifierId &&
    visibleNodeIds.has(sourceClassifierId) &&
    visibleNodeIds.has(targetClassifierId);

  if (!projectsIntoVisibleSet) return false;

  if (pool.isProcessStageClassView && DEPENDENCY_SOURCE_RELATION_TYPE_SET.has(relation.type)) {
    return pool.seedClassifierIds.has(sourceClassifierId) || pool.seedClassifierIds.has(targetClassifierId);
  }

  return true;
}

export function ensureClassDiagramViewNodePools(graph: ProjectGraph): number {
  let prepared = 0;
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));

  for (const view of graph.views) {
    if (view.diagramType !== "class") continue;
    const pool = buildClassViewNodePool(graph, view);
    const nodeRefs = pool.nodeRefs;
    const nodeRefSet = new Set(nodeRefs);
    const edgeRefs = graph.relations
      .filter((relation) => relationProjectsIntoNodeSet(relation, nodeRefSet, symbolsById, pool))
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
