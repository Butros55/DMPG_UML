import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store";
import { summarizeSymbol } from "../api";
import { scheduleShowHover, scheduleHideHover } from "./SymbolHoverCard";
import type { Relation, RelationType } from "@dmpg/shared";

const RELATION_TYPES: RelationType[] = ["imports", "contains", "calls", "reads", "writes", "inherits", "uses_config", "instantiates"];
const SYMBOL_KINDS = ["module", "class", "function", "method", "group", "package", "interface", "variable"] as const;

/* ─── AI Badge + Validation Buttons ─── */
function AiBadge({ field, symbolId, onConfirm, onReject }: {
  field: string;
  symbolId: string;
  onConfirm: (symbolId: string, field: string) => void;
  onReject: (symbolId: string, field: string) => void;
}) {
  return (
    <span className="ai-badge-group">
      <span className="ai-badge" title="Vom LLM generiert"><i className="bi bi-cpu" /> AI</span>
      <button
        className="ai-action-btn ai-confirm-btn"
        onClick={(e) => { e.stopPropagation(); onConfirm(symbolId, field); }}
        title="Bestätigen — AI-Markierung entfernen"
      ><i className="bi bi-check-lg" /></button>
      <button
        className="ai-action-btn ai-reject-btn"
        onClick={(e) => { e.stopPropagation(); onReject(symbolId, field); }}
        title="Ablehnen — Eintrag löschen"
      ><i className="bi bi-x-lg" /></button>
    </span>
  );
}

function AiRelationBadge({ relationId, onConfirm, onReject }: {
  relationId: string;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <span className="ai-badge-group">
      <span className="ai-badge" title="Vom LLM entdeckt"><i className="bi bi-cpu" /></span>
      <button
        className="ai-action-btn ai-confirm-btn"
        onClick={(e) => { e.stopPropagation(); onConfirm(relationId); }}
        title="Bestätigen"
      ><i className="bi bi-check-lg" /></button>
      <button
        className="ai-action-btn ai-reject-btn"
        onClick={(e) => { e.stopPropagation(); onReject(relationId); }}
        title="Löschen"
      ><i className="bi bi-x-lg" /></button>
    </span>
  );
}

/** Classify whether a symbol is project-defined (not standard library / built-in) */
function isProjectOwn(sym: { kind: string; label: string } | undefined): boolean {
  if (!sym) return false;
  if (sym.kind !== "external") return true;
  // External symbols representing project data files are project-own
  if (/\.(csv|xlsx?|json|ya?ml|toml|txt|dat|sql|parquet|h5|pkl|pickle|feather|arrow)$/i.test(sym.label)) return true;
  return false;
}

