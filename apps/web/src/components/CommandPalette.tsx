import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { collectNavigableSymbolIds, useAppStore } from "../store";
import type { Symbol as Sym } from "@dmpg/shared";

/** Short letter + color for each symbol kind */
const KIND_BADGE: Record<string, { letter: string; color: string }> = {
  module: { letter: "M", color: "#6c8cff" },
  class: { letter: "C", color: "#ffd866" },
  function: { letter: "F", color: "#80e0a0" },
  method: { letter: "M", color: "#ffab70" },
  package: { letter: "P", color: "#6c8cff" },
  constant: { letter: "K", color: "#ff6b6b" },
  script: { letter: "S", color: "#ffab70" },
  group: { letter: "G", color: "#6c8cff" },
  interface: { letter: "I", color: "#66d9ef" },
  variable: { letter: "V", color: "#c792ea" },
  external: { letter: "E", color: "#888" },
};

/** Navigate to the deepest view containing a symbol and focus it */
function goToSymbol(symbolId: string) {
  useAppStore.getState().focusSymbolInContext(symbolId);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const graph = useAppStore((s) => s.graph);
  const symbols = useMemo(() => {
    if (!graph) return [] as Sym[];
    const navigableIds = collectNavigableSymbolIds(graph);
    return graph.symbols.filter((symbol) => navigableIds.has(symbol.id));
  }, [graph]);

  // Ctrl+P opens palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        setQuery("");
        setActiveIndex(0);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  // Search results
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return symbols
      .filter((s) => {
        const label = s.label.toLowerCase();
        return (
          label.includes(q) ||
          s.kind.toLowerCase().includes(q) ||
          (s.doc?.summary ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 40);
  }, [query, symbols]);

  // Reset active when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results.length, query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const selectResult = useCallback(
    (sym: Sym) => {
      goToSymbol(sym.id);
      close();
    },
    [close],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[activeIndex]) selectResult(results[activeIndex]);
          break;
      }
    },
    [results, activeIndex, close, selectResult],
  );

  if (!open) return null;

  return (
    <div className="cmd-palette-backdrop" ref={backdropRef} onMouseDown={(e) => {
      // Close when clicking backdrop (not the palette itself)
      if (e.target === backdropRef.current) close();
    }}>
      <div className="cmd-palette">
        <div className="cmd-palette__input-wrap">
          <i className="bi bi-search cmd-palette__icon" />
          <input
            ref={inputRef}
            className="cmd-palette__input"
            type="text"
            placeholder="Symbol suchen…  (Name, Kind, Beschreibung)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {query && (
            <button className="cmd-palette__clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
              <i className="bi bi-x-lg" />
            </button>
          )}
          <kbd className="cmd-palette__kbd">Esc</kbd>
        </div>

        {query.trim().length >= 1 && (
          <div className="cmd-palette__results" ref={listRef}>
            {results.length === 0 ? (
              <div className="cmd-palette__empty">Keine Ergebnisse</div>
            ) : (
              results.map((sym, idx) => {
                const badge = KIND_BADGE[sym.kind] ?? { letter: sym.kind[0]?.toUpperCase() ?? "?", color: "#888" };
                return (
                  <div
                    key={sym.id}
                    className={`cmd-palette__result${idx === activeIndex ? " cmd-palette__result--active" : ""}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectResult(sym);
                    }}
                  >
                    <span
                      className="kind-badge"
                      style={{ background: `${badge.color}22`, color: badge.color }}
                      title={sym.kind}
                    >
                      {badge.letter}
                    </span>
                    <span className="cmd-palette__result-label">{sym.label}</span>
                    <span className="cmd-palette__result-kind">{sym.kind}</span>
                    {sym.doc?.summary && (
                      <span className="cmd-palette__result-summary">{sym.doc.summary}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
