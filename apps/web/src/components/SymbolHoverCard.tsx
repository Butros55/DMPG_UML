import { useCallback, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "../store";
import type { Symbol as Sym, Relation, ProjectGraph } from "@dmpg/shared";

/* ── Hover timer management (module-level for cross-component access) ── */

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** True while the pointer is physically over the hover card. */
let _mouseOverCard = false;
/** While true, hover open is fully blocked (used during drag interactions). */
let _hoverBlocked = false;
/** Absolute time until hover remains suppressed after unblock. */
let _hoverSuppressedUntil = 0;

const HOVER_SHOW_DELAY_MS = 560;
const HOVER_HIDE_DELAY_MS = 300;

function hoverIsSuppressed(): boolean {
  return _hoverBlocked || Date.now() < _hoverSuppressedUntil;
}

/**
 * Blocks/unblocks hover card interactions globally.
 * - `blocked=true`: hide immediately and cancel all timers.
 * - `blocked=false`: optionally keep hover suppressed for `suppressMs`.
 */
export function setHoverInteractionBlocked(blocked: boolean, suppressMs = 0) {
  _hoverBlocked = blocked;

  if (blocked) {
    _mouseOverCard = false;
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    useAppStore.getState().setHoverSymbol(null);
    return;
  }

  _hoverSuppressedUntil = suppressMs > 0 ? Date.now() + suppressMs : 0;
}

/** Schedule showing the hover card after a short delay */
export function scheduleShowHover(symbolId: string, rect: DOMRect) {
  if (hoverIsSuppressed()) return;
  cancelHideHover();
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    if (hoverIsSuppressed()) {
      showTimer = null;
      return;
    }
    // Position: to the right of the node, or left if near screen edge
    const x = rect.right + 12 + 380 > window.innerWidth ? rect.left - 392 : rect.right + 12;
    const y = Math.max(8, Math.min(rect.top, window.innerHeight - 500));
    useAppStore.getState().setHoverSymbol(symbolId, { x, y });
    showTimer = null;
  }, HOVER_SHOW_DELAY_MS);
}

/** Schedule hiding the hover card after a short delay (allows mouse to reach card) */
export function scheduleHideHover() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  // Always clear previous hide timer to avoid duplicate / orphan timeouts
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (hoverIsSuppressed()) {
    _mouseOverCard = false;
    useAppStore.getState().setHoverSymbol(null);
    return;
  }
  hideTimer = setTimeout(() => {
    hideTimer = null;
    // Safety: never close while the pointer is physically over the card
    if (_mouseOverCard) return;
    useAppStore.getState().setHoverSymbol(null);
  }, HOVER_HIDE_DELAY_MS);
}

/** Cancel pending hide (called when mouse enters the card) */
export function cancelHideHover() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

/** Notify that the pointer entered / left the card surface. */
export function setMouseOverCard(over: boolean) {
  _mouseOverCard = over;
  if (over) cancelHideHover();
}

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

/* ── The Hover Card Component ── */

