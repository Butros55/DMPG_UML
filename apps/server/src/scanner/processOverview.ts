import fs from "node:fs";
import path from "node:path";
import type {
  DiagramView,
  ProjectGraph,
  Relation,
  RelationType,
  Symbol,
} from "@dmpg/shared";
import { buildProcessDiagramConfigFromGraph } from "./processOverview.auto.js";

const PROCESS_TAG = "process-overview";
const STUB_TAG = "external-stub";
const PROCESS_REL_PREFIX = "process-edge:";
const STUB_REL_PREFIX = "stub-edge:";
const STUB_TOP_K = 6;
const PROCESS_VIEW_ID = "view:process-overview";

interface DrilldownConfig {
  viewSearch?: string[];
  symbolSearch?: string[];
  preferredViewIds?: string[];
  preferredSymbolIds?: string[];
}

interface PositionConfig {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface ProcessPackageConfig {
  id: string;
  label: string;
  stereotype?: string;
  preview?: string[];
  parentId?: string;
  childViewId?: string;
  position: PositionConfig;
  drilldown?: DrilldownConfig;
}

interface ProcessNodeConfig {
  id: string;
  label: string;
  umlType: ProcessUmlType;
  stereotype?: string;
  preview?: string[];
  parentId?: string;
  childViewId?: string;
  position: PositionConfig;
  drilldown?: DrilldownConfig;
}

interface ProcessEdgeConfig {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  label?: string;
}

interface ProcessDiagramConfig {
  viewId: string;
  title: string;
  packages: ProcessPackageConfig[];
  nodes: ProcessNodeConfig[];
  edges: ProcessEdgeConfig[];
  stageViews?: ProcessStageViewConfig[];
}

interface StageViewNodePosition {
  symbolId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface ProcessStageViewConfig {
  id: string;
  title: string;
  stage: string;
  nodeRefs: string[];
  edgeRefs: string[];
  nodePositions: StageViewNodePosition[];
  edges: ProcessEdgeConfig[];
}

interface StubAggregate {
  insideId: string;
  anchorId: string;
  direction: "out" | "in";
  count: number;
  typeCounts: Partial<Record<RelationType, number>>;
}

type ProcessUmlType =
  | "package"
  | "database"
  | "artifact"
  | "note"
  | "component"
  | "module"
  | "class"
  | "function"
  | "method"
  | "group"
  | "external";

type DiagramNodePosition = NonNullable<DiagramView["nodePositions"]>[number];

export { buildProcessDiagramConfigFromGraph } from "./processOverview.auto.js";

export function augmentGraphWithUmlOverlays(graph: ProjectGraph): ProjectGraph {
  const withBaseUmlTypes = applyDefaultUmlTypes(graph);
  const withProcess = createProcessOverviewView(withBaseUmlTypes);
  return addExternalContextStubs(withProcess);
}

function createProcessOverviewView(graph: ProjectGraph): ProjectGraph {
  const oldRootViewId =
    graph.rootViewId === PROCESS_VIEW_ID ? findFallbackRootViewId(graph) : graph.rootViewId;
  const config = resolveProcessDiagramConfig(graph);
  if (!config) return graph;

  removeExistingProcessOverlay(graph, config.viewId);
  if (!graph.views.some((view) => view.id === oldRootViewId)) {
    graph.rootViewId = findFallbackRootViewId(graph);
  } else {
    graph.rootViewId = oldRootViewId;
  }

  const restoredRoot = graph.views.find((view) => view.id === graph.rootViewId);
  if (restoredRoot && restoredRoot.parentViewId === PROCESS_VIEW_ID) {
    restoredRoot.parentViewId = null;
  }

  const symbolMap = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));

  const processSymbols: Symbol[] = [];
  const processPositions: DiagramNodePosition[] = [];
  const processNodeIds: string[] = [];