/** Reusable list that partitions relation targets into project-own (top, highlighted) and stdlib (collapsed) */
function RelationItemList({
  relations,
  direction,
  graph,
  showKind,
  showConfidence,
  onSymbolClick,
  onConfirmAi,
  onRejectAi,
}: {
  relations: Relation[];
  direction: "out" | "in";
  graph: { symbols: Array<{ id: string; kind: string; label: string }> } | null;
  showKind?: boolean;
  showConfidence?: boolean;
  onSymbolClick: (id: string) => void;
  onConfirmAi: (id: string) => void;
  onRejectAi: (id: string) => void;
}) {
  const [showStdlib, setShowStdlib] = useState(false);

  const { own, stdlib } = useMemo(() => {
    const ownArr: Array<{ r: Relation; otherId: string; sym: { id: string; kind: string; label: string } | undefined; isOwn: true }> = [];
    const stdlibArr: Array<{ r: Relation; otherId: string; sym: { id: string; kind: string; label: string } | undefined; isOwn: false }> = [];
    for (const r of relations) {
      const otherId = direction === "out" ? r.target : r.source;
      const sym = graph?.symbols.find((s) => s.id === otherId);
      if (isProjectOwn(sym)) {
        ownArr.push({ r, otherId, sym, isOwn: true });
      } else {
        stdlibArr.push({ r, otherId, sym, isOwn: false });
      }
    }
    return { own: ownArr, stdlib: stdlibArr };
  }, [relations, graph, direction]);

  const renderItem = ({ r, otherId, sym, isOwn }: { r: Relation; otherId: string; sym: { id: string; kind: string; label: string } | undefined; isOwn: boolean }) => (
    <li key={r.id} className={`rel-item ${isOwn ? "rel-own" : "rel-stdlib"} ${r.aiGenerated ? "ai-generated-item" : ""}`}>
      <SymbolLink symbolId={otherId} label={sym?.label ?? otherId} onClick={() => onSymbolClick(otherId)} />
      {showKind && sym?.kind && <span className="rel-kind">({sym.kind})</span>}
      {showConfidence && r.confidence != null && r.confidence < 1 && (
        <span className="rel-confidence">{Math.round(r.confidence * 100)}%</span>
      )}
      {r.aiGenerated && <AiRelationBadge relationId={r.id} onConfirm={onConfirmAi} onReject={onRejectAi} />}
    </li>
  );

  return (
    <ul>
      {own.map(renderItem)}
      {stdlib.length > 0 && (
        <li className="rel-stdlib-header" onClick={() => setShowStdlib(!showStdlib)}>
          <span className="rel-stdlib-toggle"><i className={showStdlib ? "bi bi-chevron-down" : "bi bi-chevron-right"} /></span>
          Vordefiniert ({stdlib.length})
        </li>
      )}
      {showStdlib && stdlib.map(renderItem)}
    </ul>
  );
}

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
          <SymbolLink symbolId={srcSym?.id ?? ""} label={srcSym?.label ?? rel?.source ?? projSrc} onClick={() => srcSym && handleSymbolClick(srcSym.id)} />
          {" → "}
          <SymbolLink symbolId={tgtSym?.id ?? ""} label={tgtSym?.label ?? rel?.target ?? projTgt} onClick={() => tgtSym && handleSymbolClick(tgtSym.id)} />
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
                  <SymbolLink symbolId={r.source} label={s?.label ?? r.source} onClick={() => handleSymbolClick(r.source)} />
                  {" → "}
                  <SymbolLink symbolId={r.target} label={t?.label ?? r.target} onClick={() => handleSymbolClick(r.target)} />
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
              <i className="bi bi-trash" /> Delete Edge
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

/* ─── Hoverable Symbol Link — shows HoverCard on hover, navigates on click ─── */
function SymbolLink({ symbolId, label, onClick }: { symbolId: string; label: string; onClick: () => void }) {
  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      scheduleShowHover(symbolId, rect);
    },
    [symbolId],
  );

  return (
    <span
      className="symbol-link"
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => scheduleHideHover()}
    >
      {label}
    </span>
  );
}

/* ─── AI Inspector Animation Hook ─── */
/**
 * Detects when AI-generated content changes in the inspector for the selected symbol.
 * Returns a CSS class string that triggers a typewriter-style reveal animation
 * on the inspector card content.
 */