export function SymbolHoverCard() {
  const hoverSymbolId = useAppStore((s) => s.hoverSymbolId);
  const hoverPosition = useAppStore((s) => s.hoverPosition);
  const graph = useAppStore((s) => s.graph);
  const focusSymbolInContext = useAppStore((s) => s.focusSymbolInContext);
  const openSourceViewer = useAppStore((s) => s.openSourceViewer);
  const cardRef = useRef<HTMLDivElement>(null);

  const info = useMemo(() => {
    if (!hoverSymbolId || !graph) return null;
    const sym = graph.symbols.find((s) => s.id === hoverSymbolId);
    if (!sym) return null;
    return enrichSymbol(sym, graph);
  }, [hoverSymbolId, graph]);

  // Reposition if card goes off-screen
  useEffect(() => {
    if (!cardRef.current || !hoverPosition) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      cardRef.current.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    }
  }, [info, hoverPosition]);

  const handleNavigate = useCallback(
    (symId: string) => {
      const targetSym = graph?.symbols.find((s) => s.id === symId);
      if (!targetSym) return;
      focusSymbolInContext(symId);
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

  const { sym } = info;
  const doc = sym.doc;
  const loc = sym.location;
  const kindColor = KIND_COLORS[sym.kind] ?? "#8b8fa7";

  // Build compact signature
  const sigParts = doc?.inputs?.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ") ?? "";
  const returnType = doc?.outputs?.map((o) => o.type ?? o.name).join(", ") ?? "";
  const isDeadCode = sym.tags?.includes("dead-code") ?? false;
  const relationBadgeKeys = [
    ...(info.outgoingCalls.length > 0 ? ["out:calls"] : []),
    ...(info.incomingCalls.length > 0 ? ["in:calls"] : []),
    ...(info.reads.length > 0 ? ["out:reads"] : []),
    ...(info.readBy.length > 0 ? ["in:reads"] : []),
    ...(info.writes.length > 0 ? ["out:writes"] : []),
    ...(info.writtenBy.length > 0 ? ["in:writes"] : []),
    ...(info.imports.length > 0 ? ["out:imports"] : []),
    ...(info.importedBy.length > 0 ? ["in:imports"] : []),
    ...(info.inherits.length > 0 ? ["out:inherits"] : []),
    ...(info.inheritedBy.length > 0 ? ["in:inherits"] : []),
    ...(info.instantiates.length > 0 ? ["out:instantiates"] : []),
    ...(info.instantiatedBy.length > 0 ? ["in:instantiates"] : []),
    ...(info.usesConfig.length > 0 ? ["out:uses_config"] : []),
    ...(info.configUsedBy.length > 0 ? ["in:uses_config"] : []),
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

  return (
    <div
      ref={cardRef}
      className="symbol-hover-card"
      style={{ left: hoverPosition.x, top: hoverPosition.y }}
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
      {info.outgoingCalls.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-arrow-right" /> Ruft auf</div>
          <div className="shc-links">
            {info.outgoingCalls.map(({ rel, target }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => target && handleNavigate(target.id)}
                title={target?.doc?.summary}
              >
                {target?.label ?? rel.target}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Called by (incoming) ── */}
      {info.incomingCalls.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-arrow-left" /> Aufgerufen von</div>
          <div className="shc-links">
            {info.incomingCalls.map(({ rel, source }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => source && handleNavigate(source.id)}
                title={source?.doc?.summary}
              >
                {source?.label ?? rel.source}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Reads ── */}
      {info.reads.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-book" /> Liest</div>
          <div className="shc-links">
            {info.reads.map(({ rel, target }) => (
              <span
                key={rel.id}
                className="shc-link-chip shc-link-read"
                onClick={() => target && handleNavigate(target.id)}
              >
                {target?.label ?? rel.target}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Read By (incoming) ── */}
      {info.readBy.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-book" /> Gelesen von</div>
          <div className="shc-links">
            {info.readBy.map(({ rel, source }) => (
              <span
                key={rel.id}
                className="shc-link-chip shc-link-read"
                onClick={() => source && handleNavigate(source.id)}
              >
                {source?.label ?? rel.source}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Writes ── */}
      {info.writes.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-pencil-square" /> Schreibt</div>
          <div className="shc-links">
            {info.writes.map(({ rel, target }) => (
              <span
                key={rel.id}
                className="shc-link-chip shc-link-write"
                onClick={() => target && handleNavigate(target.id)}
              >
                {target?.label ?? rel.target}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Written By (incoming) ── */}
      {info.writtenBy.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-pencil-square" /> Geschrieben von</div>
          <div className="shc-links">
            {info.writtenBy.map(({ rel, source }) => (
              <span
                key={rel.id}
                className="shc-link-chip shc-link-write"
                onClick={() => source && handleNavigate(source.id)}
              >
                {source?.label ?? rel.source}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Imports ── */}
      {info.imports.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-box-arrow-in-down" /> Importiert</div>
          <div className="shc-links">
            {info.imports.map(({ rel, target }) => (
              <span
                key={rel.id}
                className="shc-link-chip shc-link-import"
                onClick={() => target && handleNavigate(target.id)}
              >
                {target?.label ?? rel.target}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Imported By ── */}
      {info.importedBy.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-box-arrow-up" /> Importiert von</div>
          <div className="shc-links">
            {info.importedBy.map(({ rel, source }) => (
              <span
                key={rel.id}
                className="shc-link-chip shc-link-import"
                onClick={() => source && handleNavigate(source.id)}
              >
                {source?.label ?? rel.source}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Inherits ── */}
      {info.inherits.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-diagram-3" /> Erbt von</div>
          <div className="shc-links">
            {info.inherits.map(({ rel, target }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => target && handleNavigate(target.id)}
              >
                {target?.label ?? rel.target}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Inherited By (incoming) ── */}
      {info.inheritedBy.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-diagram-3" /> Vererbt an</div>
          <div className="shc-links">
            {info.inheritedBy.map(({ rel, source }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => source && handleNavigate(source.id)}
              >
                {source?.label ?? rel.source}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Instantiates ── */}
      {info.instantiates.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-lightning" /> Instanziiert</div>
          <div className="shc-links">
            {info.instantiates.map(({ rel, target }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => target && handleNavigate(target.id)}
              >
                {target?.label ?? rel.target}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Instantiated By (incoming) ── */}
      {info.instantiatedBy.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-lightning" /> Instanziiert von</div>
          <div className="shc-links">
            {info.instantiatedBy.map(({ rel, source }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => source && handleNavigate(source.id)}
              >
                {source?.label ?? rel.source}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Uses Config ── */}
      {info.usesConfig.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-gear" /> Konfiguration</div>
          <div className="shc-links">
            {info.usesConfig.map(({ rel, target }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => target && handleNavigate(target.id)}
              >
                {target?.label ?? rel.target}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Config Used By (incoming) ── */}
      {info.configUsedBy.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label"><i className="bi bi-gear" /> Konfig. verwendet von</div>
          <div className="shc-links">
            {info.configUsedBy.map(({ rel, source }) => (
              <span
                key={rel.id}
                className="shc-link-chip"
                onClick={() => source && handleNavigate(source.id)}
              >
                {source?.label ?? rel.source}
              </span>
            ))}
          </div>
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
