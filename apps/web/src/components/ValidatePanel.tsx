import { useCallback, useMemo } from "react";
import { useAppStore } from "../store";
import { openInIde } from "../api";

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

  const handleOpenInIde = useCallback(() => {
    if (!currentChange || !graph) return;
    const sym = graph.symbols.find((s) => s.id === currentChange.symbolId);
    if (sym?.location?.file) {
      openInIde("vscode", sym.location.file, sym.location.startLine).catch(console.error);
    }
  }, [currentChange, graph]);

  if (!validateState.active) return null;

  return (
    <div className="validate-panel">
      {/* Header */}
      <div className="validate-panel-header">
        <div className="validate-panel-title">
          <i className="bi bi-patch-check" />
          <span>AI-Änderungen prüfen</span>
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

      {/* Navigation controls */}
      <div className="validate-nav">
        <button className="validate-nav-btn" onClick={validatePrev} title="Vorherige Änderung">
          <i className="bi bi-chevron-up" />
        </button>
        <span className="validate-nav-pos">
          {validateState.currentIndex >= 0 ? validateState.currentIndex + 1 : 0} / {stats.total}
        </span>
        <button className="validate-nav-btn" onClick={validateNext} title="Nächste Änderung">
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

          <div className="validate-change-actions">
            <button
              className="validate-btn validate-btn-confirm"
              onClick={() => validateConfirm(currentChange.id)}
              title="Bestätigen — AI-Markierung entfernen"
            >
              <i className="bi bi-check-lg" /> Bestätigen
            </button>
            <button
              className="validate-btn validate-btn-reject"
              onClick={() => validateReject(currentChange.id)}
              title="Ablehnen — Änderung rückgängig"
            >
              <i className="bi bi-x-lg" /> Ablehnen
            </button>
            <button
              className="validate-btn validate-btn-ide"
              onClick={handleOpenInIde}
              title="In IDE öffnen"
            >
              <i className="bi bi-box-arrow-up-right" /> IDE
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
