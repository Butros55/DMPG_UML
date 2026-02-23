import { useCallback, useState } from "react";
import { useAppStore } from "../store";
import { summarizeSymbol } from "../api";

export function Inspector() {
  const graph = useAppStore((s) => s.graph);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const setGraph = useAppStore((s) => s.setGraph);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const sym = graph?.symbols.find((s) => s.id === selectedSymbolId);

  const handleAiGenerate = useCallback(async () => {
    if (!sym) return;
    setAiLoading(true);
    setAiError("");
    try {
      const result = await summarizeSymbol(sym.id, undefined, sym.doc?.summary);
      // refresh graph with updated doc
      if (graph) {
        const updated = {
          ...graph,
          symbols: graph.symbols.map((s) =>
            s.id === sym.id ? { ...s, doc: { ...s.doc, ...result.doc } } : s,
          ),
        };
        setGraph(updated);
      }
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }, [sym, graph, setGraph]);

  const handleSymbolLinkClick = useCallback(
    (targetId: string) => {
      const targetSym = graph?.symbols.find((s) => s.id === targetId);
      if (!targetSym) {
        // try to find by label
        const byLabel = graph?.symbols.find(
          (s) => s.label.toLowerCase() === targetId.toLowerCase(),
        );
        if (byLabel) {
          selectSymbol(byLabel.id);
          // Navigate to containing view if needed
          const view = graph?.views.find((v) => v.nodeRefs.includes(byLabel.id));
          if (view) navigateToView(view.id);
        }
        return;
      }
      selectSymbol(targetSym.id);
      const view = graph?.views.find((v) => v.nodeRefs.includes(targetSym.id));
      if (view) navigateToView(view.id);
    },
    [graph, selectSymbol, navigateToView],
  );

  if (!sym) {
    return (
      <div className="inspector">
        <h2>Inspector</h2>
        <div className="empty-state">
          Click a node to inspect it
        </div>
      </div>
    );
  }

  const doc = sym.doc;
  const relations = graph?.relations.filter(
    (r) => r.source === sym.id || r.target === sym.id,
  ) ?? [];
  const calledBy = relations.filter((r) => r.target === sym.id && r.type === "calls");
  const callsTo = relations.filter((r) => r.source === sym.id && r.type === "calls");
  const imports = relations.filter(
    (r) => (r.source === sym.id || r.target === sym.id) && r.type === "imports",
  );

  return (
    <div className="inspector">
      <h2>Inspector</h2>

      <div className="inspector-card">
        <h3>
          <span className={`kind-badge kind-${sym.kind}`} style={{ marginRight: 6 }}>
            {sym.kind}
          </span>
          {sym.label}
        </h3>

        {sym.location && (
          <div className="location">
            📄 {sym.location.file}
            {sym.location.startLine != null && `:${sym.location.startLine}`}
            {sym.location.endLine != null && `-${sym.location.endLine}`}
          </div>
        )}

        {sym.tags && sym.tags.length > 0 && (
          <div className="tags">
            {sym.tags.map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        )}
      </div>

      {doc?.summary && (
        <div className="inspector-card">
          <div className="field-label">Summary</div>
          <div className="summary">{doc.summary}</div>
        </div>
      )}

      {doc?.inputs && doc.inputs.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Inputs</div>
          <ul>
            {doc.inputs.map((inp, i) => (
              <li key={i}>
                <strong>{inp.name}</strong>
                {inp.type && <span style={{ color: "var(--text-dim)" }}> : {inp.type}</span>}
                {inp.description && <span> — {inp.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc?.outputs && doc.outputs.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Outputs</div>
          <ul>
            {doc.outputs.map((out, i) => (
              <li key={i}>
                <strong>{out.name}</strong>
                {out.type && <span style={{ color: "var(--text-dim)" }}> : {out.type}</span>}
                {out.description && <span> — {out.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc?.sideEffects && doc.sideEffects.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Side Effects</div>
          <ul>
            {doc.sideEffects.map((se, i) => (
              <li key={i}>⚠️ {se}</li>
            ))}
          </ul>
        </div>
      )}

      {callsTo.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Calls</div>
          <ul>
            {callsTo.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span
                    className="symbol-link"
                    onClick={() => handleSymbolLinkClick(r.target)}
                  >
                    {target?.label ?? r.target}
                  </span>
                  {r.confidence != null && r.confidence < 1 && (
                    <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                      ({Math.round(r.confidence * 100)}%)
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {calledBy.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Called By</div>
          <ul>
            {calledBy.map((r) => {
              const source = graph?.symbols.find((s) => s.id === r.source);
              return (
                <li key={r.id}>
                  <span
                    className="symbol-link"
                    onClick={() => handleSymbolLinkClick(r.source)}
                  >
                    {source?.label ?? r.source}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {imports.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Imports / Imported By</div>
          <ul>
            {imports.map((r) => {
              const otherId = r.source === sym.id ? r.target : r.source;
              const other = graph?.symbols.find((s) => s.id === otherId);
              return (
                <li key={r.id}>
                  <span
                    className="symbol-link"
                    onClick={() => handleSymbolLinkClick(otherId)}
                  >
                    {other?.label ?? otherId}
                  </span>
                  <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                    ({r.source === sym.id ? "imports" : "imported by"})
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {doc?.links && doc.links.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Links</div>
          <ul>
            {doc.links.map((lnk, i) => (
              <li key={i}>
                <span
                  className="symbol-link"
                  onClick={() => handleSymbolLinkClick(lnk.symbolId)}
                >
                  {lnk.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
        <button className="btn btn-sm" onClick={handleAiGenerate} disabled={aiLoading}>
          {aiLoading ? "Generating…" : "🤖 Generate AI Docs"}
        </button>
      </div>
      {aiError && (
        <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{aiError}</div>
      )}
    </div>
  );
}
