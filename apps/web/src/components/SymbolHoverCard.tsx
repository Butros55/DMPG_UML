import { useCallback, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "../store";
import type { Symbol as Sym, Relation, ProjectGraph } from "@dmpg/shared";

/* ── Hover timer management (module-level for cross-component access) ── */

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule showing the hover card after a short delay */
export function scheduleShowHover(symbolId: string, rect: DOMRect) {
  cancelHideHover();
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    // Position: to the right of the node, or left if near screen edge
    const x = rect.right + 12 + 380 > window.innerWidth ? rect.left - 392 : rect.right + 12;
    const y = Math.max(8, Math.min(rect.top, window.innerHeight - 500));
    useAppStore.getState().setHoverSymbol(symbolId, { x, y });
    showTimer = null;
  }, 350);
}

/** Schedule hiding the hover card after a short delay (allows mouse to reach card) */
export function scheduleHideHover() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  hideTimer = setTimeout(() => {
    useAppStore.getState().setHoverSymbol(null);
    hideTimer = null;
  }, 250);
}

/** Cancel pending hide (called when mouse enters the card) */
export function cancelHideHover() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

/* ── Enriched symbol info (computed from graph relations) ── */

interface EnrichedInfo {
  sym: Sym;
  parent: Sym | null;
  children: Sym[];
  outgoingCalls: Array<{ rel: Relation; target: Sym | undefined }>;
  incomingCalls: Array<{ rel: Relation; source: Sym | undefined }>;
  reads: Array<{ rel: Relation; target: Sym | undefined }>;
  writes: Array<{ rel: Relation; target: Sym | undefined }>;
  imports: Array<{ rel: Relation; target: Sym | undefined }>;
  importedBy: Array<{ rel: Relation; source: Sym | undefined }>;
  inherits: Array<{ rel: Relation; target: Sym | undefined }>;
  instantiates: Array<{ rel: Relation; target: Sym | undefined }>;
  usesConfig: Array<{ rel: Relation; target: Sym | undefined }>;
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

  const writes = rels
    .filter((r) => r.source === sym.id && r.type === "writes")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const imports = rels
    .filter((r) => r.source === sym.id && r.type === "imports")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const importedBy = rels
    .filter((r) => r.target === sym.id && r.type === "imports")
    .map((r) => ({ rel: r, source: findSym(r.source) }));

  const inherits = rels
    .filter((r) => r.source === sym.id && r.type === "inherits")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const instantiates = rels
    .filter((r) => r.source === sym.id && r.type === "instantiates")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

  const usesConfig = rels
    .filter((r) => r.source === sym.id && r.type === "uses_config")
    .map((r) => ({ rel: r, target: findSym(r.target) }));

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
    writes,
    imports,
    importedBy,
    inherits,
    instantiates,
    usesConfig,
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

/* ── The Hover Card Component ── */

export function SymbolHoverCard() {
  const hoverSymbolId = useAppStore((s) => s.hoverSymbolId);
  const hoverPosition = useAppStore((s) => s.hoverPosition);
  const graph = useAppStore((s) => s.graph);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const setFocusNode = useAppStore((s) => s.setFocusNode);
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
      selectSymbol(symId);
      const view = graph?.views.find((v) => v.nodeRefs.includes(symId));
      if (view) navigateToView(view.id);
      setFocusNode(symId);
      // Close hover card
      useAppStore.getState().setHoverSymbol(null);
    },
    [graph, selectSymbol, navigateToView, setFocusNode],
  );

  if (!info || !hoverPosition) return null;

  const { sym } = info;
  const doc = sym.doc;
  const loc = sym.location;
  const kindColor = KIND_COLORS[sym.kind] ?? "#8b8fa7";

  // Build compact signature
  const sigParts = doc?.inputs?.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ") ?? "";
  const returnType = doc?.outputs?.map((o) => o.type ?? o.name).join(", ") ?? "";

  return (
    <div
      ref={cardRef}
      className="symbol-hover-card"
      style={{ left: hoverPosition.x, top: hoverPosition.y }}
      onMouseEnter={cancelHideHover}
      onMouseLeave={() => scheduleHideHover()}
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
          📄 {loc.file}
          {loc.startLine != null && `:${loc.startLine}`}
          {loc.endLine != null && `-${loc.endLine}`}
          {info.lineCount != null && (
            <span className="shc-line-count"> ({info.lineCount} Zeilen)</span>
          )}
        </div>
      )}

      {/* ── Parent ── */}
      {info.parent && (
        <div className="shc-parent">
          📦 in:{" "}
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
          <div className="shc-section-label">→ Ruft auf</div>
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
          <div className="shc-section-label">← Aufgerufen von</div>
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
          <div className="shc-section-label">📖 Liest</div>
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

      {/* ── Writes ── */}
      {info.writes.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">📝 Schreibt</div>
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

      {/* ── Imports ── */}
      {info.imports.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">📥 Importiert</div>
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
          <div className="shc-section-label">📤 Importiert von</div>
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
          <div className="shc-section-label">🧬 Erbt von</div>
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

      {/* ── Instantiates ── */}
      {info.instantiates.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">🏗 Instanziiert</div>
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

      {/* ── Uses Config ── */}
      {info.usesConfig.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">⚙ Konfiguration</div>
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

      {/* ── Side Effects ── */}
      {doc?.sideEffects && doc.sideEffects.length > 0 && (
        <div className="shc-section">
          <div className="shc-section-label">⚠ Seiteneffekte</div>
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
            📁 Enthält ({info.children.length})
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
      {sym.tags && sym.tags.length > 0 && (
        <div className="shc-tags">
          {sym.tags.map((t) => (
            <span
              key={t}
              className={`shc-tag ${t === "dead-code" ? "shc-tag-dead" : ""}`}
            >
              {t === "dead-code" ? "💀 " : ""}
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
