import { useCallback, useState, useEffect } from "react";
import { useAppStore } from "../store";
import { summarizeSymbol } from "../api";
import type { Relation, RelationType } from "@dmpg/shared";

const RELATION_TYPES: RelationType[] = ["imports", "contains", "calls", "reads", "writes", "inherits", "uses_config", "instantiates"];
const SYMBOL_KINDS = ["module", "class", "function", "method", "group", "package", "interface", "variable"] as const;

/* ─── Edge Inspector Panel ─── */
function EdgeInspector() {
  const graph = useAppStore((s) => s.graph);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const updateRelation = useAppStore((s) => s.updateRelation);
  const removeRelation = useAppStore((s) => s.removeRelation);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const setFocusNode = useAppStore((s) => s.setFocusNode);

  // Try direct relation lookup first
  const rel = graph?.relations.find((r) => r.id === selectedEdgeId);

  // If not found, parse as projected edge key: "source|target|type"
  const projectedParts = !rel && selectedEdgeId ? selectedEdgeId.split("|") : null;
  const isProjected = projectedParts && projectedParts.length === 3;
  const projSrc = isProjected ? projectedParts[0] : null;
  const projTgt = isProjected ? projectedParts[1] : null;
  const projType = isProjected ? projectedParts[2] : null;

  // For projected edges, find the underlying relations
  const projectedRelations = isProjected
    ? (graph?.relations.filter((r) => r.type === projType) ?? []).filter((r) => {
        // Check if source/target ancestors include the projected endpoints
        const srcChain = getAncestorChain(r.source, graph?.symbols ?? []);
        const tgtChain = getAncestorChain(r.target, graph?.symbols ?? []);
        return srcChain.includes(projSrc!) && tgtChain.includes(projTgt!);
      })
    : [];

  const srcSym = graph?.symbols.find((s) => s.id === (rel?.source ?? projSrc));
  const tgtSym = graph?.symbols.find((s) => s.id === (rel?.target ?? projTgt));

  const [label, setLabel] = useState(rel?.label ?? projType ?? "");
  const [relType, setRelType] = useState<RelationType>((rel?.type ?? projType ?? "calls") as RelationType);

  useEffect(() => {
    setLabel(rel?.label ?? projType ?? "");
    setRelType((rel?.type ?? projType ?? "calls") as RelationType);
  }, [rel, projType]);

  if (!rel && !isProjected) return null;

  const handleSave = () => {
    if (rel) {
      updateRelation(rel.id, { label, type: relType as Relation["type"] });
    }
  };

  const handleSymbolClick = (symId: string) => {
    selectSymbol(symId);
    const view = graph?.views.find((v) => v.nodeRefs.includes(symId));
    if (view) {
      navigateToView(view.id);
      setFocusNode(symId);
    }
  };

  return (
    <div className="inspector">
      <h2>Edge Inspector</h2>

      <div className="inspector-card">
        <h3 style={{ fontSize: 13 }}>
          <span className="symbol-link" onClick={() => srcSym && handleSymbolClick(srcSym.id)}>
            {srcSym?.label ?? rel?.source ?? projSrc}
          </span>
          {" → "}
          <span className="symbol-link" onClick={() => tgtSym && handleSymbolClick(tgtSym.id)}>
            {tgtSym?.label ?? rel?.target ?? projTgt}
          </span>
        </h3>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          Type: <strong style={{ color: "var(--accent)" }}>{rel?.type ?? projType}</strong>
          {isProjected && projectedRelations.length > 1 && (
            <span> ({projectedRelations.length} aggregated)</span>
          )}
          {rel?.confidence != null && rel.confidence < 1 && (
            <span> · Confidence: {Math.round(rel.confidence * 100)}%</span>
          )}
        </div>
      </div>

      {/* Show underlying relations for projected edges */}
      {isProjected && projectedRelations.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Underlying Relations</div>
          <ul>
            {projectedRelations.slice(0, 20).map((r) => {
              const s = graph?.symbols.find((sym) => sym.id === r.source);
              const t = graph?.symbols.find((sym) => sym.id === r.target);
              return (
                <li key={r.id} style={{ fontSize: 11 }}>
                  <span className="symbol-link" onClick={() => handleSymbolClick(r.source)}>
                    {s?.label ?? r.source}
                  </span>
                  {" → "}
                  <span className="symbol-link" onClick={() => handleSymbolClick(r.target)}>
                    {t?.label ?? r.target}
                  </span>
                  {r.confidence != null && r.confidence < 1 && (
                    <span style={{ color: "var(--text-dim)" }}> ({Math.round(r.confidence * 100)}%)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Edit label/type only for direct relations */}
      {rel && (
        <>
          <div className="inspector-card">
            <div className="field-label">Label</div>
            <input
              className="inspector-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="z.B. calls, imports, uses…"
            />
          </div>

          <div className="inspector-card">
            <div className="field-label">Type</div>
            <select
              className="inspector-select"
              value={relType}
              onChange={(e) => {
                const val = e.target.value as RelationType;
                setRelType(val);
                updateRelation(rel.id, { type: val, label: val });
                setLabel(val);
              }}
            >
              {RELATION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
            <button className="btn btn-sm btn-danger" onClick={() => { removeRelation(rel.id); selectEdge(null); }}>
              🗑 Delete Edge
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Helper: get ancestor chain for a symbol */
function getAncestorChain(symId: string, symbols: { id: string; parentId?: string }[]): string[] {
  const chain = [symId];
  let current = symbols.find((s) => s.id === symId);
  let depth = 0;
  while (current?.parentId && depth < 20) {
    chain.push(current.parentId);
    current = symbols.find((s) => s.id === current!.parentId);
    depth++;
  }
  return chain;
}

/* ─── Symbol Inspector Panel ─── */
export function Inspector() {
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const setFocusNode = useAppStore((s) => s.setFocusNode);
  const updateGraph = useAppStore((s) => s.updateGraph);
  const updateSymbol = useAppStore((s) => s.updateSymbol);
  const removeSymbol = useAppStore((s) => s.removeSymbol);
  const addRelation = useAppStore((s) => s.addRelation);
  const inspectorCollapsed = useAppStore((s) => s.inspectorCollapsed);
  const toggleInspector = useAppStore((s) => s.toggleInspector);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Editing states
  const [editLabel, setEditLabel] = useState("");
  const [editKind, setEditKind] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // New connection state
  const [showAddConn, setShowAddConn] = useState(false);
  const [connTarget, setConnTarget] = useState("");
  const [connType, setConnType] = useState<string>("calls");
  const [connLabel, setConnLabel] = useState("calls");

  const sym = graph?.symbols.find((s) => s.id === selectedSymbolId);

  // Reset edit form when symbol changes
  useEffect(() => {
    if (sym) {
      setEditLabel(sym.label);
      setEditKind(sym.kind);
      setEditSummary(sym.doc?.summary ?? "");
      setIsEditing(false);
      setShowAddConn(false);
    }
  }, [sym?.id]);

  const handleAiGenerate = useCallback(async () => {
    if (!sym) return;
    setAiLoading(true);
    setAiError("");
    try {
      const result = await summarizeSymbol(sym.id, undefined, sym.doc?.summary);
      if (graph) {
        const updated = {
          ...graph,
          symbols: graph.symbols.map((s) =>
            s.id === sym.id ? { ...s, doc: { ...s.doc, ...result.doc } } : s,
          ),
        };
        updateGraph(updated);
      }
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }, [sym, graph, updateGraph]);

  const handleSaveEdit = useCallback(() => {
    if (!sym) return;
    updateSymbol(sym.id, {
      label: editLabel,
      kind: editKind as any,
      doc: { ...sym.doc, summary: editSummary },
    });
    setIsEditing(false);
  }, [sym, editLabel, editKind, editSummary, updateSymbol]);

  const handleAddConnection = useCallback(() => {
    if (!sym || !connTarget || !currentViewId) return;
    const relId = `rel-${Date.now()}`;
    const newRel: Relation = {
      id: relId,
      type: connType as Relation["type"],
      source: sym.id,
      target: connTarget,
      label: connLabel || connType,
      confidence: 1,
    };
    addRelation(newRel, currentViewId);
    setShowAddConn(false);
    setConnTarget("");
    setConnType("calls");
    setConnLabel("calls");
  }, [sym, connTarget, connType, connLabel, currentViewId, addRelation]);

  const handleSymbolLinkClick = useCallback(
    (targetId: string) => {
      const targetSym = graph?.symbols.find((s) => s.id === targetId);
      if (!targetSym) {
        const byLabel = graph?.symbols.find(
          (s) => s.label.toLowerCase() === targetId.toLowerCase(),
        );
        if (byLabel) {
          selectSymbol(byLabel.id);
          const view = graph?.views.find((v) => v.nodeRefs.includes(byLabel.id));
          if (view) navigateToView(view.id);
          setFocusNode(byLabel.id);
        }
        return;
      }
      selectSymbol(targetSym.id);
      const view = graph?.views.find((v) => v.nodeRefs.includes(targetSym.id));
      if (view) navigateToView(view.id);
      setFocusNode(targetSym.id);
    },
    [graph, selectSymbol, navigateToView, setFocusNode],
  );

  // If an edge is selected, show edge inspector (AFTER all hooks!)
  if (inspectorCollapsed) {
    return (
      <div className="inspector inspector--collapsed">
        <button className="inspector-toggle-btn" onClick={toggleInspector} title="Inspector öffnen">»</button>
      </div>
    );
  }

  if (selectedEdgeId && !selectedSymbolId) {
    return (
      <>
        <EdgeInspector />
        <button className="inspector-toggle-btn inspector-toggle-btn--inside" onClick={toggleInspector} title="Inspector schließen">«</button>
      </>
    );
  }

  if (!sym) {
    return (
      <div className="inspector">
        <button className="inspector-toggle-btn inspector-toggle-btn--inside" onClick={toggleInspector} title="Inspector schließen">«</button>
        <h2>Inspector</h2>
        <div className="empty-state">
          Click a node or edge to inspect it
        </div>
      </div>
    );
  }

  const doc = sym.doc;
  const relations = graph?.relations.filter(
    (r) => r.source === sym.id || r.target === sym.id,
  ) ?? [];

  // Enriched info — compute from graph relations
  const outgoingCalls = relations.filter((r) => r.source === sym.id && r.type === "calls");
  const incomingCalls = relations.filter((r) => r.target === sym.id && r.type === "calls");
  const reads = relations.filter((r) => r.source === sym.id && r.type === "reads");
  const writes = relations.filter((r) => r.source === sym.id && r.type === "writes");
  const importsR = relations.filter((r) => r.source === sym.id && r.type === "imports");
  const importedByR = relations.filter((r) => r.target === sym.id && r.type === "imports");
  const inheritsR = relations.filter((r) => r.source === sym.id && r.type === "inherits");
  const instantiatesR = relations.filter((r) => r.source === sym.id && r.type === "instantiates");
  const usesConfigR = relations.filter((r) => r.source === sym.id && r.type === "uses_config");
  const parentSym = sym.parentId ? graph?.symbols.find((s) => s.id === sym.parentId) : null;
  const children = graph?.symbols.filter((s) => s.parentId === sym.id) ?? [];
  const lineCount = sym.location?.startLine != null && sym.location?.endLine != null
    ? sym.location.endLine - sym.location.startLine + 1
    : null;

  // Build signature
  const sigParams = doc?.inputs?.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ") ?? "";
  const returnType = doc?.outputs?.map((o) => o.type ?? o.name).join(", ") ?? "";

  // Group remaining relations by type (exclude what's shown separately)
  const shownTypes = new Set(["calls", "reads", "writes", "imports", "inherits", "instantiates", "uses_config", "contains"]);
  const otherRelations = relations.filter((r) => !shownTypes.has(r.type));

  // Available nodes for connection target (all symbols in graph except current)
  const availableTargets = graph?.symbols.filter((s) => s.id !== sym.id) ?? [];

  return (
    <div className="inspector">
      <button className="inspector-toggle-btn inspector-toggle-btn--inside" onClick={toggleInspector} title="Inspector schließen">«</button>
      <h2>Inspector</h2>

      {/* ─── Node Header / Edit Toggle ─── */}
      <div className="inspector-card">
        {!isEditing ? (
          <>
            <h3>
              <span className={`kind-badge kind-${sym.kind}`} style={{ marginRight: 6 }}>
                {sym.kind}
              </span>
              {sym.label}
              <button
                className="btn-icon"
                title="Edit"
                onClick={() => setIsEditing(true)}
                style={{ marginLeft: 8, cursor: "pointer", background: "none", border: "none", color: "var(--accent)", fontSize: 14 }}
              >
                ✏️
              </button>
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
          </>
        ) : (
          /* ─── Inline Edit Form ─── */
          <div className="node-edit-form">
            <div className="field-label">Name</div>
            <input
              className="inspector-input"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
            />

            <div className="field-label" style={{ marginTop: 8 }}>Kind</div>
            <select
              className="inspector-select"
              value={editKind}
              onChange={(e) => setEditKind(e.target.value)}
            >
              {SYMBOL_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>

            <div className="field-label" style={{ marginTop: 8 }}>Summary</div>
            <textarea
              className="inspector-textarea"
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              rows={3}
            />

            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <button className="btn btn-sm btn-primary" onClick={handleSaveEdit}>
                💾 Save
              </button>
              <button className="btn btn-sm" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Summary (read-only when not editing) ─── */}
      {!isEditing && doc?.summary && (
        <div className="inspector-card">
          <div className="field-label">Beschreibung</div>
          <div className="summary">{doc.summary}</div>
        </div>
      )}

      {/* ─── Signature (for functions/methods) ─── */}
      {!isEditing && (sym.kind === "function" || sym.kind === "method") && (doc?.inputs?.length || doc?.outputs?.length) && (
        <div className="inspector-card">
          <div className="field-label">Signatur</div>
          <div className="inspector-signature">
            <span style={{ color: "#c9a0ff" }}>def</span>{" "}
            <span style={{ color: "#80e0a0" }}>{sym.label.split(".").pop()}</span>
            <span style={{ color: "var(--text-dim)" }}>(</span>
            <span>{sigParams || "…"}</span>
            <span style={{ color: "var(--text-dim)" }}>)</span>
            {returnType && (
              <span style={{ color: "var(--accent)" }}> → {returnType}</span>
            )}
          </div>
        </div>
      )}

      {/* ─── Parent module / class ─── */}
      {parentSym && (
        <div className="inspector-card">
          <div className="field-label">📦 Übergeordnet</div>
          <span
            className="symbol-link"
            onClick={() => handleSymbolLinkClick(parentSym.id)}
          >
            {parentSym.label}
          </span>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}> ({parentSym.kind})</span>
        </div>
      )}

      {/* ─── Line count ─── */}
      {lineCount != null && (
        <div className="inspector-card">
          <div className="field-label">📏 Umfang</div>
          <span>{lineCount} Zeilen</span>
        </div>
      )}

      {doc?.inputs && doc.inputs.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">⬇ Parameter</div>
          <table className="inspector-param-table">
            <tbody>
              {doc.inputs.map((inp, i) => (
                <tr key={i}>
                  <td className="param-name-cell">{inp.name}</td>
                  <td className="param-type-cell">{inp.type ?? "—"}</td>
                  <td className="param-desc-cell">{inp.description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doc?.outputs && doc.outputs.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">⬆ Rückgabe</div>
          <table className="inspector-param-table">
            <tbody>
              {doc.outputs.map((out, i) => (
                <tr key={i}>
                  <td className="param-name-cell">{out.name}</td>
                  <td className="param-type-cell">{out.type ?? "—"}</td>
                  <td className="param-desc-cell">{out.description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doc?.sideEffects && doc.sideEffects.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">⚠ Seiteneffekte</div>
          <ul>
            {doc.sideEffects.map((se, i) => (
              <li key={i}>⚠️ {se}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Calls (outgoing) ─── */}
      {outgoingCalls.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">→ Ruft auf ({outgoingCalls.length})</div>
          <ul>
            {outgoingCalls.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.target)}>
                    {target?.label ?? r.target}
                  </span>
                  {target?.kind && (
                    <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                      ({target.kind})
                    </span>
                  )}
                  {r.confidence != null && r.confidence < 1 && (
                    <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                      {Math.round(r.confidence * 100)}%
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Called by (incoming) ─── */}
      {incomingCalls.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">← Aufgerufen von ({incomingCalls.length})</div>
          <ul>
            {incomingCalls.map((r) => {
              const source = graph?.symbols.find((s) => s.id === r.source);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.source)}>
                    {source?.label ?? r.source}
                  </span>
                  {source?.kind && (
                    <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                      ({source.kind})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Reads ─── */}
      {reads.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">📖 Liest ({reads.length})</div>
          <ul>
            {reads.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.target)}>
                    {target?.label ?? r.target}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Writes ─── */}
      {writes.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">📝 Schreibt ({writes.length})</div>
          <ul>
            {writes.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.target)}>
                    {target?.label ?? r.target}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Imports ─── */}
      {importsR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">📥 Importiert ({importsR.length})</div>
          <ul>
            {importsR.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.target)}>
                    {target?.label ?? r.target}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Imported by ─── */}
      {importedByR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">📤 Importiert von ({importedByR.length})</div>
          <ul>
            {importedByR.map((r) => {
              const source = graph?.symbols.find((s) => s.id === r.source);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.source)}>
                    {source?.label ?? r.source}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Inherits ─── */}
      {inheritsR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">🧬 Erbt von</div>
          <ul>
            {inheritsR.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.target)}>
                    {target?.label ?? r.target}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Instantiates ─── */}
      {instantiatesR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">🏗 Instanziiert</div>
          <ul>
            {instantiatesR.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.target)}>
                    {target?.label ?? r.target}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Uses Config ─── */}
      {usesConfigR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">⚙ Konfiguration</div>
          <ul>
            {usesConfigR.map((r) => {
              const target = graph?.symbols.find((s) => s.id === r.target);
              return (
                <li key={r.id}>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(r.target)}>
                    {target?.label ?? r.target}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Other relations ─── */}
      {otherRelations.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Weitere Relationen ({otherRelations.length})</div>
          <ul>
            {otherRelations.map((r) => {
              const isOut = r.source === sym.id;
              const otherId = isOut ? r.target : r.source;
              const other = graph?.symbols.find((s) => s.id === otherId);
              return (
                <li key={r.id}>
                  <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 4 }}>
                    {isOut ? "→" : "←"} {r.type}
                  </span>
                  <span className="symbol-link" onClick={() => handleSymbolLinkClick(otherId)}>
                    {other?.label ?? otherId}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Children ─── */}
      {children.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">📁 Enthält ({children.length})</div>
          <ul>
            {children.slice(0, 20).map((child) => (
              <li key={child.id}>
                <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 4 }}>{child.kind}</span>
                <span className="symbol-link" onClick={() => handleSymbolLinkClick(child.id)}>
                  {child.label.split(".").pop()}
                </span>
                {child.doc?.summary && (
                  <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                    — {child.doc.summary.slice(0, 50)}{child.doc.summary.length > 50 ? "…" : ""}
                  </span>
                )}
              </li>
            ))}
            {children.length > 20 && (
              <li style={{ color: "var(--text-dim)" }}>+{children.length - 20} weitere…</li>
            )}
          </ul>
        </div>
      )}

      {doc?.links && doc.links.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">🔗 Links</div>
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

      {/* ─── Add Connection ─── */}
      <div className="inspector-card">
        {!showAddConn ? (
          <button className="btn btn-sm" onClick={() => setShowAddConn(true)}>
            ➕ Add Connection
          </button>
        ) : (
          <div className="add-connection-form">
            <div className="field-label">Target Node</div>
            <select
              className="inspector-select"
              value={connTarget}
              onChange={(e) => setConnTarget(e.target.value)}
            >
              <option value="">-- Select target --</option>
              {availableTargets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.kind})
                </option>
              ))}
            </select>

            <div className="field-label" style={{ marginTop: 6 }}>Type</div>
            <select
              className="inspector-select"
              value={connType}
              onChange={(e) => { setConnType(e.target.value); setConnLabel(e.target.value); }}
            >
              {RELATION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <div className="field-label" style={{ marginTop: 6 }}>Label</div>
            <input
              className="inspector-input"
              value={connLabel}
              onChange={(e) => setConnLabel(e.target.value)}
              placeholder="Edge label"
            />

            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleAddConnection}
                disabled={!connTarget}
              >
                ✅ Add
              </button>
              <button className="btn btn-sm" onClick={() => setShowAddConn(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Actions ─── */}
      <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={handleAiGenerate} disabled={aiLoading}>
          {aiLoading ? "Generating…" : "🤖 Generate AI Docs"}
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => { removeSymbol(sym.id); selectSymbol(null); }}
        >
          🗑 Delete Node
        </button>
      </div>
      {aiError && (
        <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{aiError}</div>
      )}
    </div>
  );
}
