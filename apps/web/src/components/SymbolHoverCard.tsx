import { useCallback, useEffect, useLayoutEffect, useRef, useMemo, useState } from "react";
import { useAppStore } from "../store";
import { projectEdgesForView, type Symbol as Sym, type Relation, type ProjectGraph } from "@dmpg/shared";
import { buildNavigableRelationItems } from "../relationNavigation";
import { clearLinkedNodeHighlight, scheduleHideHover, setLinkedNodeHighlight, setMouseOverCard } from "./hoverCardController";
import { resolveArtifactView } from "../artifactVisibility";
import {
  HOVER_CARD_VIEWPORT_MARGIN,
  HOVER_CARD_WIDTH,
  buildCorridorRect,
  rectFromDomRect,
  resolveHoverCardPlacement,
  type RectBox,
} from "../hoverCardPlacement";
import { resolveNavigableSymbolId } from "../viewNavigation";
import { buildArtifactPreview, buildArtifactPreviewMetaChips, translateArtifactPreviewLabel } from "../artifactPreview";
import { openInIde } from "../api";
import {
  buildPackageSequenceDiagramDetails,
  isPackageSequenceView,
  type SequenceMessagePanelData,
  type SequenceParticipantMessagePreview,
  type SequenceParticipantPanelData,
  type SequenceProjectionMeta,
} from "../sequenceDiagram";

/* ── Enriched symbol info (computed from graph relations) ── */

interface EnrichedInfo {
  sym: Sym;
  parent: Sym | null;
  children: Sym[];
  outgoingCalls: Array<{ rel: Relation; target: Sym | undefined }>;
  incomingCalls: Array<{ rel: Relation; source: Sym | undefined }>;
  reads: Array<{ rel: Relation; target: Sym | undefined }>;
  readBy: Array<{ rel: Relation; source: Sym | undefined }>;
  writes: Array<{ rel: Relation; target: Sym | undefined }>;
  writtenBy: Array<{ rel: Relation; source: Sym | undefined }>;
  imports: Array<{ rel: Relation; target: Sym | undefined }>;
  importedBy: Array<{ rel: Relation; source: Sym | undefined }>;
  inherits: Array<{ rel: Relation; target: Sym | undefined }>;
  inheritedBy: Array<{ rel: Relation; source: Sym | undefined }>;
  instantiates: Array<{ rel: Relation; target: Sym | undefined }>;
  instantiatedBy: Array<{ rel: Relation; source: Sym | undefined }>;
  usesConfig: Array<{ rel: Relation; target: Sym | undefined }>;
  configUsedBy: Array<{ rel: Relation; source: Sym | undefined }>;
  lineCount: number | null;
}

interface PreviewSectionData {
  title: string;
  allLines: string[];
  meta: PreviewMetaData | null;
  itemEntries: PreviewDetailItem[];
  detailRows: PreviewDetailRow[];
  rawLines: string[];
  isCluster: boolean;
  itemCount: number | null;
  groupCount: number | null;
  summaryItems: string[];
}

interface PreviewMetaData {
  mode?: "single" | "cluster";
  stageId?: string;
  stageLabel?: string;
  flow?: string;
  category?: string;
  groupKind?: string;
  groupCount?: number;
  pathCount?: number;
}

interface PreviewDetailItem {
  label: string;
  paths: string[];
  writeCount: number | null;
  readCount: number | null;
  producers: string[];
  consumers: string[];
  producerStages: string[];
  consumerStages: string[];
  category?: string;
  groupKind?: string;
}

interface PreviewDetailRow {
  label: string;
  value: string;
  values: string[];
}

const PREVIEW_COLLAPSED_LINE_LIMIT = 8;
const PREVIEW_SUMMARY_ITEM_LIMIT = 3;
const PREVIEW_META_PREFIX = "@preview ";
const PREVIEW_ITEM_PREFIX = "@item ";

function enrichSymbol(sym: Sym, graph: ProjectGraph): EnrichedInfo {
  const findSym = (id: string) => graph.symbols.find((s) => s.id === id);

  const parent = sym.parentId ? findSym(sym.parentId) ?? null : null;
  const children = graph.symbols.filter((s) => s.parentId === sym.id);

  const rels = graph.relations.filter((r) => r.source === sym.id || r.target === sym.id);

  const outgoingCalls = rels
    .filter((r) => r.source === sym.id && r.type === "calls")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const incomingCalls = rels
    .filter((r) => r.target === sym.id && r.type === "calls")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const reads = rels
    .filter((r) => r.source === sym.id && r.type === "reads")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const readBy = rels
    .filter((r) => r.target === sym.id && r.type === "reads")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const writes = rels
    .filter((r) => r.source === sym.id && r.type === "writes")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const writtenBy = rels
    .filter((r) => r.target === sym.id && r.type === "writes")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const imports = rels
    .filter((r) => r.source === sym.id && r.type === "imports")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const importedBy = rels
    .filter((r) => r.target === sym.id && r.type === "imports")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const inherits = rels
    .filter((r) => r.source === sym.id && r.type === "inherits")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const inheritedBy = rels
    .filter((r) => r.target === sym.id && r.type === "inherits")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const instantiates = rels
    .filter((r) => r.source === sym.id && r.type === "instantiates")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const instantiatedBy = rels
    .filter((r) => r.target === sym.id && r.type === "instantiates")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const usesConfig = rels
    .filter((r) => r.source === sym.id && r.type === "uses_config")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const configUsedBy = rels
    .filter((r) => r.target === sym.id && r.type === "uses_config")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const lineCount =
    sym.location?.startLine != null && sym.location?.endLine != null
      ? sym.location.endLine - sym.location.startLine + 1
      : null;

  return {
    sym,
    parent,
    children,
    outgoingCalls,
    incomingCalls,
    reads,
    readBy,
    writes,
    writtenBy,
    imports,
    importedBy,
    inherits,
    inheritedBy,
    instantiates,
    instantiatedBy,
    usesConfig,
    configUsedBy,
    lineCount,
  };
}

/* ── Kind badge colors ── */
const KIND_COLORS: Record<string, string> = {
  function: "#80e0a0",
  method: "#80e0a0",
  class: "#ffd866",
  module: "#6c8cff",
  package: "#6c8cff",
  group: "#6c8cff",
  interface: "#c9a0ff",
  variable: "#ff9070",
  constant: "#ff9070",
  external: "#8b8fa7",
  script: "#e0e0e0",
};