  const makeSymbol = (
    item: ProcessPackageConfig | ProcessNodeConfig,
    umlType: ProcessUmlType,
    fallbackKind: Symbol["kind"],
  ): Symbol => {
    const resolvedView =
      item.childViewId ??
      resolveDrilldownViewId(graph, item.drilldown) ??
      (umlType === "package" && !item.parentId ? oldRootViewId : undefined);
    const symbol: Symbol = {
      id: item.id,
      label: item.label,
      kind: fallbackKind,
      umlType: umlType as Symbol["umlType"],
      stereotype: item.stereotype,
      preview: item.preview && item.preview.length > 0 ? { lines: item.preview } : undefined,
      parentId: item.parentId,
      childViewId: resolvedView,
      tags: [PROCESS_TAG],
    };
    return symbol;
  };

  for (const pkg of config.packages) {
    processSymbols.push(makeSymbol(pkg, "package", "group"));
    processNodeIds.push(pkg.id);
    processPositions.push(toNodePosition(pkg));
  }

  for (const node of config.nodes) {
    processSymbols.push(makeSymbol(node, node.umlType, kindFromUmlType(node.umlType)));
    processNodeIds.push(node.id);
    processPositions.push(toNodePosition(node));
  }

  // Upsert process symbols to avoid duplicates if overlays are regenerated.
  for (const symbol of processSymbols) {
    const existing = symbolMap.get(symbol.id);
    if (existing) {
      Object.assign(existing, symbol);
    } else {
      graph.symbols.push(symbol);
      symbolMap.set(symbol.id, symbol);
    }
  }

  const processRelations: Relation[] = config.edges.map((edge) => ({
    id: `${PROCESS_REL_PREFIX}${edge.id}`,
    type: normalizeRelationType(edge.type),
    source: edge.source,
    target: edge.target,
    label: edge.label,
    confidence: 1,
  }));
  graph.relations.push(...processRelations);

  const processView: DiagramView = {
    id: config.viewId,
    title: config.title,
    parentViewId: null,
    scope: "root",
    nodeRefs: processNodeIds,
    edgeRefs: processRelations.map((relation) => relation.id),
    nodePositions: processPositions,
  };

  graph.views.push(processView);

  const stageRelations: Relation[] = [];
  const stageViews = (config.stageViews ?? []).map((view) => {
    const syntheticRelations = view.edges.map((edge) => ({
      id: `${PROCESS_REL_PREFIX}${edge.id}`,
      type: normalizeRelationType(edge.type),
      source: edge.source,
      target: edge.target,
      label: edge.label,
      confidence: 1,
    }));
    stageRelations.push(...syntheticRelations);
    return {
      id: view.id,
      title: view.title,
      parentViewId: processView.id,
      scope: "group" as const,
      hiddenInSidebar: false,
      nodeRefs: view.nodeRefs,
      edgeRefs: [...view.edgeRefs, ...syntheticRelations.map((relation) => relation.id)],
      nodePositions: view.nodePositions,
    } satisfies DiagramView;
  });
  graph.relations.push(...stageRelations);
  graph.views.push(...stageViews);

  // Keep the previous graph root reachable from Layer-1.
  const oldRoot = graph.views.find((view) => view.id === oldRootViewId);
  if (oldRoot && oldRoot.id !== processView.id) {
    oldRoot.parentViewId = processView.id;
    setHiddenInSidebarForSubtree(graph, oldRoot.id, true);
  }

  graph.rootViewId = processView.id;
  return graph;
}

