import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useAppStore } from "../store";
import { openInIde, type IdeName } from "../api";

const PHASE_LABELS: Record<string, string> = {
  labels: "Label",
  docs: "Dokumentation",
  relations: "Beziehung",
  "dead-code": "Dead Code",
};

const PHASE_ICONS: Record<string, string> = {
  labels: "bi-tag",
  docs: "bi-file-text",
  relations: "bi-diagram-3",
  "dead-code": "bi-trash3",
};

function DiffView({ before, after }: { before: string; after: string }) {
  if (!before && after) {
    return (
      <div className="validate-diff">
        <div className="validate-diff-added">{after}</div>
      </div>
    );
  }
  if (before && !after) {
    return (
      <div className="validate-diff">
        <div className="validate-diff-removed">{before}</div>
      </div>
    );
  }
  return (
    <div className="validate-diff">
      <div className="validate-diff-removed">{before}</div>
      <div className="validate-diff-arrow"><i className="bi bi-arrow-down" /></div>
      <div className="validate-diff-added">{after}</div>
    </div>
  );
}

export function ValidatePanel() {
  const validateState = useAppStore((s) => s.validateState);
  const graph = useAppStore((s) => s.graph);
  const exitValidateMode = useAppStore((s) => s.exitValidateMode);
  const validateNavigateTo = useAppStore((s) => s.validateNavigateTo);
  const validateNext = useAppStore((s) => s.validateNext);
  const validatePrev = useAppStore((s) => s.validatePrev);
  const validateConfirm = useAppStore((s) => s.validateConfirm);
  const validateReject = useAppStore((s) => s.validateReject);
  const validateConfirmAll = useAppStore((s) => s.validateConfirmAll);
  const aiNavPaused = useAppStore((s) => s.aiAnalysis?.navPaused ?? false);
  const toggleAiNavPaused = useAppStore((s) => s.toggleAiNavPaused);
  const [reviewComment, setReviewComment] = useState("");

  // IDE selection
  const [selectedIde, setSelectedIde] = useState<IdeName>("vscode");
  const [ideStatus, setIdeStatus] = useState<string | null>(null);

  // Drag support for floating panel
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, select, .validate-close-btn")) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { mx: e.clientX, my: e.clientY, ox: dragOffset.x, oy: dragOffset.y };
  }, [dragOffset]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.mx;
      const dy = e.clientY - dragStartRef.current.my;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = panelRef.current?.offsetWidth ?? 380;
      const nx = Math.max(-pw / 2, Math.min(vw - pw / 2, dragStartRef.current.ox + dx));
      const ny = Math.max(0, Math.min(vh - 60, dragStartRef.current.oy + dy));
      setDragOffset({ x: nx, y: ny });
    };
    const onUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  const currentChange = validateState.active && validateState.currentIndex >= 0
    ? validateState.changes[validateState.currentIndex]
    : null;

  const stats = useMemo(() => {
    if (!validateState.active) return { total: 0, pending: 0, confirmed: 0, rejected: 0 };
    return {
      total: validateState.changes.length,
      pending: validateState.changes.filter((c) => c.status === "pending").length,
      confirmed: validateState.changes.filter((c) => c.status === "confirmed").length,
      rejected: validateState.changes.filter((c) => c.status === "rejected").length,
    };
  }, [validateState]);

  const handleOpenInIde = useCallback(async () => {
    if (!currentChange || !graph) return;
    const sym = graph.symbols.find((s) => s.id === currentChange.symbolId);
    if (sym?.location?.file) {
      setIdeStatus(`Öffne in ${selectedIde === "vscode" ? "VS Code" : "IntelliJ"}…`);
      try {
        await openInIde(selectedIde, sym.location.file, sym.location.startLine);
        setIdeStatus("✅ Geöffnet");
        setTimeout(() => setIdeStatus(null), 2000);
      } catch (err: any) {
        setIdeStatus(`⚠️ ${err.message}`);
        setTimeout(() => setIdeStatus(null), 3000);
      }
    }
  }, [currentChange, graph, selectedIde]);

  const handleOpenDiff = useCallback(async () => {
    if (!currentChange || !graph) return;
    const sym = graph.symbols.find((s) => s.id === currentChange.symbolId);
    if (!sym?.location?.file) return;
    setIdeStatus(`Öffne Diff in ${selectedIde === "vscode" ? "VS Code" : "IntelliJ"}…`);
    try {
      await openInIde(selectedIde, sym.location.file, sym.location.startLine, "diff", sym.location.file);
      setIdeStatus("✅ Diff geöffnet");
      setTimeout(() => setIdeStatus(null), 2000);
    } catch (err: any) {
      setIdeStatus(`⚠️ ${err.message}`);
      setTimeout(() => setIdeStatus(null), 3000);
    }
  }, [currentChange, graph, selectedIde]);

  // Keyboard shortcuts for validate mode
  useEffect(() => {
    if (!validateState.active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); validateNext(); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); validatePrev(); }
      if (e.key === "Enter" || e.key === "y") { if (currentChange) { e.preventDefault(); validateConfirm(currentChange.id, reviewComment); setReviewComment(""); } }
      if (e.key === "Backspace" || e.key === "n") { if (currentChange) { e.preventDefault(); validateReject(currentChange.id, reviewComment); setReviewComment(""); } }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [validateState.active, currentChange, validateNext, validatePrev, validateConfirm, validateReject, reviewComment]);

  if (!validateState.active) return null;

  // When dragged, render as floating fixed panel
  const isFloating = dragOffset.x !== 0 || dragOffset.y !== 0;
  const panelStyle: React.CSSProperties = isFloating
    ? { position: "fixed", left: dragOffset.x, top: dragOffset.y, zIndex: 1000, width: 380 }
    : { gridArea: "validate" };

  return (
    <div className="validate-panel" style={panelStyle} ref={panelRef}>
      {/* Header — draggable */}
      <div
        className="validate-panel-header"
        onMouseDown={handleDragStart}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="validate-panel-title">
          <i className="bi bi-patch-check" />
          <span>AI-Änderungen prüfen</span>
          <span className="validate-drag-hint" title="Zum Verschieben ziehen"><i className="bi bi-grip-vertical" /></span>
        </div>
        <button className="validate-close-btn" onClick={exitValidateMode} title="Validierung beenden">
          <i className="bi bi-x-lg" />
        </button>
      </div>

      {/* Stats bar */}
      <div className="validate-stats">
        <span className="validate-stat" title="Ausstehend">
          <i className="bi bi-hourglass-split" /> {stats.pending}
        </span>
        <span className="validate-stat validate-stat-confirmed" title="Bestätigt">
          <i className="bi bi-check-circle" /> {stats.confirmed}
        </span>
        <span className="validate-stat validate-stat-rejected" title="Abgelehnt">
          <i className="bi bi-x-circle" /> {stats.rejected}
        </span>
        <span className="validate-stat-sep">|</span>
        <span className="validate-stat">{stats.total} gesamt</span>
      </div>

      {/* IDE selector */}
      <div className="validate-ide-selector">
        <label className="validate-ide-label">IDE:</label>
        <select
          className="validate-ide-select"
          value={selectedIde}
          onChange={(e) => setSelectedIde(e.target.value as IdeName)}
        >
          <option value="vscode">VS Code</option>
          <option value="intellij">IntelliJ IDEA</option>
        </select>
        {ideStatus && <span className="validate-ide-status">{ideStatus}</span>}
      </div>

      {/* Navigation controls */}
      <div className="validate-nav">
        <button
          className="validate-nav-btn"
          onClick={toggleAiNavPaused}
          title={aiNavPaused ? "Auto-Navigation fortsetzen" : "Auto-Navigation pausieren"}
        >
          <i className={`bi ${aiNavPaused ? "bi-play-fill" : "bi-pause-fill"}`} />
        </button>
        <button className="validate-nav-btn" onClick={validatePrev} title="Vorherige Änderung (↑ / k)">
          <i className="bi bi-chevron-up" />
        </button>
        <span className="validate-nav-pos">
          {validateState.currentIndex >= 0 ? validateState.currentIndex + 1 : 0} / {stats.total}
        </span>
        <button className="validate-nav-btn" onClick={validateNext} title="Nächste Änderung (↓ / j)">
          <i className="bi bi-chevron-down" />
        </button>
      </div>

      {/* Current change detail */}
      {currentChange && (
        <div className="validate-current-change">
          <div className="validate-change-header">
            <i className={PHASE_ICONS[currentChange.phase] ?? "bi-cpu"} />
            <span className="validate-change-phase">{PHASE_LABELS[currentChange.phase] ?? currentChange.phase}</span>
            <span className="validate-change-field">.{currentChange.field}</span>
          </div>
          <div className="validate-change-symbol" title={currentChange.symbolId}>
            <i className="bi bi-braces" /> {currentChange.symbolLabel}
          </div>

          <DiffView before={currentChange.before} after={currentChange.after} />

          <textarea
            className="validate-comment"
            placeholder="Optionaler Kommentar zur Entscheidung…"
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            rows={2}
          />

          <div className="validate-change-actions">
            <button
              className="validate-btn validate-btn-confirm"
              onClick={() => {
                validateConfirm(currentChange.id, reviewComment);
                setReviewComment("");
              }}
              title="Bestätigen (Enter / y)"
            >
              <i className="bi bi-check-lg" /> Bestätigen
            </button>
            <button
              className="validate-btn validate-btn-reject"
              onClick={() => {
                validateReject(currentChange.id, reviewComment);
                setReviewComment("");
              }}
              title="Ablehnen (Backspace / n)"
            >
              <i className="bi bi-x-lg" /> Ablehnen
            </button>
            <button
              className="validate-btn validate-btn-ide"
              onClick={handleOpenInIde}
              title={`In ${selectedIde === "vscode" ? "VS Code" : "IntelliJ"} öffnen`}
            >
              <i className="bi bi-box-arrow-up-right" /> Öffnen
            </button>
            <button
              className="validate-btn validate-btn-diff"
              onClick={handleOpenDiff}
              title={`Diff in ${selectedIde === "vscode" ? "VS Code" : "IntelliJ"}`}
            >
              <i className="bi bi-file-diff" /> Diff
            </button>
          </div>
        </div>
      )}

      {stats.pending === 0 && (
        <div className="validate-all-done">
          <i className="bi bi-check-circle-fill" />
          <span>Alle Änderungen geprüft!</span>
        </div>
      )}

      {/* Change list */}
      <div className="validate-change-list">
        {validateState.changes.map((change, idx) => (
          <div
            key={change.id}
            className={`validate-change-item ${
              idx === validateState.currentIndex ? "validate-change-active" : ""
            } validate-change-${change.status}`}
            onClick={() => validateNavigateTo(idx)}
          >
            <span className="validate-change-item-icon">
              {change.status === "confirmed" ? (
                <i className="bi bi-check-circle-fill" />
              ) : change.status === "rejected" ? (
                <i className="bi bi-x-circle-fill" />
              ) : (
                <i className={PHASE_ICONS[change.phase] ?? "bi-cpu"} />
              )}
            </span>
            <span className="validate-change-item-label">{change.symbolLabel}</span>
            <span className="validate-change-item-field">{change.field}</span>
          </div>
        ))}
      </div>

      {/* Footer actions */}
      {stats.pending > 0 && (
        <div className="validate-footer">
          <button
            className="validate-btn validate-btn-confirm-all"
            onClick={validateConfirmAll}
            title="Alle ausstehenden Änderungen bestätigen"
          >
            <i className="bi bi-check-all" /> Alle bestätigen ({stats.pending})
          </button>
        </div>
      )}
    </div>
  );
}