const REL_BADGE_META: Record<string, { iconCls: string; label: string; cls: string }> = {
  "out:calls":        { iconCls: "bi-telephone-outbound", label: "ruft auf",         cls: "calls" },
  "in:calls":         { iconCls: "bi-telephone-inbound",  label: "aufgerufen von",   cls: "calls-in" },
  "out:reads":        { iconCls: "bi-book",               label: "liest",            cls: "reads" },
  "in:reads":         { iconCls: "bi-book",               label: "gelesen von",      cls: "reads-in" },
  "out:writes":       { iconCls: "bi-pencil-square",      label: "schreibt",         cls: "writes" },
  "in:writes":        { iconCls: "bi-pencil-square",      label: "geschrieben von",  cls: "writes-in" },
  "out:imports":      { iconCls: "bi-box-arrow-in-down",  label: "importiert",       cls: "imports" },
  "in:imports":       { iconCls: "bi-box-arrow-in-down",  label: "importiert von",   cls: "imports-in" },
  "out:inherits":     { iconCls: "bi-diagram-3",          label: "erbt von",         cls: "inherits" },
  "in:inherits":      { iconCls: "bi-diagram-3",          label: "vererbt an",       cls: "inherits-in" },
  "out:instantiates": { iconCls: "bi-lightning",          label: "erstellt",         cls: "instantiates" },
  "in:instantiates":  { iconCls: "bi-lightning",          label: "erstellt von",     cls: "instantiates-in" },
  "out:uses_config":  { iconCls: "bi-gear",               label: "konfiguriert",     cls: "uses_config" },
  "in:uses_config":   { iconCls: "bi-gear",               label: "konfiguriert von", cls: "uses_config-in" },
};

function getNodeRect(nodeId: string): RectBox | null {
  const el = document.querySelector(`[data-id="${CSS.escape(nodeId)}"]`);
  if (!(el instanceof HTMLElement)) return null;
  return rectFromDomRect(el.getBoundingClientRect());
}

function getPlacementBounds(cardEl: HTMLDivElement): RectBox {
  const canvasArea = cardEl.closest(".canvas-area");
  if (canvasArea instanceof HTMLElement) {
    const rect = canvasArea.getBoundingClientRect();
    return {
      left: rect.left + HOVER_CARD_VIEWPORT_MARGIN,
      top: rect.top + HOVER_CARD_VIEWPORT_MARGIN,
      right: rect.right - HOVER_CARD_VIEWPORT_MARGIN,
      bottom: rect.bottom - HOVER_CARD_VIEWPORT_MARGIN,
      width: Math.max(0, rect.width - HOVER_CARD_VIEWPORT_MARGIN * 2),
      height: Math.max(0, rect.height - HOVER_CARD_VIEWPORT_MARGIN * 2),
    };
  }

  return {
    left: HOVER_CARD_VIEWPORT_MARGIN,
    top: HOVER_CARD_VIEWPORT_MARGIN,
    right: window.innerWidth - HOVER_CARD_VIEWPORT_MARGIN,
    bottom: window.innerHeight - HOVER_CARD_VIEWPORT_MARGIN,
    width: Math.max(0, window.innerWidth - HOVER_CARD_VIEWPORT_MARGIN * 2),
    height: Math.max(0, window.innerHeight - HOVER_CARD_VIEWPORT_MARGIN * 2),
  };
}

function getHighlightedEdgeRects(): RectBox[] {
  const rects: RectBox[] = [];
  const paths = document.querySelectorAll(".edge-hover-highlight .react-flow__edge-path");

  for (const path of paths) {
    if (!(path instanceof SVGPathElement)) continue;

    try {
      const totalLength = path.getTotalLength();
      const matrix = path.getScreenCTM();
      if (!matrix || !Number.isFinite(totalLength) || totalLength <= 0) {
        rects.push(rectFromDomRect(path.getBoundingClientRect()));
        continue;
      }

      const step = Math.max(16, Math.min(30, totalLength / 10));
      for (let length = 0; length <= totalLength; length += step) {
        const point = path.getPointAtLength(Math.min(length, totalLength));
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        rects.push({
          left: screenPoint.x - 16,
          top: screenPoint.y - 16,
          right: screenPoint.x + 16,
          bottom: screenPoint.y + 16,
          width: 32,
          height: 32,
        });
      }
    } catch {
      rects.push(rectFromDomRect(path.getBoundingClientRect()));
    }
  }

  return rects;
}

function isClusterSymbol(sym: Pick<Sym, "id" | "tags">): boolean {
  return (
    sym.id.startsWith("proc:artifact-cluster:") ||
    sym.id.startsWith("proc:artgrp:") ||
    sym.id.startsWith("proc:output:") ||
    sym.tags?.includes("artifact-cluster") === true ||
    sym.tags?.includes("artifact-group") === true
  );
}

function splitPreviewList(value: string): string[] {
  return value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "-");
}

function normalizePreviewText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePreviewNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePreviewArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizePreviewText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseStructuredPreviewMeta(line: string): PreviewMetaData | null {
  if (!line.startsWith(PREVIEW_META_PREFIX)) return null;

  try {
    const payload = JSON.parse(line.slice(PREVIEW_META_PREFIX.length)) as Record<string, unknown>;
    return {
      mode: payload.mode === "cluster" || payload.mode === "single" ? payload.mode : undefined,
      stageId: normalizePreviewText(payload.stageId),
      stageLabel: normalizePreviewText(payload.stageLabel),
      flow: normalizePreviewText(payload.flow),
      category: normalizePreviewText(payload.category),
      groupKind: normalizePreviewText(payload.groupKind),
      groupCount: normalizePreviewNumber(payload.groupCount) ?? undefined,
      pathCount: normalizePreviewNumber(payload.pathCount) ?? undefined,
    };
  } catch {
    return null;
  }
}

function parseStructuredPreviewItem(line: string): PreviewDetailItem | null {
  if (!line.startsWith(PREVIEW_ITEM_PREFIX)) return null;

  try {
    const payload = JSON.parse(line.slice(PREVIEW_ITEM_PREFIX.length)) as Record<string, unknown>;
    const label = normalizePreviewText(payload.label);
    if (!label) return null;
    return {
      label,
      paths: normalizePreviewArray(payload.paths),
      writeCount: normalizePreviewNumber(payload.writeCount),
      readCount: normalizePreviewNumber(payload.readCount),
      producers: normalizePreviewArray(payload.producers),
      consumers: normalizePreviewArray(payload.consumers),
      producerStages: normalizePreviewArray(payload.producerStages),
      consumerStages: normalizePreviewArray(payload.consumerStages),
      category: normalizePreviewText(payload.category),
      groupKind: normalizePreviewText(payload.groupKind),
    };
  } catch {
    return null;
  }
}

function parsePreviewDetailRow(line: string): PreviewDetailRow | null {
  const match = line.match(/^([^:]+):\s*(.+)$/);
  if (!match) return null;
  const [, label, value] = match;
  return {
    label: label.trim(),
    value: value.trim(),
    values: splitPreviewList(value),
  };
}