function addExternalContextStubs(graph: ProjectGraph): ProjectGraph {
  removeExistingStubOverlay(graph);

  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const ancestorIndex = buildAncestorIndex(graph.symbols);

  for (const view of graph.views) {
    if (view.id === PROCESS_VIEW_ID || view.id.startsWith("view:process-stage:")) {
      continue;
    }
    const visible = new Set(view.nodeRefs);
    if (visible.size === 0) continue;

    const aggregates = new Map<string, StubAggregate>();

    for (const relation of graph.relations) {
      if (relation.type === "contains") continue;
      const srcInside = findNearestVisible(relation.source, visible, ancestorIndex);
      const tgtInside = findNearestVisible(relation.target, visible, ancestorIndex);

      if ((srcInside && tgtInside) || (!srcInside && !tgtInside)) {
        continue;
      }

      const direction: "out" | "in" = srcInside ? "out" : "in";
      const insideId = srcInside ?? tgtInside!;
      const outsideId = srcInside ? relation.target : relation.source;
      const anchorId = resolveExternalAnchorId(outsideId, visible, ancestorIndex, symbolsById);
      if (!anchorId || anchorId === insideId) continue;

      const key = `${insideId}|${anchorId}|${direction}`;
      const aggregate = aggregates.get(key) ?? {
        insideId,
        anchorId,
        direction,
        count: 0,
        typeCounts: {},
      };
      aggregate.count += 1;
      aggregate.typeCounts[relation.type] = (aggregate.typeCounts[relation.type] ?? 0) + 1;
      aggregates.set(key, aggregate);
    }

    if (aggregates.size === 0) continue;

    const anchorWeights = new Map<string, number>();
    for (const aggregate of aggregates.values()) {
      anchorWeights.set(
        aggregate.anchorId,
        (anchorWeights.get(aggregate.anchorId) ?? 0) + aggregate.count,
      );
    }

    const keptAnchors = new Set(
      [...anchorWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, STUB_TOP_K)
        .map(([anchorId]) => anchorId),
    );

    if (keptAnchors.size === 0) continue;

    const stubByAnchor = new Map<string, string>();
    /** Collect stub IDs created for this view so we can generate positions afterwards */
    const newStubIds: string[] = [];

    const aggregatesInView = [...aggregates.values()].filter((aggregate) => keptAnchors.has(aggregate.anchorId));

    for (const aggregate of aggregatesInView) {
      let stubId = stubByAnchor.get(aggregate.anchorId);
      if (!stubId) {
        stubId = `stub:${sanitizeId(view.id)}:${sanitizeId(aggregate.anchorId)}`;
        stubByAnchor.set(aggregate.anchorId, stubId);

        const anchorSym = symbolsById.get(aggregate.anchorId);
        const targetViewId = resolveAnchorTargetViewId(graph, aggregate.anchorId, view.id);
        const topTypeLines = summarizeAnchorTypes(
          aggregatesInView.filter((candidate) => candidate.anchorId === aggregate.anchorId),
        );

        const stubSymbol: Symbol = {
          id: stubId,
          label: `${anchorSym?.label ?? aggregate.anchorId} (external)`,
          kind: "group",
          umlType: "package",
          stereotype: "<<package>>",
          preview: topTypeLines.length > 0 ? { lines: topTypeLines } : undefined,
          childViewId: targetViewId,
          tags: [STUB_TAG, `stub-view:${view.id}`],
        };

        graph.symbols.push(stubSymbol);
        symbolsById.set(stubId, stubSymbol);
        if (!view.nodeRefs.includes(stubId)) {
          view.nodeRefs.push(stubId);
        }
        newStubIds.push(stubId);
      }

      const relationId = `${STUB_REL_PREFIX}${sanitizeId(view.id)}:${sanitizeId(aggregate.insideId)}:${sanitizeId(aggregate.anchorId)}:${aggregate.direction}`;
      const dominant = dominantRelationType(aggregate.typeCounts);
      const label = summarizeTypeCounts(aggregate.typeCounts, aggregate.count);

      const stubRelation: Relation = {
        id: relationId,
        type: dominant,
        source: aggregate.direction === "out" ? aggregate.insideId : stubId,
        target: aggregate.direction === "out" ? stubId : aggregate.insideId,
        label,
        confidence: 1,
      };

      graph.relations.push(stubRelation);
      if (!view.edgeRefs.includes(relationId)) {
        view.edgeRefs.push(relationId);
      }
    }

    // Generate positions for newly created stubs so ELK doesn't re-layout
    // the entire view (which would destroy hand-crafted positions in process-overview).
    if (newStubIds.length > 0) {
      generateStubPositions(view, newStubIds, symbolsById);
    }
  }

  return graph;
}

/**
 * Compute positions for external stubs based on the existing content bounding box.
 * Stubs are placed in a row below (or to the right of) the existing nodes,
 * ensuring they don't overlap with hand-crafted positions.
 */
