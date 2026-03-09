import { useCallback, useLayoutEffect, useRef, useMemo, useState } from "react";
import { useAppStore } from "../store";
import { projectEdgesForView, type Symbol as Sym, type Relation, type ProjectGraph } from "@dmpg/shared";
import { buildNavigableRelationItems } from "../relationNavigation";
import { scheduleHideHover, setMouseOverCard } from "./hoverCardController";
import {
  HOVER_CARD_VIEWPORT_MARGIN,
  HOVER_CARD_WIDTH,
  buildCorridorRect,
  rectFromDomRect,
  resolveHoverCardPlacement,
  type RectBox,
} from "../hoverCardPlacement";
import { resolveNavigableSymbolId } from "../viewNavigation";

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
  "out:calls":        { iconCls: "bi-telephone-outbound", label: "calls",         cls: "calls" },
  "in:calls":         { iconCls: "bi-telephone-inbound",  label: "called by",     cls: "calls-in" },
  "out:reads":        { iconCls: "bi-book",               label: "reads",         cls: "reads" },
  "in:reads":         { iconCls: "bi-book",               label: "read by",       cls: "reads-in" },
  "out:writes":       { iconCls: "bi-pencil-square",      label: "writes",        cls: "writes" },
  "in:writes":        { iconCls: "bi-pencil-square",      label: "written by",    cls: "writes-in" },
  "out:imports":      { iconCls: "bi-box-arrow-in-down",  label: "imports",       cls: "imports" },
  "in:imports":       { iconCls: "bi-box-arrow-in-down",  label: "imported by",   cls: "imports-in" },
  "out:inherits":     { iconCls: "bi-diagram-3",          label: "inherits",      cls: "inherits" },
  "in:inherits":      { iconCls: "bi-diagram-3",          label: "inherited by",  cls: "inherits-in" },
  "out:instantiates": { iconCls: "bi-lightning",          label: "creates",       cls: "instantiates" },
  "in:instantiates":  { iconCls: "bi-lightning",          label: "created by",    cls: "instantiates-in" },
  "out:uses_config":  { iconCls: "bi-gear",               label: "config",        cls: "uses_config" },
  "in:uses_config":   { iconCls: "bi-gear",               label: "configured by", cls: "uses_config-in" },
};

function isArtifactLikeSymbol(symbol: Pick<Sym, "kind" | "umlType">): boolean {
  return (
    symbol.kind === "external" ||
    symbol.umlType === "artifact" ||
    symbol.umlType === "database" ||
    symbol.umlType === "component" ||
    symbol.umlType === "note" ||
    symbol.umlType === "external"
  );
}

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

/* ── The Hover Card Component ── */