function summarizePreviewItem(item: PreviewDetailItem): string {
  return item.label.length > 48 ? `${item.label.slice(0, 45)}...` : item.label;
}

function buildPreviewSectionData(sym: Sym): PreviewSectionData | null {
  const allLines = (sym.preview?.lines ?? []).map((line) => line.trim()).filter(Boolean);
  if (allLines.length === 0) return null;

  let meta: PreviewMetaData | null = null;
  const itemEntries: PreviewDetailItem[] = [];
  const detailRows: PreviewDetailRow[] = [];
  const rawLines: string[] = [];

  for (const line of allLines) {
    const structuredMeta = parseStructuredPreviewMeta(line);
    if (structuredMeta) {
      meta = structuredMeta;
      continue;
    }

    const structuredItem = parseStructuredPreviewItem(line);
    if (structuredItem) {
      itemEntries.push(structuredItem);
      continue;
    }

    const detailRow = parsePreviewDetailRow(line);
    if (detailRow) {
      detailRows.push(detailRow);
      continue;
    }

    rawLines.push(line);
  }

  const cluster = meta?.mode === "cluster" || isClusterSymbol(sym);
  const summarySource = itemEntries
    .slice(0, PREVIEW_SUMMARY_ITEM_LIMIT)
    .map((entry) => summarizePreviewItem(entry));
  const resolvedItemCount =
    meta?.pathCount ??
    (itemEntries.length > 0
      ? itemEntries.reduce((sum, entry) => sum + Math.max(1, entry.paths.length), 0)
      : null);

  return {
    title: cluster ? "Contained Artifacts" : "Details",
    allLines,
    meta,
    itemEntries,
    detailRows,
    rawLines,
    isCluster: cluster,
    itemCount: cluster ? resolvedItemCount : resolvedItemCount,
    groupCount: cluster ? meta?.groupCount ?? itemEntries.length : meta?.groupCount ?? null,
    summaryItems: cluster ? summarySource : [],
  };
}

function humanizePreviewValue(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (part) => part.toUpperCase());
}