function generateStubPositions(
  view: DiagramView,
  stubIds: string[],
  symbolsById: Map<string, Symbol>,
): void {
  const positions = view.nodePositions ?? [];
  if (!view.nodePositions) view.nodePositions = positions;

  // Compute the absolute bounding box of all existing top-level node positions.
  // Child nodes (with parentId in the symbol) are parent-relative, so we resolve
  // only top-level positions to find the content extent.
  const topLevelPositions: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const pos of positions) {
    const sym = symbolsById.get(pos.symbolId);
    // Only consider top-level nodes (no parentId) for the bounding box
    if (sym?.parentId) continue;
    topLevelPositions.push({
      x: pos.x,
      y: pos.y,
      w: pos.width ?? 220,
      h: pos.height ?? 120,
    });
  }

  // If there are no existing positions, start at a reasonable default
  let contentRight = 60;
  let contentBottom = 60;
  let contentLeft = 40;

  if (topLevelPositions.length > 0) {
    contentLeft = Math.min(...topLevelPositions.map((p) => p.x));
    contentRight = Math.max(...topLevelPositions.map((p) => p.x + p.w));
    contentBottom = Math.max(...topLevelPositions.map((p) => p.y + p.h));
  }

  // Place stubs in a row below the existing content with some gap
  const STUB_WIDTH = 220;
  const STUB_HEIGHT = 100;
  const GAP_Y = 60; // vertical gap below existing content
  const GAP_X = 40; // horizontal gap between stubs
  const maxRowWidth = Math.max(contentRight - contentLeft + 200, 800);

  let cursorX = contentLeft;
  let cursorY = contentBottom + GAP_Y;

  for (const stubId of stubIds) {
    // Don't overwrite if a position already exists (e.g. from a previous run)
    if (positions.some((p) => p.symbolId === stubId)) continue;

    // Wrap to next row if this stub would exceed the row width
    if (cursorX + STUB_WIDTH > contentLeft + maxRowWidth && cursorX > contentLeft) {
      cursorX = contentLeft;
      cursorY += STUB_HEIGHT + GAP_Y;
    }

    positions.push({
      symbolId: stubId,
      x: cursorX,
      y: cursorY,
      width: STUB_WIDTH,
      height: STUB_HEIGHT,
    });

    cursorX += STUB_WIDTH + GAP_X;
  }
}

function applyDefaultUmlTypes(graph: ProjectGraph): ProjectGraph {
  for (const symbol of graph.symbols) {
    if (!symbol.umlType) {
      symbol.umlType = inferUmlTypeFromKind(symbol.kind) as Symbol["umlType"];
    }
  }
  return graph;
}

function resolveProcessDiagramConfig(graph: ProjectGraph): ProcessDiagramConfig | null {
  const preferManual = process.env.DMPG_PROCESS_OVERVIEW_MODE === "manual";
  const manualFallback = process.env.DMPG_PROCESS_OVERVIEW_DEBUG_JSON === "1";

  if (preferManual) {
    return loadProcessDiagramConfig() ?? buildProcessDiagramConfigFromGraph(graph);
  }

  try {
    return buildProcessDiagramConfigFromGraph(graph);
  } catch {
    return manualFallback ? loadProcessDiagramConfig() : null;
  }
}

function findFallbackRootViewId(graph: ProjectGraph): string {
  const childRoot = graph.views.find(
    (view) => view.parentViewId === PROCESS_VIEW_ID && view.scope === "root",
  );
  if (childRoot) return childRoot.id;

  const plainRoot = graph.views.find(
    (view) => view.id !== PROCESS_VIEW_ID && view.parentViewId == null,
  );
  if (plainRoot) return plainRoot.id;

  return "view:root";
}

function loadProcessDiagramConfig(): ProcessDiagramConfig | null {
  const candidates = [
    path.resolve(import.meta.dirname, "../../process-diagram.json"),
    path.resolve(process.cwd(), "apps/server/process-diagram.json"),
    path.resolve(process.cwd(), "process-diagram.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as ProcessDiagramConfig;
      if (!parsed?.viewId || !Array.isArray(parsed.packages) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        continue;
      }
      return parsed;
    } catch {
      // ignore invalid candidate
    }
  }

  return null;
}