function useAiInspectorAnimation(sym: { id: string; doc?: { summary?: string; inputs?: unknown[]; outputs?: unknown[]; sideEffects?: unknown[]; aiGenerated?: Record<string, unknown> } } | undefined): string {
  const [animClass, setAnimClass] = useState("");
  const prevSnap = useRef("");
  const prevSymId = useRef<string | null>(null);
  const aiRunning = useAppStore((s) => s.aiAnalysis?.running ?? false);

  useEffect(() => {
    if (!sym) { prevSnap.current = ""; prevSymId.current = null; return; }

    const snap = `${sym.doc?.summary ?? ""}|${(sym.doc?.inputs as unknown[])?.length ?? 0}|${(sym.doc?.outputs as unknown[])?.length ?? 0}|${(sym.doc?.sideEffects as unknown[])?.length ?? 0}`;

    // If symbol changed, reset without animating
    if (prevSymId.current !== sym.id) {
      prevSymId.current = sym.id;
      prevSnap.current = snap;
      return;
    }

    if (snap !== prevSnap.current && aiRunning) {
      prevSnap.current = snap;
      setAnimClass("inspector-ai-typing");
      const timer = setTimeout(() => setAnimClass(""), 2500);
      return () => clearTimeout(timer);
    }

    prevSnap.current = snap;
  }, [sym?.id, sym?.doc?.summary, sym?.doc?.inputs, sym?.doc?.outputs, sym?.doc?.sideEffects, aiRunning]);

  return animClass;
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
  const confirmAiField = useAppStore((s) => s.confirmAiField);
  const rejectAiField = useAppStore((s) => s.rejectAiField);
  const confirmAiRelation = useAppStore((s) => s.confirmAiRelation);
  const openSourceViewer = useAppStore((s) => s.openSourceViewer);
  const removeRelation = useAppStore((s) => s.removeRelation);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Editing states
  const [editLabel, setEditLabel] = useState("");
  const [editKind, setEditKind] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // Tag editing
  const [newTag, setNewTag] = useState("");

  // Section-level inline editing
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editInputs, setEditInputs] = useState<Array<{ name: string; type: string; description: string }>>([]);
  const [editOutputs, setEditOutputs] = useState<Array<{ name: string; type: string; description: string }>>([]);
  const [editSideEffects, setEditSideEffects] = useState<string[]>([]);
  const [newSideEffect, setNewSideEffect] = useState("");

  // New connection state
  const [showAddConn, setShowAddConn] = useState(false);
  const [connTarget, setConnTarget] = useState("");
  const [connType, setConnType] = useState<string>("calls");
  const [connLabel, setConnLabel] = useState("calls");

  const sym = graph?.symbols.find((s) => s.id === selectedSymbolId);
  const inspectorAnimClass = useAiInspectorAnimation(sym);

  // Reset edit form when symbol changes
  useEffect(() => {
    if (sym) {
      setEditLabel(sym.label);
      setEditKind(sym.kind);
      setEditSummary(sym.doc?.summary ?? "");
      setIsEditing(false);
      setShowAddConn(false);
      setEditingSection(null);
      setNewTag("");
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

  // ─── Tag helpers ───
  const handleAddTag = useCallback(() => {
    if (!sym || !newTag.trim()) return;
    const tags = [...(sym.tags ?? []), newTag.trim()];
    updateSymbol(sym.id, { tags });
    setNewTag("");
  }, [sym, newTag, updateSymbol]);

  const handleRemoveTag = useCallback((tag: string) => {
    if (!sym) return;
    const tags = (sym.tags ?? []).filter((t) => t !== tag);
    updateSymbol(sym.id, { tags });
  }, [sym, updateSymbol]);

  // ─── Parameter (inputs) helpers ───
  const handleStartEditInputs = useCallback(() => {
    const inputs = sym?.doc?.inputs ?? [];
    setEditInputs(inputs.map((p) => ({ name: p.name, type: p.type ?? "", description: p.description ?? "" })));
    setEditingSection("inputs");
  }, [sym]);

  const handleSaveInputs = useCallback(() => {
    if (!sym) return;
    const cleaned = editInputs.filter((p) => p.name.trim());
    updateSymbol(sym.id, {
      doc: { ...sym.doc, inputs: cleaned.length ? cleaned.map((p) => ({ name: p.name, type: p.type || undefined, description: p.description || undefined })) : undefined },
    });
    setEditingSection(null);
  }, [sym, editInputs, updateSymbol]);

  const handleAddInput = useCallback(() => {
    setEditInputs((prev) => [...prev, { name: "", type: "", description: "" }]);
  }, []);

  const handleRemoveInput = useCallback((idx: number) => {
    setEditInputs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleInputChange = useCallback((idx: number, field: "name" | "type" | "description", value: string) => {
    setEditInputs((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, []);

  // ─── Output helpers ───
  const handleStartEditOutputs = useCallback(() => {
    const outputs = sym?.doc?.outputs ?? [];
    setEditOutputs(outputs.map((p) => ({ name: p.name, type: p.type ?? "", description: p.description ?? "" })));
    setEditingSection("outputs");
  }, [sym]);

  const handleSaveOutputs = useCallback(() => {
    if (!sym) return;
    const cleaned = editOutputs.filter((p) => p.name.trim());
    updateSymbol(sym.id, {
      doc: { ...sym.doc, outputs: cleaned.length ? cleaned.map((p) => ({ name: p.name, type: p.type || undefined, description: p.description || undefined })) : undefined },
    });
    setEditingSection(null);
  }, [sym, editOutputs, updateSymbol]);

  const handleAddOutput = useCallback(() => {
    setEditOutputs((prev) => [...prev, { name: "", type: "", description: "" }]);
  }, []);

  const handleRemoveOutput = useCallback((idx: number) => {
    setEditOutputs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleOutputChange = useCallback((idx: number, field: "name" | "type" | "description", value: string) => {
    setEditOutputs((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, []);

  // ─── Side Effects helpers ───
  const handleStartEditSideEffects = useCallback(() => {
    setEditSideEffects([...(sym?.doc?.sideEffects ?? [])]);
    setNewSideEffect("");
    setEditingSection("sideEffects");
  }, [sym]);

  const handleSaveSideEffects = useCallback(() => {
    if (!sym) return;
    const cleaned = editSideEffects.filter((s) => s.trim());
    updateSymbol(sym.id, {
      doc: { ...sym.doc, sideEffects: cleaned.length ? cleaned : undefined },
    });
    setEditingSection(null);
  }, [sym, editSideEffects, updateSymbol]);

  const handleAddSideEffect = useCallback(() => {
    if (!newSideEffect.trim()) return;
    setEditSideEffects((prev) => [...prev, newSideEffect.trim()]);
    setNewSideEffect("");
  }, [newSideEffect]);

  const handleRemoveSideEffect = useCallback((idx: number) => {
    setEditSideEffects((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSideEffectChange = useCallback((idx: number, value: string) => {
    setEditSideEffects((prev) => prev.map((s, i) => i === idx ? value : s));
  }, []);

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
  const readBy = relations.filter((r) => r.target === sym.id && r.type === "reads");
  const writes = relations.filter((r) => r.source === sym.id && r.type === "writes");
  const writtenBy = relations.filter((r) => r.target === sym.id && r.type === "writes");
  const importsR = relations.filter((r) => r.source === sym.id && r.type === "imports");
  const importedByR = relations.filter((r) => r.target === sym.id && r.type === "imports");
  const inheritsR = relations.filter((r) => r.source === sym.id && r.type === "inherits");
  const inheritedByR = relations.filter((r) => r.target === sym.id && r.type === "inherits");
  const instantiatesR = relations.filter((r) => r.source === sym.id && r.type === "instantiates");
  const instantiatedByR = relations.filter((r) => r.target === sym.id && r.type === "instantiates");
  const usesConfigR = relations.filter((r) => r.source === sym.id && r.type === "uses_config");
  const configUsedByR = relations.filter((r) => r.target === sym.id && r.type === "uses_config");
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

  const deadCodeReasonText = (() => {
    const explicit = (doc?.deadCodeReason ?? "").trim();
    if (explicit) return explicit;

    const inboundCallCount = incomingCalls.length + instantiatedByR.length;
    const outboundCallCount = outgoingCalls.length + instantiatesR.length;

    if (inboundCallCount === 0 && outboundCallCount === 0) {
      return "Keine eingehenden oder ausgehenden Aufrufbeziehungen gefunden. Das Symbol ist im aktuellen Graphen nicht eingebunden und wurde deshalb als Dead Code markiert.";
    }
    if (inboundCallCount === 0) {
      return "Keine eingehenden Aufrufe/Instanziierungen gefunden. Das Symbol wird aktuell von keinem anderen Symbol verwendet und wurde deshalb als Dead Code markiert.";
    }
    return "Das Symbol trägt das Dead-Code-Tag, aber es liegt keine detaillierte LLM-Begründung vor. Bitte Analyse erneut ausführen, um die genaue Ursache zu aktualisieren.";
  })();

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
                <i className="bi bi-pencil" />
              </button>
            </h3>

            {sym.location && (
              <div className="location">
                <i className="bi bi-file-earmark" /> {sym.location.file}
                {sym.location.startLine != null && `:${sym.location.startLine}`}
                {sym.location.endLine != null && `-${sym.location.endLine}`}
                <button
                  className="source-view-btn"
                  onClick={() => openSourceViewer(sym.id, sym.label)}
                  title="Quellcode anzeigen"
                >
                  <i className="bi bi-code-square" /> Code
                </button>
              </div>
            )}

            {/* ─── Editable Tags ─── */}
            <div className="tags">
              {(sym.tags ?? []).map((t) => (
                <span key={t} className={`tag${t === "dead-code" && doc?.aiGenerated?.deadCode ? " ai-tagged" : ""}`}>
                  {t}
                  {t === "dead-code" && doc?.aiGenerated?.deadCode && (
                    <AiBadge field="deadCode" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
                  )}
                  <button
                    className="tag-remove-btn"
                    onClick={() => handleRemoveTag(t)}
                    title={`Tag "${t}" entfernen`}
                  >×</button>
                </span>
              ))}
              <span className="tag-add-inline">
                <input
                  className="tag-add-input"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(); }}
                  placeholder="+ Tag"
                />
                {newTag.trim() && (
                  <button className="tag-add-btn" onClick={handleAddTag} title="Tag hinzufügen">+</button>
                )}
              </span>
            </div>

            {/* ─── Dead Code Reason ─── */}
            {sym.tags?.includes("dead-code") && (
              <div className="dead-code-reason">
                <div className="dead-code-reason-header">
                  <span className="dead-code-reason-icon"><i className="bi bi-x-circle" /></span>
                  <span>Dead Code — Begründung</span>
                </div>
                <p className="dead-code-reason-text">{deadCodeReasonText}</p>
                {sym.location && (
                  <div className="dead-code-source-ref">
                    <i className="bi bi-file-earmark" /> {sym.location.file}
                    {sym.location.startLine != null && `:${sym.location.startLine}`}
                    {sym.location.endLine != null && `-${sym.location.endLine}`}
                  </div>
                )}
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
                <i className="bi bi-floppy" /> Save
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
        <div className={`inspector-card${doc.aiGenerated?.summary ? ` ai-generated-card ${inspectorAnimClass}` : ""}`}>
          <div className="field-label">
            Beschreibung
            {doc.aiGenerated?.summary && (
              <AiBadge field="summary" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
          </div>
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
          <div className="field-label"><i className="bi bi-box" /> Übergeordnet</div>
          <SymbolLink
            symbolId={parentSym.id}
            label={parentSym.label}
            onClick={() => handleSymbolLinkClick(parentSym.id)}
          />
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}> ({parentSym.kind})</span>
        </div>
      )}

      {/* ─── Line count ─── */}
      {lineCount != null && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-rulers" /> Umfang</div>
          <span>{lineCount} Zeilen</span>
        </div>
      )}

      {/* ─── Parameters (inputs) ─── */}
      {(editingSection === "inputs" || (doc?.inputs && doc.inputs.length > 0)) && (
        <div className={`inspector-card${doc?.aiGenerated?.inputs ? ` ai-generated-card ${inspectorAnimClass}` : ""}`}>
          <div className="field-label">
            <i className="bi bi-arrow-down" /> Parameter
            {doc?.aiGenerated?.inputs && (
              <AiBadge field="inputs" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
            {editingSection !== "inputs" && (
              <button className="section-edit-btn" onClick={handleStartEditInputs} title="Parameter bearbeiten"><i className="bi bi-pencil" /></button>
            )}
          </div>
          {editingSection === "inputs" ? (
            <div className="section-edit-form">
              {editInputs.map((inp, i) => (
                <div key={i} className="param-edit-row">
                  <input className="param-edit-input param-edit-name" value={inp.name} onChange={(e) => handleInputChange(i, "name", e.target.value)} placeholder="Name" />
                  <input className="param-edit-input param-edit-type" value={inp.type} onChange={(e) => handleInputChange(i, "type", e.target.value)} placeholder="Typ" />
                  <input className="param-edit-input param-edit-desc" value={inp.description} onChange={(e) => handleInputChange(i, "description", e.target.value)} placeholder="Beschreibung" />
                  <button className="param-remove-btn" onClick={() => handleRemoveInput(i)} title="Entfernen">×</button>
                </div>
              ))}
              <div className="section-edit-actions">
                <button className="btn btn-xs" onClick={handleAddInput}>+ Parameter</button>
                <button className="btn btn-xs btn-primary" onClick={handleSaveInputs}><i className="bi bi-floppy" /> Speichern</button>
                <button className="btn btn-xs" onClick={() => setEditingSection(null)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <table className="inspector-param-table">
              <tbody>
                {doc!.inputs!.map((inp, i) => (
                  <tr key={i}>
                    <td className="param-name-cell">{inp.name}</td>
                    <td className="param-type-cell">{inp.type ?? "—"}</td>
                    <td className="param-desc-cell">{inp.description ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* Add Parameters when none exist */}
      {!doc?.inputs?.length && editingSection !== "inputs" && (
        <div className="inspector-card">
          <button className="btn btn-xs" onClick={handleStartEditInputs}>+ Parameter hinzufügen</button>
        </div>
      )}

      {/* ─── Outputs ─── */}
      {(editingSection === "outputs" || (doc?.outputs && doc.outputs.length > 0)) && (
        <div className={`inspector-card${doc?.aiGenerated?.outputs ? ` ai-generated-card ${inspectorAnimClass}` : ""}`}>
          <div className="field-label">
            <i className="bi bi-arrow-up" /> Rückgabe
            {doc?.aiGenerated?.outputs && (
              <AiBadge field="outputs" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
            {editingSection !== "outputs" && (
              <button className="section-edit-btn" onClick={handleStartEditOutputs} title="Rückgabe bearbeiten"><i className="bi bi-pencil" /></button>
            )}
          </div>
          {editingSection === "outputs" ? (
            <div className="section-edit-form">
              {editOutputs.map((out, i) => (
                <div key={i} className="param-edit-row">
                  <input className="param-edit-input param-edit-name" value={out.name} onChange={(e) => handleOutputChange(i, "name", e.target.value)} placeholder="Name" />
                  <input className="param-edit-input param-edit-type" value={out.type} onChange={(e) => handleOutputChange(i, "type", e.target.value)} placeholder="Typ" />
                  <input className="param-edit-input param-edit-desc" value={out.description} onChange={(e) => handleOutputChange(i, "description", e.target.value)} placeholder="Beschreibung" />
                  <button className="param-remove-btn" onClick={() => handleRemoveOutput(i)} title="Entfernen">×</button>
                </div>
              ))}
              <div className="section-edit-actions">
                <button className="btn btn-xs" onClick={handleAddOutput}>+ Rückgabe</button>
                <button className="btn btn-xs btn-primary" onClick={handleSaveOutputs}><i className="bi bi-floppy" /> Speichern</button>
                <button className="btn btn-xs" onClick={() => setEditingSection(null)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <table className="inspector-param-table">
              <tbody>
                {doc!.outputs!.map((out, i) => (
                  <tr key={i}>
                    <td className="param-name-cell">{out.name}</td>
                    <td className="param-type-cell">{out.type ?? "—"}</td>
                    <td className="param-desc-cell">{out.description ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* Add Outputs when none exist */}
      {!doc?.outputs?.length && editingSection !== "outputs" && (
        <div className="inspector-card">
          <button className="btn btn-xs" onClick={handleStartEditOutputs}>+ Rückgabe hinzufügen</button>
        </div>
      )}

      {/* ─── Side Effects ─── */}
      {(editingSection === "sideEffects" || (doc?.sideEffects && doc.sideEffects.length > 0)) && (
        <div className={`inspector-card${doc?.aiGenerated?.sideEffects ? " ai-generated-card" : ""}`}>
          <div className="field-label">
            <i className="bi bi-exclamation-triangle" /> Seiteneffekte
            {doc?.aiGenerated?.sideEffects && (
              <AiBadge field="sideEffects" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
            {editingSection !== "sideEffects" && (
              <button className="section-edit-btn" onClick={handleStartEditSideEffects} title="Seiteneffekte bearbeiten"><i className="bi bi-pencil" /></button>
            )}
          </div>
          {editingSection === "sideEffects" ? (
            <div className="section-edit-form">
              {editSideEffects.map((se, i) => (
                <div key={i} className="side-effect-edit-row">
                  <input className="inspector-input" value={se} onChange={(e) => handleSideEffectChange(i, e.target.value)} />
                  <button className="param-remove-btn" onClick={() => handleRemoveSideEffect(i)} title="Entfernen">×</button>
                </div>
              ))}
              <div className="side-effect-add-row">
                <input
                  className="inspector-input"
                  value={newSideEffect}
                  onChange={(e) => setNewSideEffect(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSideEffect(); }}
                  placeholder="Neuer Seiteneffekt"
                />
                <button className="btn btn-xs" onClick={handleAddSideEffect} disabled={!newSideEffect.trim()}>+</button>
              </div>
              <div className="section-edit-actions">
                <button className="btn btn-xs btn-primary" onClick={handleSaveSideEffects}><i className="bi bi-floppy" /> Speichern</button>
                <button className="btn btn-xs" onClick={() => setEditingSection(null)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <ul>
              {doc!.sideEffects!.map((se, i) => (
                <li key={i}><i className="bi bi-exclamation-triangle" /> {se}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* Add SideEffects when none exist */}
      {!doc?.sideEffects?.length && editingSection !== "sideEffects" && (
        <div className="inspector-card">
          <button className="btn btn-xs" onClick={handleStartEditSideEffects}>+ Seiteneffekt hinzufügen</button>
        </div>
      )}

      {/* ─── Calls (outgoing) ─── */}
      {outgoingCalls.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-arrow-right" /> Ruft auf ({outgoingCalls.length})</div>
          <RelationItemList
            relations={outgoingCalls}
            direction="out"
            graph={graph}
            showKind
            showConfidence
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Called by (incoming) ─── */}
      {incomingCalls.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-arrow-left" /> Aufgerufen von ({incomingCalls.length})</div>
          <RelationItemList
            relations={incomingCalls}
            direction="in"
            graph={graph}
            showKind
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Reads ─── */}
      {reads.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-book" /> Liest ({reads.length})</div>
          <RelationItemList
            relations={reads}
            direction="out"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Read by ─── */}
      {readBy.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-book" /> Gelesen von ({readBy.length})</div>
          <RelationItemList
            relations={readBy}
            direction="in"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Writes ─── */}
      {writes.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-pencil-square" /> Schreibt ({writes.length})</div>
          <RelationItemList
            relations={writes}
            direction="out"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Written by ─── */}
      {writtenBy.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-pencil-square" /> Geschrieben von ({writtenBy.length})</div>
          <RelationItemList
            relations={writtenBy}
            direction="in"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Imports ─── */}
      {importsR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-box-arrow-in-down" /> Importiert ({importsR.length})</div>
          <RelationItemList
            relations={importsR}
            direction="out"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Imported by ─── */}
      {importedByR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-box-arrow-up" /> Importiert von ({importedByR.length})</div>
          <RelationItemList
            relations={importedByR}
            direction="in"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Inherits ─── */}
      {inheritsR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-diagram-3" /> Erbt von ({inheritsR.length})</div>
          <RelationItemList
            relations={inheritsR}
            direction="out"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Inherited by ─── */}
      {inheritedByR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-diagram-3" /> Vererbt an ({inheritedByR.length})</div>
          <RelationItemList
            relations={inheritedByR}
            direction="in"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Instantiates ─── */}
      {instantiatesR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-lightning" /> Instanziiert ({instantiatesR.length})</div>
          <RelationItemList
            relations={instantiatesR}
            direction="out"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Instantiated by ─── */}
      {instantiatedByR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-lightning" /> Instanziiert von ({instantiatedByR.length})</div>
          <RelationItemList
            relations={instantiatedByR}
            direction="in"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Uses Config ─── */}
      {usesConfigR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-gear" /> Konfiguration ({usesConfigR.length})</div>
          <RelationItemList
            relations={usesConfigR}
            direction="out"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </div>
      )}

      {/* ─── Config used by ─── */}
      {configUsedByR.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-gear" /> Konfig. verwendet von ({configUsedByR.length})</div>
          <RelationItemList
            relations={configUsedByR}
            direction="in"
            graph={graph}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
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
                <li key={r.id} className={r.aiGenerated ? "ai-generated-item" : ""}>
                  <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 4 }}>
                    {isOut ? <i className="bi bi-arrow-right" /> : <i className="bi bi-arrow-left" />} {r.type}
                  </span>
                  <SymbolLink symbolId={otherId} label={other?.label ?? otherId} onClick={() => handleSymbolLinkClick(otherId)} />
                  {r.aiGenerated && (
                    <AiRelationBadge relationId={r.id} onConfirm={confirmAiRelation} onReject={(id) => removeRelation(id)} />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ─── Children ─── */}
      {children.length > 0 && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-folder" /> Enthält ({children.length})</div>
          <ul>
            {children.slice(0, 20).map((child) => (
              <li key={child.id}>
                <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 4 }}>{child.kind}</span>
                <SymbolLink symbolId={child.id} label={child.label.split(".").pop() ?? child.label} onClick={() => handleSymbolLinkClick(child.id)} />
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
          <div className="field-label"><i className="bi bi-link-45deg" /> Links</div>
          <ul>
            {doc.links.map((lnk, i) => (
              <li key={i}>
                <SymbolLink symbolId={lnk.symbolId} label={lnk.label} onClick={() => handleSymbolLinkClick(lnk.symbolId)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Add Connection ─── */}
      <div className="inspector-card">
        {!showAddConn ? (
          <button className="btn btn-sm" onClick={() => setShowAddConn(true)}>
            <i className="bi bi-plus-circle" /> Add Connection
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
                <i className="bi bi-check-circle" /> Add
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
          {aiLoading ? "Generating…" : <><i className="bi bi-cpu" /> Generate AI Docs</>}
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => { removeSymbol(sym.id); selectSymbol(null); }}
        >
          <i className="bi bi-trash" /> Delete Node
        </button>
      </div>
      {aiError && (
        <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{aiError}</div>
      )}
    </div>
  );
}