function normalizeSymbolReference(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:/\\()[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resolvePreviewReference(
  graph: ProjectGraph | null,
  reference: string,
): { symbolId: string; label: string } | null {
  if (!graph || !reference.trim()) return null;

  const exact = graph.symbols.find((symbol) => symbol.id === reference || symbol.label === reference);
  if (exact) {
    return { symbolId: exact.id, label: exact.label };
  }

  const normalizedReference = normalizeSymbolReference(reference);
  if (!normalizedReference) return null;

  const exactNormalized = graph.symbols.find(
    (symbol) => normalizeSymbolReference(symbol.label) === normalizedReference,
  );
  if (exactNormalized) {
    return { symbolId: exactNormalized.id, label: exactNormalized.label };
  }

  const lastSegment = graph.symbols.find((symbol) => {
    const tail = symbol.label.split(".").pop() ?? symbol.label;
    return normalizeSymbolReference(tail) === normalizedReference;
  });
  return lastSegment ? { symbolId: lastSegment.id, label: lastSegment.label } : null;
}

function formatSequenceKind(kind: SequenceMessagePanelData["kind"]): string {
  switch (kind) {
    case "create":
      return "create";
    case "async":
      return "async";
    case "self":
      return "self";
    default:
      return "sync";
  }
}

function formatSequenceDirection(direction: SequenceParticipantMessagePreview["direction"]): string {
  switch (direction) {
    case "incoming":
      return "In";
    case "outgoing":
      return "Out";
    case "self":
      return "Self";
    default:
      return direction;
  }
}

function formatProjectionFilters(projection: SequenceProjectionMeta | null): string {
  if (!projection || projection.activeRelationFilters.length === 0) return "All relations";
  return projection.activeRelationFilters.join(", ");
}

/* ── The Hover Card Component ── */

export function SymbolHoverCard() {
  const hoverTarget = useAppStore((s) => s.hoverTarget);
  const hoverPosition = useAppStore((s) => s.hoverPosition);
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const diagramSettings = useAppStore((s) => s.diagramSettings);
  const focusSymbolInContext = useAppStore((s) => s.focusSymbolInContext);
  const openSourceViewer = useAppStore((s) => s.openSourceViewer);
  const cardRef = useRef<HTMLDivElement>(null);
  const [resolvedPosition, setResolvedPosition] = useState<{ targetKey: string; x: number; y: number } | null>(null);
  const hoverSource = hoverPosition?.source ?? "canvas";
  const hoverTargetKey = hoverTarget ? `${hoverTarget.kind}:${hoverTarget.id}` : null;
  const hoverSymbolId = hoverTarget?.kind === "symbol" ? hoverTarget.id : null;
  const currentView = currentViewId && graph ? graph.views.find((entry) => entry.id === currentViewId) ?? null : null;
  const sequenceView = isPackageSequenceView(currentView, graph);
  const resolvedArtifactView = useMemo(
    () =>
      graph && currentView
        ? resolveArtifactView(graph, currentView, {
            input: diagramSettings.inputArtifactMode,
            generated: diagramSettings.generatedArtifactMode,
          })
        : null,
    [currentView, diagramSettings.generatedArtifactMode, diagramSettings.inputArtifactMode, graph],
  );
  const viewGraph = useMemo(() => {
    if (!graph || !resolvedArtifactView) return graph;
    const symbolOverrides = resolvedArtifactView.symbolOverrides;
    return {
      ...graph,
      symbols: graph.symbols.map((symbol) => symbolOverrides.get(symbol.id) ?? symbol),
      relations: resolvedArtifactView.relations,
    };
  }, [graph, resolvedArtifactView]);
  const sequenceDetails = useMemo(() => {
    if (!graph || !currentView || !resolvedArtifactView || !sequenceView) return null;
    const hiddenSymbolIds = resolvedArtifactView.hiddenSymbolIds;
    const visibleViewNodeRefs = resolvedArtifactView.nodeRefs.filter((id) => !hiddenSymbolIds.has(id));
    return buildPackageSequenceDiagramDetails({
      graph,
      view: currentView,
      visibleViewNodeRefs,
      hiddenSymbolIds,
      symbolOverrides: resolvedArtifactView.symbolOverrides,
      relationFilters: diagramSettings.relationFilters,
      labelsMode: diagramSettings.labels,
      selectedSymbolId,
      selectedEdgeId,
    });
  }, [
    currentView,
    diagramSettings.labels,
    diagramSettings.relationFilters,
    graph,
    resolvedArtifactView,
    selectedEdgeId,
    selectedSymbolId,
    sequenceView,
  ]);
  const hoveredSequenceParticipant = hoverSymbolId && sequenceDetails
    ? sequenceDetails.participants.get(hoverSymbolId) ?? null
    : null;
  const hoveredSequenceMessage = hoverTarget?.kind === "sequenceMessage" && sequenceDetails
    ? sequenceDetails.messages.get(hoverTarget.id) ?? null
    : null;
  const sequenceProjection = sequenceDetails?.projection ?? null;

  const info = useMemo(() => {
    if (!hoverSymbolId || !viewGraph) return null;
    const sym = viewGraph.symbols.find((s) => s.id === hoverSymbolId);
    if (!sym) return null;
    return enrichSymbol(sym, viewGraph);
  }, [hoverSymbolId, viewGraph]);
  const outgoingCallItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.outgoingCalls.map(({ rel }) => rel) ?? [], "out"), [viewGraph, info]);
  const incomingCallItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.incomingCalls.map(({ rel }) => rel) ?? [], "in"), [viewGraph, info]);
  const readItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.reads.map(({ rel }) => rel) ?? [], "out"), [viewGraph, info]);
  const readByItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.readBy.map(({ rel }) => rel) ?? [], "in"), [viewGraph, info]);
  const writeItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.writes.map(({ rel }) => rel) ?? [], "out"), [viewGraph, info]);
  const writtenByItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.writtenBy.map(({ rel }) => rel) ?? [], "in"), [viewGraph, info]);
  const importItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.imports.map(({ rel }) => rel) ?? [], "out"), [viewGraph, info]);
  const importedByItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.importedBy.map(({ rel }) => rel) ?? [], "in"), [viewGraph, info]);
  const inheritItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.inherits.map(({ rel }) => rel) ?? [], "out"), [viewGraph, info]);
  const inheritedByItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.inheritedBy.map(({ rel }) => rel) ?? [], "in"), [viewGraph, info]);
  const instantiateItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.instantiates.map(({ rel }) => rel) ?? [], "out"), [viewGraph, info]);
  const instantiatedByItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.instantiatedBy.map(({ rel }) => rel) ?? [], "in"), [viewGraph, info]);
  const usesConfigItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.usesConfig.map(({ rel }) => rel) ?? [], "out"), [viewGraph, info]);
  const configUsedByItems = useMemo(() => buildNavigableRelationItems(viewGraph, info?.configUsedBy.map(({ rel }) => rel) ?? [], "in"), [viewGraph, info]);
  const previewData = useMemo(() => (info ? buildArtifactPreview(info.sym) : null), [info]);

  const relatedNodeIds = useMemo(() => {
    if (sequenceView || !graph || !currentViewId || !hoverSymbolId) return [] as string[];

    const view = graph.views.find((entry) => entry.id === currentViewId);
    if (!view) return [] as string[];

    const activeArtifactView = resolvedArtifactView ?? resolveArtifactView(graph, view, {
      input: diagramSettings.inputArtifactMode,
      generated: diagramSettings.generatedArtifactMode,
    });
    const hiddenSymbolIds = activeArtifactView.hiddenSymbolIds;
    const visibleNodeRefs = activeArtifactView.nodeRefs.filter((id) => !hiddenSymbolIds.has(id));
    const visibleRelations = activeArtifactView.relations.filter(
      (rel) => !hiddenSymbolIds.has(rel.source) && !hiddenSymbolIds.has(rel.target),
    );
    const relationMap = new Map(visibleRelations.map((rel) => [rel.id, rel]));
    const projectedEdges = projectEdgesForView(
      { ...view, nodeRefs: visibleNodeRefs },
      graph.symbols,
      visibleRelations,
    );

    const ids = new Set<string>();
    for (const edge of projectedEdges) {
      const hasVisibleRelation = edge.relationIds.some((relationId) => {
        const relation = relationMap.get(relationId);
        return !!relation && diagramSettings.relationFilters[relation.type];
      });
      if (!hasVisibleRelation) continue;
      if (edge.source === hoverSymbolId) ids.add(edge.target);
      if (edge.target === hoverSymbolId) ids.add(edge.source);
    }

    ids.delete(hoverSymbolId);
    return Array.from(ids);
  }, [
    currentViewId,
    diagramSettings.generatedArtifactMode,
    diagramSettings.inputArtifactMode,
    diagramSettings.relationFilters,
    graph,
    hoverSymbolId,
    resolvedArtifactView,
    sequenceView,
  ]);

  useLayoutEffect(() => {
    if (!cardRef.current || !hoverTarget || !hoverTargetKey || !hoverPosition) return;

    if (hoverSource === "inspector") {
      const inspectorEl = document.querySelector(".inspector");
      const inspectorRect = inspectorEl instanceof HTMLElement ? inspectorEl.getBoundingClientRect() : null;
      const cardRect = cardRef.current.getBoundingClientRect();
      const boundedY = inspectorRect
        ? Math.max(
            inspectorRect.top + 8,
            Math.min(
              hoverPosition.y,
              Math.min(
                inspectorRect.bottom - cardRect.height - 8,
                window.innerHeight - cardRect.height - HOVER_CARD_VIEWPORT_MARGIN,
              ),
            ),
          )
        : hoverPosition.y;
      setResolvedPosition({
        targetKey: hoverTargetKey,
        x: hoverPosition.x,
        y: boundedY,
      });
      return;
    }

    if (hoverTarget.kind !== "symbol") {
      setResolvedPosition({
        targetKey: hoverTargetKey,
        x: hoverPosition.x,
        y: hoverPosition.y,
      });
      return;
    }

    const updatePlacement = () => {
      if (!cardRef.current) return;

      const anchorRect = getNodeRect(hoverTarget.id);
      if (!anchorRect) {
        setResolvedPosition({
          targetKey: hoverTargetKey,
          x: hoverPosition.x,
          y: hoverPosition.y,
        });
        return;
      }

      const relatedRects = relatedNodeIds
        .map((nodeId) => getNodeRect(nodeId))
        .filter((rect): rect is RectBox => rect !== null);
      const corridorRects = relatedRects.map((rect) => buildCorridorRect(anchorRect, rect));
      const edgeRects = getHighlightedEdgeRects();
      const cardRect = cardRef.current.getBoundingClientRect();
      const placement = resolveHoverCardPlacement({
        anchorRect,
        cardSize: { width: cardRect.width, height: cardRect.height },
        bounds: getPlacementBounds(cardRef.current),
        avoidRects: relatedRects,
        corridorRects,
        edgeRects,
      });

      setResolvedPosition({
        targetKey: hoverTargetKey,
        x: placement.x,
        y: placement.y,
      });
    };

    updatePlacement();

    const resizeObserver = new ResizeObserver(() => updatePlacement());
    resizeObserver.observe(cardRef.current);
    window.addEventListener("resize", updatePlacement);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePlacement);
    };
  }, [hoverPosition, hoverSource, hoverTarget, hoverTargetKey, relatedNodeIds]);

  const handleNavigate = useCallback(
    (symId: string) => {
      if (!graph) return;
      const resolvedId = resolveNavigableSymbolId(graph, symId);
      if (!resolvedId) return;
      clearLinkedNodeHighlight();
      focusSymbolInContext(resolvedId);
      // Close hover card
      setMouseOverCard(false);
      useAppStore.getState().setHoverTarget(null);
    },
    [graph, focusSymbolInContext],
  );

  const handleOpenSource = useCallback(() => {
    if (!info) return;
    clearLinkedNodeHighlight();
    openSourceViewer(info.sym.id, info.sym.label);
    setMouseOverCard(false);
    useAppStore.getState().setHoverTarget(null);
  }, [info, openSourceViewer]);

  const handleOpenEvidence = useCallback((file: string | null, line: number | null) => {
    if (!file) return;
    void openInIde("vscode", file, line ?? undefined).catch(() => undefined);
  }, []);

  if (!hoverTarget || !hoverPosition) return null;

  const cardPosition = resolvedPosition?.targetKey === hoverTargetKey
    ? { x: resolvedPosition.x, y: resolvedPosition.y }
    : hoverPosition;

  if (hoverTarget.kind === "sequenceMessage") {
    if (!hoveredSequenceMessage) return null;
    const messageLabel = hoveredSequenceMessage.label
      ?? hoveredSequenceMessage.descriptorPreview[0]
      ?? hoveredSequenceMessage.relationType;

    return (
      <div
        ref={cardRef}
        className={`symbol-hover-card${hoverSource === "inspector" ? " symbol-hover-card--inspector" : ""}`}
        data-testid="sequence-message-hover-card"
        style={{ left: cardPosition.x, top: cardPosition.y }}
        onMouseEnter={() => setMouseOverCard(true)}
        onMouseLeave={() => { clearLinkedNodeHighlight(); setMouseOverCard(false); scheduleHideHover(); }}
      >
        <div className="shc-header">
          <span className="shc-kind-badge shc-kind-badge--sequence-message">Sequence Message</span>
          <div className="shc-name">#{hoveredSequenceMessage.index} {messageLabel}</div>
        </div>
        <div className="shc-parent">
          Kind: {formatSequenceKind(hoveredSequenceMessage.kind)} · Relation: {hoveredSequenceMessage.relationType} · Aggregated: {hoveredSequenceMessage.count}
        </div>
        <div className="shc-preview-box">
          <div className="shc-preview-subsection-label">Route</div>
          <div className="shc-preview-chip-row">
            <span className="shc-preview-chip shc-preview-chip--link" onClick={() => handleNavigate(hoveredSequenceMessage.sourceParticipantId)}>
              {hoveredSequenceMessage.sourceParticipantLabel}
            </span>
            <span className="shc-preview-chip">→</span>
            <span className="shc-preview-chip shc-preview-chip--link" onClick={() => handleNavigate(hoveredSequenceMessage.targetParticipantId)}>
              {hoveredSequenceMessage.targetParticipantLabel}
            </span>
          </div>
        </div>
        {hoveredSequenceMessage.descriptorPreview.length > 0 && (
          <div className="shc-preview-box">
            <div className="shc-preview-subsection-label">Descriptors</div>
            <div className="shc-preview-chip-row">
              {hoveredSequenceMessage.descriptorPreview.map((descriptor, index) => (
                <span key={`${hoveredSequenceMessage.id}-descriptor-${index}`} className="shc-preview-chip">
                  {descriptor}
                </span>
              ))}
            </div>
          </div>
        )}
        {(hoveredSequenceMessage.evidenceFile || sequenceProjection) && (
          <div className="shc-preview-box">
            {hoveredSequenceMessage.evidenceFile && (
              <>
                <div className="shc-preview-subsection-label">Evidence</div>
                <div className="shc-location">
                  {hoveredSequenceMessage.evidenceFile}
                  {hoveredSequenceMessage.evidenceLine != null ? `:${hoveredSequenceMessage.evidenceLine}` : ""}
                </div>
                <button className="source-view-btn" onClick={() => handleOpenEvidence(hoveredSequenceMessage.evidenceFile, hoveredSequenceMessage.evidenceLine)}>
                  <i className="bi bi-box-arrow-up-right" /> Open in IDE
                </button>
              </>
            )}
            {sequenceProjection && (
              <>
                <div className="shc-preview-subsection-label" style={{ marginTop: hoveredSequenceMessage.evidenceFile ? 8 : 0 }}>Projection</div>
                <div className="shc-parent">
                  Participants: {sequenceProjection.usedParticipants}/{sequenceProjection.participantLimit} · Messages: {sequenceProjection.usedMessages}/{sequenceProjection.messageLimit}
                </div>
                <div className="shc-parent">
                  Buckets: {sequenceProjection.bucketsActive ? "active" : "inactive"} · Filters: {formatProjectionFilters(sequenceProjection)}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  if (hoveredSequenceParticipant) {
    const previewMessages = hoveredSequenceParticipant.messages.slice(0, 3);

    return (
      <div
        ref={cardRef}
        className={`symbol-hover-card${hoverSource === "inspector" ? " symbol-hover-card--inspector" : ""}`}
        data-testid="sequence-participant-hover-card"
        style={{ left: cardPosition.x, top: cardPosition.y }}
        onMouseEnter={() => setMouseOverCard(true)}
        onMouseLeave={() => { clearLinkedNodeHighlight(); setMouseOverCard(false); scheduleHideHover(); }}
      >
        <div className="shc-header">
          <span className="shc-kind-badge shc-kind-badge--sequence-participant">Participant</span>
          <div className="shc-name">{hoveredSequenceParticipant.label}</div>
        </div>
        <div className="shc-parent">
          Role: {hoveredSequenceParticipant.role} · Lane: {hoveredSequenceParticipant.laneKind}
        </div>
        {hoveredSequenceParticipant.fullLabel && hoveredSequenceParticipant.fullLabel !== hoveredSequenceParticipant.label && (
          <div className="shc-location">{hoveredSequenceParticipant.fullLabel}</div>
        )}
        <div className="shc-preview-box">
          <div className="shc-preview-subsection-label">Sequence Stats</div>
          <div className="shc-preview-chip-row">
            <span className="shc-preview-chip">In {hoveredSequenceParticipant.incomingCount}</span>
            <span className="shc-preview-chip">Out {hoveredSequenceParticipant.outgoingCount}</span>
            <span className="shc-preview-chip">First #{hoveredSequenceParticipant.firstMessageIndex ?? "-"}</span>
            <span className="shc-preview-chip">Created #{hoveredSequenceParticipant.createdAtMessageIndex ?? "-"}</span>
          </div>
          <div className="shc-preview-chip-row">
            <span className="shc-preview-chip">sync {hoveredSequenceParticipant.breakdown.sync}</span>
            <span className="shc-preview-chip">async {hoveredSequenceParticipant.breakdown.async}</span>
            <span className="shc-preview-chip">create {hoveredSequenceParticipant.breakdown.create}</span>
            <span className="shc-preview-chip">self {hoveredSequenceParticipant.breakdown.self}</span>
          </div>
        </div>
        <div className="shc-preview-box">
          <div className="shc-preview-subsection-label">Activations</div>
          <div className="shc-preview-chip-row">
            <span className="shc-preview-chip">Count {hoveredSequenceParticipant.activationCount}</span>
            {hoveredSequenceParticipant.activationMaxDepth != null && (
              <span className="shc-preview-chip">Max depth {hoveredSequenceParticipant.activationMaxDepth}</span>
            )}
          </div>
        </div>
        {previewMessages.length > 0 && (
          <div className="shc-preview-box">
            <div className="shc-preview-subsection-label">Messages</div>
            <div className="shc-preview-detail-list">
              {previewMessages.map((message) => (
                <div key={`${hoveredSequenceParticipant.participantId}-${message.id}-${message.direction}`} className="shc-preview-detail-row">
                  <div className="shc-preview-detail-label">#{message.index}</div>
                  <div className="shc-preview-detail-value">
                    <span className="shc-preview-chip">{formatSequenceDirection(message.direction)}</span>
                    <span className="shc-preview-chip shc-preview-chip--link" onClick={() => handleNavigate(message.partnerId)}>
                      {message.partnerLabel}
                    </span>
                    <span className="shc-preview-chip">{message.label}</span>
                    {message.count > 1 && <span className="shc-preview-chip">x{message.count}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {sequenceProjection && (
          <div className="shc-preview-box">
            <div className="shc-preview-subsection-label">Projection</div>
            <div className="shc-parent">
              Participants: {sequenceProjection.usedParticipants}/{sequenceProjection.participantLimit} · Messages: {sequenceProjection.usedMessages}/{sequenceProjection.messageLimit}
            </div>
            <div className="shc-parent">
              Buckets: {sequenceProjection.bucketsActive ? "active" : "inactive"} · Filters: {formatProjectionFilters(sequenceProjection)} · Labels: {sequenceProjection.labelMode}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!info) return null;

  const { sym } = info;
  const doc = sym.doc;
  const loc = sym.location;
  const kindColor = KIND_COLORS[sym.kind] ?? "#8b8fa7";

  // Build compact signature
  const sigParts = doc?.inputs?.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ") ?? "";
  const returnType = doc?.outputs?.map((o) => o.type ?? o.name).join(", ") ?? "";
  const isDeadCode = sym.tags?.includes("dead-code") ?? false;
  const relationBadgeKeys = [
    ...(outgoingCallItems.length > 0 ? ["out:calls"] : []),
    ...(incomingCallItems.length > 0 ? ["in:calls"] : []),
    ...(readItems.length > 0 ? ["out:reads"] : []),
    ...(readByItems.length > 0 ? ["in:reads"] : []),
    ...(writeItems.length > 0 ? ["out:writes"] : []),
    ...(writtenByItems.length > 0 ? ["in:writes"] : []),
    ...(importItems.length > 0 ? ["out:imports"] : []),
    ...(importedByItems.length > 0 ? ["in:imports"] : []),
    ...(inheritItems.length > 0 ? ["out:inherits"] : []),
    ...(inheritedByItems.length > 0 ? ["in:inherits"] : []),
    ...(instantiateItems.length > 0 ? ["out:instantiates"] : []),
    ...(instantiatedByItems.length > 0 ? ["in:instantiates"] : []),
    ...(usesConfigItems.length > 0 ? ["out:uses_config"] : []),
    ...(configUsedByItems.length > 0 ? ["in:uses_config"] : []),
  ];
  const deadCodeReasonText = (() => {
    const explicit = (doc?.deadCodeReason ?? "").trim();
    if (explicit) return explicit;

    const inboundCallCount = info.incomingCalls.length + info.instantiatedBy.length;
    const outboundCallCount = info.outgoingCalls.length + info.instantiates.length;

    if (inboundCallCount === 0 && outboundCallCount === 0) {
      return "Keine eingehenden oder ausgehenden Aufrufbeziehungen gefunden. Das Symbol ist im aktuellen Graphen nicht eingebunden und wurde deshalb als Dead Code markiert.";
    }
    if (inboundCallCount === 0) {
      return "Keine eingehenden Aufrufe/Instanziierungen gefunden. Das Symbol wird aktuell von keinem anderen Symbol verwendet und wurde deshalb als Dead Code markiert.";
    }
    return "Das Symbol trägt das Dead-Code-Tag, aber es liegt keine detaillierte LLM-Begründung vor.";
  })();
  const previewMetaChips = previewData ? buildArtifactPreviewMetaChips(previewData) : [];
  const previewPrimaryItem = previewData?.itemEntries[0] ?? null;
  const previewPlainRows = previewData?.detailRows.slice(0, 2) ?? [];
  const previewPlainLines = previewData?.rawLines.slice(0, 2) ?? [];
  const showArtifactState = diagramSettings.generatedArtifactMode !== "individual";
  const renderPreviewValueChip = (value: string, key: string) => {
    const resolved = resolvePreviewReference(viewGraph, value);
    if (!resolved) {
      return <span key={key} className="shc-preview-chip">{value}</span>;
    }
    return (
      <span
        key={key}
        className="shc-preview-chip shc-preview-chip--link"
        onClick={() => handleNavigate(resolved.symbolId)}
        onMouseEnter={() => setLinkedNodeHighlight(resolved.symbolId)}
        onMouseLeave={() => clearLinkedNodeHighlight()}
        title={resolved.label}
      >
        {resolved.label}
      </span>
    );
  };
  const renderLinkChip = (symbolId: string, label: string, className: string, title?: string) => (
    <span
      key={symbolId}
      className={className}
      onClick={() => handleNavigate(symbolId)}
      onMouseEnter={() => setLinkedNodeHighlight(symbolId)}
      onMouseLeave={() => clearLinkedNodeHighlight()}
      title={title}
    >
      {label}
    </span>
  );
  const renderRelationChips = (items: ReturnType<typeof buildNavigableRelationItems>, className = "shc-link-chip") => (
    items.map((item) => (
      renderLinkChip(item.symbolId, item.symbol.label, className, item.symbol.doc?.summary)
    ))
  );

  return (
    <div
      ref={cardRef}
      className={`symbol-hover-card${hoverSource === "inspector" ? " symbol-hover-card--inspector" : ""}`}
      style={{ left: cardPosition.x, top: cardPosition.y }}
      onMouseEnter={() => setMouseOverCard(true)}
      onMouseLeave={() => { clearLinkedNodeHighlight(); setMouseOverCard(false); scheduleHideHover(); }}
    >
      {/* ── Header ── */}
      <div className="shc-header">
        <span className="shc-kind-badge" style={{ background: kindColor }}>
          {sym.kind}
        </span>
        <span className="shc-name">{sym.label}</span>
      </div>

      {/* ── Location ── */}
      {loc && (
        <div className="shc-location">
          <i className="bi bi-file-earmark" /> {loc.file}
          {loc.startLine != null && `:${loc.startLine}`}
          {loc.endLine != null && `-${loc.endLine}`}
          {info.lineCount != null && (
            <span className="shc-line-count"> ({info.lineCount} Zeilen)</span>
          )}
        </div>
      )}

      {/* ── Source Code Button ── */}
      {loc && (
        <button className="shc-source-btn" onClick={handleOpenSource}>
          <i className="bi bi-code-square" /> Quellcode anzeigen
        </button>
      )}

      {/* ── Parent ── */}
      {info.parent && (
        <div className="shc-parent">
          <i className="bi bi-box" /> in:{" "}
          <span
            className="shc-link"
            onClick={() => handleNavigate(info.parent!.id)}
            onMouseEnter={() => setLinkedNodeHighlight(info.parent!.id)}
            onMouseLeave={() => clearLinkedNodeHighlight()}
          >
            {info.parent.label}
          </span>
          <span className="shc-dim"> ({info.parent.kind})</span>
        </div>
      )}

      {/* ── Signature ── */}
      {(sym.kind === "function" || sym.kind === "method") && (
        <div className="shc-signature">
          <span className="shc-sig-kw">def</span> {sym.label.split(".").pop()}
          <span className="shc-sig-parens">(</span>
          <span className="shc-sig-params">{sigParts || "…"}</span>
          <span className="shc-sig-parens">)</span>
          {returnType && (
            <>
              <span className="shc-sig-arrow"> → </span>
              <span className="shc-sig-return">{returnType}</span>
            </>
          )}
        </div>
      )}

      {/* ── Relation badges (same visual mapping as nodes/inspector) ── */}
      {relationBadgeKeys.length > 0 && (
        <div className="rel-badges shc-rel-badges">
          {relationBadgeKeys.map((key) => {
            const meta = REL_BADGE_META[key];
            if (!meta) return null;
            const isIn = key.startsWith("in:");
            return (
              <span
                key={key}
                className={`rel-badge rel-badge--${meta.cls}`}
                title={meta.label}
                aria-label={meta.label}
              >
                {isIn && <i className="bi bi-arrow-left" style={{ fontSize: 9, marginRight: 2 }} />}
                <i className={`bi ${meta.iconCls}`} />
                <span>{meta.label}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Summary/Purpose ── */}
      {doc?.summary && (
        <div className="shc-section">
          <div className="shc-section-label">Beschreibung</div>
          <div className="shc-summary">{doc.summary}</div>
        </div>
      )}

      {previewData && (
        <div className="shc-section">
          <div className="shc-section-label">Artefakt</div>

          <div className="shc-preview-summary-block">
            {showArtifactState && (previewData.kind === "cluster" || previewData.kind === "single") && (
              <div className={`artifact-state-pill artifact-state-pill--${previewData.kind === "cluster" ? "cluster" : "single"} shc-artifact-pill`}>
                <i className={`bi ${previewData.kind === "cluster" ? "bi-collection" : "bi-file-earmark-text"}`} />
                {previewData.kind === "cluster" ? "Cluster" : "Einzelobjekt"}
              </div>
            )}

            {previewData.kind === "cluster" ? (
              <>
                <div className="shc-preview-count">
                  <i className="bi bi-collection" />
                  {previewData.itemCount ?? previewData.itemEntries.length} Artefakte
                  {previewData.groupCount != null && previewData.itemCount != null && previewData.groupCount !== previewData.itemCount && (
                    <span className="shc-dim"> in {previewData.groupCount} Gruppen</span>
                  )}
                </div>
                {previewData.summaryItems.length > 0 && (
                  <div className="shc-preview-summary">
                    <span className="shc-preview-summary-label">Beispiele:</span>
                    <span className="shc-preview-summary-text">{previewData.summaryItems.join(" · ")}</span>
                    {(previewData.itemCount ?? 0) > previewData.summaryItems.length && (
                      <span className="shc-dim"> +{(previewData.itemCount ?? 0) - previewData.summaryItems.length} weitere</span>
                    )}
                  </div>
                )}
              </>
            ) : previewPrimaryItem ? (
              <>
                <div className="shc-preview-count">
                  <i className="bi bi-file-earmark-text" />
                  {previewPrimaryItem.label}
                  <div className="shc-preview-metrics">
                    {previewPrimaryItem.writeCount != null && (
                      <span className="shc-preview-metric shc-preview-metric--write">W {previewPrimaryItem.writeCount}</span>
                    )}
                    {previewPrimaryItem.readCount != null && (
                      <span className="shc-preview-metric shc-preview-metric--read">R {previewPrimaryItem.readCount}</span>
                    )}
                  </div>
                </div>
                {previewPrimaryItem.paths.length > 0 && (
                  <div className="shc-preview-chip-row">
                    {previewPrimaryItem.paths.slice(0, 2).map((path, index) => (
                      <span key={`${sym.id}-preview-primary-path-${index}`} className="shc-preview-chip shc-preview-chip--path">
                        {path}
                      </span>
                    ))}
                    {previewPrimaryItem.paths.length > 2 && (
                      <span className="shc-dim">+{previewPrimaryItem.paths.length - 2} weitere Pfade</span>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>

          {previewMetaChips.length > 0 && (
            <div className="shc-preview-meta-list">
              {previewMetaChips.map((line, index) => (
                <span key={`${sym.id}-preview-meta-${index}`} className="shc-preview-meta-chip">
                  {line}
                </span>
              ))}
            </div>
          )}

          {previewData.kind === "plain" && previewPlainRows.length > 0 && (
            <div className="shc-preview-detail-list">
              {previewPlainRows.map((row, index) => (
                <div key={`${sym.id}-preview-detail-${index}`} className="shc-preview-detail-row">
                  <div className="shc-preview-detail-label">{translateArtifactPreviewLabel(row.label)}</div>
                  <div className="shc-preview-detail-value">
                    <div className="shc-preview-chip-row">
                      {(row.values.length > 1 ? row.values : [row.value]).map((value, valueIndex) =>
                        renderPreviewValueChip(
                          value,
                          `${sym.id}-preview-detail-value-${index}-${valueIndex}`,
                        ),
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {previewData.kind === "plain" && previewPlainLines.length > 0 && (
            <div className="shc-preview-box">
              {previewPlainLines.map((line, index) => (
                <div key={`${sym.id}-preview-line-${index}`} className="shc-preview-line">
                  {line}
                </div>
              ))}
            </div>
          )}

          <div className="shc-preview-note">Klick auf die Node fuer die komplette Detailansicht im Inspector.</div>
        </div>
      )}

      {/* ── Inputs (Parameters) ── */}
      {doc?.inputs && doc.inputs.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">⬇ Parameter</div>
          <div className="shc-table">
            {doc.inputs.map((inp, i) => (
              <div key={i} className="shc-table-row">
                <span className="shc-param-name">{inp.name}</span>
                {inp.type && <span className="shc-param-type">{inp.type}</span>}
                {inp.description && <span className="shc-param-desc">{inp.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Outputs (Return values) ── */}
      {doc?.outputs && doc.outputs.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">⬆ Rückgabe</div>
          <div className="shc-table">
            {doc.outputs.map((out, i) => (
              <div key={i} className="shc-table-row">
                <span className="shc-param-name">{out.name}</span>
                {out.type && <span className="shc-param-type">{out.type}</span>}
                {out.description && <span className="shc-param-desc">{out.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Calls (outgoing) ── */}
      {outgoingCallItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-arrow-right" /> Ruft auf</div>
          <div className="shc-links">{renderRelationChips(outgoingCallItems)}</div>
        </div>
      )}

      {/* ── Called by (incoming) ── */}
      {incomingCallItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-arrow-left" /> Aufgerufen von</div>
          <div className="shc-links">{renderRelationChips(incomingCallItems)}</div>
        </div>
      )}

      {/* ── Reads ── */}
      {readItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-book" /> Liest</div>
          <div className="shc-links">{renderRelationChips(readItems, "shc-link-chip shc-link-read")}</div>
        </div>
      )}

      {/* ── Read By (incoming) ── */}
      {readByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-book" /> Gelesen von</div>
          <div className="shc-links">{renderRelationChips(readByItems, "shc-link-chip shc-link-read")}</div>
        </div>
      )}

      {/* ── Writes ── */}
      {writeItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-pencil-square" /> Schreibt</div>
          <div className="shc-links">{renderRelationChips(writeItems, "shc-link-chip shc-link-write")}</div>
        </div>
      )}

      {/* ── Written By (incoming) ── */}
      {writtenByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-pencil-square" /> Geschrieben von</div>
          <div className="shc-links">{renderRelationChips(writtenByItems, "shc-link-chip shc-link-write")}</div>
        </div>
      )}

      {/* ── Imports ── */}
      {importItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-box-arrow-in-down" /> Importiert</div>
          <div className="shc-links">{renderRelationChips(importItems, "shc-link-chip shc-link-import")}</div>
        </div>
      )}

      {/* ── Imported By ── */}
      {importedByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-box-arrow-up" /> Importiert von</div>
          <div className="shc-links">{renderRelationChips(importedByItems, "shc-link-chip shc-link-import")}</div>
        </div>
      )}

      {/* ── Inherits ── */}
      {inheritItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-diagram-3" /> Erbt von</div>
          <div className="shc-links">{renderRelationChips(inheritItems, "shc-link-chip shc-link-inherit")}</div>
        </div>
      )}

      {/* ── Inherited By (incoming) ── */}
      {inheritedByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-diagram-3" /> Vererbt an</div>
          <div className="shc-links">{renderRelationChips(inheritedByItems, "shc-link-chip shc-link-inherit")}</div>
        </div>
      )}

      {/* ── Instantiates ── */}
      {instantiateItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-lightning" /> Instanziiert</div>
          <div className="shc-links">{renderRelationChips(instantiateItems, "shc-link-chip shc-link-create")}</div>
        </div>
      )}

      {/* ── Instantiated By (incoming) ── */}
      {instantiatedByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-lightning" /> Instanziiert von</div>
          <div className="shc-links">{renderRelationChips(instantiatedByItems, "shc-link-chip shc-link-create")}</div>
        </div>
      )}

      {/* ── Uses Config ── */}
      {usesConfigItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-gear" /> Konfiguration</div>
          <div className="shc-links">{renderRelationChips(usesConfigItems, "shc-link-chip shc-link-config")}</div>
        </div>
      )}

      {/* ── Config Used By (incoming) ── */}
      {configUsedByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-gear" /> Konfig. verwendet von</div>
          <div className="shc-links">{renderRelationChips(configUsedByItems, "shc-link-chip shc-link-config")}</div>
        </div>
      )}

      {/* ── Side Effects ── */}
      {doc?.sideEffects && doc.sideEffects.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-exclamation-triangle" /> Seiteneffekte</div>
          <ul className="shc-side-effects">
            {doc.sideEffects.map((se, i) => (
              <li key={i}>{se}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Children (for classes/modules) ── */}
      {info.children.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">
            <i className="bi bi-folder" /> Enthält ({info.children.length})
          </div>
          <div className="shc-links">
            {info.children.slice(0, 12).map((child) => (
              <span
                key={child.id}
                className="shc-link-chip"
                onClick={() => handleNavigate(child.id)}
                onMouseEnter={() => setLinkedNodeHighlight(child.id)}
                onMouseLeave={() => clearLinkedNodeHighlight()}
                title={child.doc?.summary}
              >
                <small style={{ opacity: 0.6, marginRight: 2 }}>{child.kind[0]}</small>
                {child.label.split(".").pop()}
              </span>
            ))}
            {info.children.length > 12 && (
              <span className="shc-dim">+{info.children.length - 12} weitere</span>
            )}
          </div>
        </div>
      )}

      {/* ── Tags ── */}
      {isDeadCode && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-x-circle" /> Dead Code — Begründung</div>
          <div className="shc-summary">{deadCodeReasonText}</div>
        </div>
      )}

      {sym.tags && sym.tags.length > 0 && (
        <div className="shc-tags">
          {sym.tags.map((t) => (
            <span
              key={t}
              className={`shc-tag ${t === "dead-code" ? "shc-tag-dead" : ""}`}
            >
              {t === "dead-code" ? <><i className="bi bi-x-circle" />{" "}</> : ""}
              {t}
            </span>
          ))}
        </div>
      )}

      {/* ── Footer hint ── */}
      <div className="shc-footer">
        Klick auf Node = Inspector · Doppelklick = Drill-down
      </div>
    </div>
  );
}