function resolveDrilldownViewId(graph: ProjectGraph, drilldown?: DrilldownConfig): string | undefined {
  if (!drilldown) return undefined;

  const preferredView = drilldown.preferredViewIds?.find((viewId) =>
    graph.views.some((view) => view.id === viewId),
  );
  if (preferredView) return preferredView;

  const preferredSymbols = drilldown.preferredSymbolIds?.length
    ? resolveViewFromPreferredSymbols(graph, drilldown.preferredSymbolIds)
    : undefined;
  if (preferredSymbols) return preferredSymbols;

  const bySymbol = drilldown.symbolSearch?.length
    ? resolveViewFromSymbolSearch(graph, drilldown.symbolSearch)
    : undefined;
  if (bySymbol) return bySymbol;

  const byView = drilldown.viewSearch?.length
    ? resolveViewFromViewSearch(graph, drilldown.viewSearch)
    : undefined;
  if (byView) return byView;

  return undefined;
}

function resolveViewFromPreferredSymbols(
  graph: ProjectGraph,
  preferredSymbolIds: string[],
): string | undefined {
  const scores = new Map<string, number>();

  for (const symbolId of preferredSymbolIds) {
    const symbol = graph.symbols.find((candidate) => candidate.id === symbolId);
    if (!symbol) continue;

    if (symbol.childViewId && graph.views.some((view) => view.id === symbol.childViewId)) {
      scores.set(symbol.childViewId, (scores.get(symbol.childViewId) ?? 0) + 16);
    }

    const bestView = findBestViewForSymbol(graph, symbolId);
    if (bestView) {
      scores.set(bestView, (scores.get(bestView) ?? 0) + 10);
    }
  }

  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function resolveViewFromViewSearch(graph: ProjectGraph, searchTerms: string[]): string | undefined {
  const terms = searchTerms.map(normalizeSearch).filter(Boolean);
  if (terms.length === 0) return undefined;

  let best: { viewId: string; score: number } | null = null;

  for (const view of graph.views) {
    const haystack = normalizeSearch(`${view.id} ${view.title}`);
    if (!haystack) continue;

    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        score += 5;
      }
    }
    if (score === 0) continue;

    if (view.scope === "group") score += 8;
    if (view.scope === "root") score += 4;
    if (view.scope === "module") score += 1;
    if (view.scope === "class") score -= 2;

    if (!best || score > best.score) {
      best = { viewId: view.id, score };
    }
  }

  return best?.viewId;
}

function resolveViewFromSymbolSearch(graph: ProjectGraph, searchTerms: string[]): string | undefined {
  const terms = searchTerms.map(normalizeSearch).filter(Boolean);
  if (terms.length === 0) return undefined;

  let bestSymbolId: string | undefined;
  let bestScore = -1;

  for (const symbol of graph.symbols) {
    if (symbol.tags?.includes(PROCESS_TAG) || symbol.tags?.includes(STUB_TAG)) continue;
    const haystack = normalizeSearch(`${symbol.id} ${symbol.label} ${symbol.location?.file ?? ""}`);
    if (!haystack) continue;

    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += 5;
    }
    if (score === 0) continue;

    if (symbol.kind === "module" || symbol.kind === "class") score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestSymbolId = symbol.id;
    }
  }

  if (!bestSymbolId) return undefined;
  const symbol = graph.symbols.find((item) => item.id === bestSymbolId);
  if (!symbol) return undefined;

  if (symbol.childViewId && graph.views.some((view) => view.id === symbol.childViewId)) {
    return symbol.childViewId;
  }

  return findBestViewForSymbol(graph, symbol.id);
}

function findBestViewForSymbol(graph: ProjectGraph, symbolId: string): string | undefined {
  let best: DiagramView | undefined;

  for (const view of graph.views) {
    if (!view.nodeRefs.includes(symbolId)) continue;
    if (!best) {
      best = view;
      continue;
    }

    const bestDepth = viewDepth(graph, best.id);
    const candidateDepth = viewDepth(graph, view.id);
    if (candidateDepth > bestDepth) {
      best = view;
    }
  }

  return best?.id;
}

function viewDepth(graph: ProjectGraph, viewId: string): number {
  const viewsById = new Map(graph.views.map((view) => [view.id, view]));
  let depth = 0;
  let cursor: string | null | undefined = viewId;
  while (cursor) {
    const view = viewsById.get(cursor);
    if (!view || !view.parentViewId) break;
    depth += 1;
    cursor = view.parentViewId;
    if (depth > 40) break;
  }
  return depth;
}