export function SymbolHoverCard() {
  const hoverSymbolId = useAppStore((s) => s.hoverSymbolId);
  const hoverPosition = useAppStore((s) => s.hoverPosition);
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const diagramSettings = useAppStore((s) => s.diagramSettings);
  const focusSymbolInContext = useAppStore((s) => s.focusSymbolInContext);
  const openSourceViewer = useAppStore((s) => s.openSourceViewer);
  const cardRef = useRef<HTMLDivElement>(null);
  const [resolvedPosition, setResolvedPosition] = useState<{ symbolId: string; x: number; y: number } | null>(null);

  const info = useMemo(() => {
    if (!hoverSymbolId || !graph) return null;
    const sym = graph.symbols.find((s) => s.id === hoverSymbolId);
    if (!sym) return null;
    return enrichSymbol(sym, graph);
  }, [hoverSymbolId, graph]);
  const outgoingCallItems = useMemo(() => buildNavigableRelationItems(graph, info?.outgoingCalls.map(({ rel }) => rel) ?? [], "out"), [graph, info]);
  const incomingCallItems = useMemo(() => buildNavigableRelationItems(graph, info?.incomingCalls.map(({ rel }) => rel) ?? [], "in"), [graph, info]);
  const readItems = useMemo(() => buildNavigableRelationItems(graph, info?.reads.map(({ rel }) => rel) ?? [], "out"), [graph, info]);
  const readByItems = useMemo(() => buildNavigableRelationItems(graph, info?.readBy.map(({ rel }) => rel) ?? [], "in"), [graph, info]);
  const writeItems = useMemo(() => buildNavigableRelationItems(graph, info?.writes.map(({ rel }) => rel) ?? [], "out"), [graph, info]);
  const writtenByItems = useMemo(() => buildNavigableRelationItems(graph, info?.writtenBy.map(({ rel }) => rel) ?? [], "in"), [graph, info]);
  const importItems = useMemo(() => buildNavigableRelationItems(graph, info?.imports.map(({ rel }) => rel) ?? [], "out"), [graph, info]);
  const importedByItems = useMemo(() => buildNavigableRelationItems(graph, info?.importedBy.map(({ rel }) => rel) ?? [], "in"), [graph, info]);
  const inheritItems = useMemo(() => buildNavigableRelationItems(graph, info?.inherits.map(({ rel }) => rel) ?? [], "out"), [graph, info]);
  const inheritedByItems = useMemo(() => buildNavigableRelationItems(graph, info?.inheritedBy.map(({ rel }) => rel) ?? [], "in"), [graph, info]);
  const instantiateItems = useMemo(() => buildNavigableRelationItems(graph, info?.instantiates.map(({ rel }) => rel) ?? [], "out"), [graph, info]);
  const instantiatedByItems = useMemo(() => buildNavigableRelationItems(graph, info?.instantiatedBy.map(({ rel }) => rel) ?? [], "in"), [graph, info]);
  const usesConfigItems = useMemo(() => buildNavigableRelationItems(graph, info?.usesConfig.map(({ rel }) => rel) ?? [], "out"), [graph, info]);
  const configUsedByItems = useMemo(() => buildNavigableRelationItems(graph, info?.configUsedBy.map(({ rel }) => rel) ?? [], "in"), [graph, info]);

  const relatedNodeIds = useMemo(() => {
    if (!graph || !currentViewId || !hoverSymbolId) return [] as string[];

    const view = graph.views.find((entry) => entry.id === currentViewId);
    if (!view) return [] as string[];

    const hiddenSymbolIds = diagramSettings.showArtifacts
      ? new Set<string>()
      : new Set(graph.symbols.filter((symbol) => isArtifactLikeSymbol(symbol)).map((symbol) => symbol.id));
    const visibleNodeRefs = view.nodeRefs.filter((id) => !hiddenSymbolIds.has(id));
    const visibleRelations = graph.relations.filter(
      (rel) => !hiddenSymbolIds.has(rel.source) && !hiddenSymbolIds.has(rel.target),
    );
    const relationMap = new Map(graph.relations.map((rel) => [rel.id, rel]));
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
  }, [currentViewId, diagramSettings.relationFilters, diagramSettings.showArtifacts, graph, hoverSymbolId]);

  useLayoutEffect(() => {
    if (!cardRef.current || !hoverSymbolId || !hoverPosition) return;

    const updatePlacement = () => {
      if (!cardRef.current) return;

      const anchorRect = getNodeRect(hoverSymbolId);
      if (!anchorRect) {
        setResolvedPosition({
          symbolId: hoverSymbolId,
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
        symbolId: hoverSymbolId,
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
  }, [hoverPosition, hoverSymbolId, info, relatedNodeIds]);

  const handleNavigate = useCallback(
    (symId: string) => {
      if (!graph) return;
      const resolvedId = resolveNavigableSymbolId(graph, symId);
      if (!resolvedId) return;
      focusSymbolInContext(resolvedId);
      // Close hover card
      setMouseOverCard(false);
      useAppStore.getState().setHoverSymbol(null);
    },
    [graph, focusSymbolInContext],
  );

  const handleOpenSource = useCallback(() => {
    if (!info) return;
    openSourceViewer(info.sym.id, info.sym.label);
    setMouseOverCard(false);
    useAppStore.getState().setHoverSymbol(null);
  }, [info, openSourceViewer]);

  if (!info || !hoverPosition) return null;

  const cardPosition = resolvedPosition?.symbolId === hoverSymbolId
    ? { x: resolvedPosition.x, y: resolvedPosition.y }
    : hoverPosition;

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
  const renderRelationChips = (items: ReturnType<typeof buildNavigableRelationItems>, className = "shc-link-chip") => (
    items.map((item) => (
      <span
        key={item.symbolId}
        className={className}
        onClick={() => handleNavigate(item.symbolId)}
        title={item.symbol.doc?.summary}
      >
        {item.symbol.label}
      </span>
    ))
  );

  return (
    <div
      ref={cardRef}
      className="symbol-hover-card"
      style={{ left: cardPosition.x, top: cardPosition.y }}
      onMouseEnter={() => setMouseOverCard(true)}
      onMouseLeave={() => { setMouseOverCard(false); scheduleHideHover(); }}
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
          <span className="shc-link" onClick={() => handleNavigate(info.parent!.id)}>
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
          <div className="shc-links">{renderRelationChips(inheritItems)}</div>
        </div>
      )}

      {/* ── Inherited By (incoming) ── */}
      {inheritedByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-diagram-3" /> Vererbt an</div>
          <div className="shc-links">{renderRelationChips(inheritedByItems)}</div>
        </div>
      )}

      {/* ── Instantiates ── */}
      {instantiateItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-lightning" /> Instanziiert</div>
          <div className="shc-links">{renderRelationChips(instantiateItems)}</div>
        </div>
      )}

      {/* ── Instantiated By (incoming) ── */}
      {instantiatedByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-lightning" /> Instanziiert von</div>
          <div className="shc-links">{renderRelationChips(instantiatedByItems)}</div>
        </div>
      )}

      {/* ── Uses Config ── */}
      {usesConfigItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-gear" /> Konfiguration</div>
          <div className="shc-links">{renderRelationChips(usesConfigItems)}</div>
        </div>
      )}

      {/* ── Config Used By (incoming) ── */}
      {configUsedByItems.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-gear" /> Konfig. verwendet von</div>
          <div className="shc-links">{renderRelationChips(configUsedByItems)}</div>
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