function setHiddenInSidebarForSubtree(
  graph: ProjectGraph,
  rootViewId: string,
  hidden: boolean,
): void {
  const pending = [rootViewId];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const view = graph.views.find((candidate) => candidate.id === current);
    if (!view) continue;
    view.hiddenInSidebar = hidden;
    for (const child of graph.views) {
      if (child.parentViewId === current) {
        pending.push(child.id);
      }
    }
  }
}

function removeExistingProcessOverlay(graph: ProjectGraph, processViewId: string): void {
  const processIds = new Set(
    graph.symbols
      .filter((symbol) => symbol.tags?.includes(PROCESS_TAG))
      .map((symbol) => symbol.id),
  );
  const processViewIds = new Set(
    graph.views
      .filter((view) => view.id === processViewId || view.id.startsWith("view:process-stage:"))
      .map((view) => view.id),
  );
  const detachedRootIds = graph.views
    .filter((view) => view.parentViewId && processViewIds.has(view.parentViewId))
    .map((view) => view.id);

  graph.symbols = graph.symbols.filter((symbol) => !processIds.has(symbol.id));
  graph.relations = graph.relations.filter(
    (relation) =>
      !relation.id.startsWith(PROCESS_REL_PREFIX) &&
      !processIds.has(relation.source) &&
      !processIds.has(relation.target),
  );
  graph.views = graph.views.filter((view) => !processViewIds.has(view.id));

  for (const view of graph.views) {
    view.nodeRefs = view.nodeRefs.filter((nodeId) => !processIds.has(nodeId));
    view.edgeRefs = view.edgeRefs.filter((edgeId) => !edgeId.startsWith(PROCESS_REL_PREFIX));
    if (view.parentViewId && processViewIds.has(view.parentViewId)) {
      view.parentViewId = null;
    }
    if (view.nodePositions?.length) {
      view.nodePositions = view.nodePositions.filter((position) => !processIds.has(position.symbolId));
    }
  }

  for (const viewId of detachedRootIds) {
    setHiddenInSidebarForSubtree(graph, viewId, false);
  }
}

function removeExistingStubOverlay(graph: ProjectGraph): void {
  const stubIds = new Set(
    graph.symbols
      .filter((symbol) => symbol.tags?.includes(STUB_TAG))
      .map((symbol) => symbol.id),
  );

  graph.symbols = graph.symbols.filter((symbol) => !stubIds.has(symbol.id));
  graph.relations = graph.relations.filter(
    (relation) =>
      !relation.id.startsWith(STUB_REL_PREFIX) &&
      !stubIds.has(relation.source) &&
      !stubIds.has(relation.target),
  );

  for (const view of graph.views) {
    view.nodeRefs = view.nodeRefs.filter((nodeId) => !stubIds.has(nodeId));
    view.edgeRefs = view.edgeRefs.filter((edgeId) => !edgeId.startsWith(STUB_REL_PREFIX));
    if (view.nodePositions?.length) {
      view.nodePositions = view.nodePositions.filter((position) => !stubIds.has(position.symbolId));
    }
  }
}

function buildAncestorIndex(symbols: Symbol[]): Map<string, string[]> {
  const parentById = new Map<string, string | undefined>(
    symbols.map((symbol) => [symbol.id, symbol.parentId]),
  );
  const cache = new Map<string, string[]>();

  const compute = (symbolId: string): string[] => {
    const cached = cache.get(symbolId);
    if (cached) return cached;

    const chain: string[] = [symbolId];
    let cursor = parentById.get(symbolId);
    let depth = 0;
    while (cursor && depth < 40) {
      chain.push(cursor);
      cursor = parentById.get(cursor);
      depth += 1;
    }

    cache.set(symbolId, chain);
    return chain;
  };

  for (const symbol of symbols) {
    compute(symbol.id);
  }

  return cache;
}

function findNearestVisible(
  symbolId: string,
  visible: Set<string>,
  ancestorIndex: Map<string, string[]>,
): string | null {
  const chain = ancestorIndex.get(symbolId);
  if (!chain) return null;
  for (const id of chain) {
    if (visible.has(id)) return id;
  }
  return null;
}

function resolveExternalAnchorId(
  symbolId: string,
  visible: Set<string>,
  ancestorIndex: Map<string, string[]>,
  symbolsById: Map<string, Symbol>,
): string {
  const chain = ancestorIndex.get(symbolId) ?? [symbolId];
  const outsideChain = chain.filter((id) => !visible.has(id));
  if (outsideChain.length === 0) return symbolId;

  for (const id of outsideChain) {
    const symbol = symbolsById.get(id);
    if (!symbol) continue;
    if ((symbol.kind === "group" || symbol.kind === "module" || symbol.kind === "package") && symbol.childViewId) {
      return id;
    }
  }

  for (const id of outsideChain) {
    const symbol = symbolsById.get(id);
    if (!symbol) continue;
    if (symbol.kind === "group" || symbol.kind === "module" || symbol.kind === "package" || symbol.kind === "class") {
      return id;
    }
  }

  return outsideChain[0];
}

function resolveAnchorTargetViewId(graph: ProjectGraph, anchorId: string, currentViewId: string): string | undefined {
  const anchor = graph.symbols.find((symbol) => symbol.id === anchorId);
  if (anchor?.childViewId && anchor.childViewId !== currentViewId && graph.views.some((view) => view.id === anchor.childViewId)) {
    return anchor.childViewId;
  }

  const best = findBestViewForSymbol(graph, anchorId);
  if (!best || best === currentViewId) return undefined;
  return best;
}

function summarizeAnchorTypes(aggregates: StubAggregate[]): string[] {
  const typeCounts: Partial<Record<RelationType, number>> = {};
  let total = 0;

  for (const aggregate of aggregates) {
    total += aggregate.count;
    for (const [type, count] of Object.entries(aggregate.typeCounts) as Array<[RelationType, number]>) {
      typeCounts[type] = (typeCounts[type] ?? 0) + count;
    }
  }

  const parts = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([type, count]) => `${count}x ${type}`);

  if (parts.length === 0) {
    return total > 0 ? [`${total} external links`] : [];
  }
  return [`${total} external links`, ...parts];
}

function summarizeTypeCounts(typeCounts: Partial<Record<RelationType, number>>, total: number): string {
  const entries = Object.entries(typeCounts)
    .filter((entry): entry is [RelationType, number] => Number(entry[1]) > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return `${total}x relations`;
  if (entries.length === 1) return `${entries[0][1]}x ${entries[0][0]}`;

  return entries
    .map(([type, count]) => `${count}x ${type}`)
    .join(", ");
}

function dominantRelationType(typeCounts: Partial<Record<RelationType, number>>): RelationType {
  let bestType: RelationType = "calls";
  let bestCount = -1;

  for (const [type, count] of Object.entries(typeCounts) as Array<[RelationType, number]>) {
    if (count > bestCount) {
      bestCount = count;
      bestType = type;
    }
  }

  return bestType;
}

function normalizeRelationType(type: RelationType): RelationType {
  const valid = new Set<RelationType>([
    "imports",
    "contains",
    "calls",
    "reads",
    "writes",
    "inherits",
    "uses_config",
    "instantiates",
  ]);
  return valid.has(type) ? type : "calls";
}

function toNodePosition(item: ProcessPackageConfig | ProcessNodeConfig): DiagramNodePosition {
  return {
    symbolId: item.id,
    x: item.position.x,
    y: item.position.y,
    width: item.position.width,
    height: item.position.height,
  };
}

function kindFromUmlType(umlType: ProcessUmlType): Symbol["kind"] {
  switch (umlType) {
    case "package":
      return "group";
    case "component":
      return "module";
    case "class":
      return "class";
    case "function":
      return "function";
    case "method":
      return "method";
    case "database":
    case "artifact":
    case "note":
    case "external":
      return "external";
    case "group":
      return "group";
    case "module":
      return "module";
    default:
      return "module";
  }
}

function inferUmlTypeFromKind(kind: Symbol["kind"]): ProcessUmlType {
  switch (kind) {
    case "group":
    case "package":
      return "package";
    case "external":
      return "artifact";
    case "module":
      return "module";
    case "class":
      return "class";
    case "function":
      return "function";
    case "method":
      return "method";
    default:
      return "external";
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]+/g, "_");
}

function normalizeSearch(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[\\/_.:()[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
