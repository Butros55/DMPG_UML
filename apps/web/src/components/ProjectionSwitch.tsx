import { memo, useCallback } from "react";
import { useAppStore, type SequenceProjectionModeState } from "../store";

type ProjectionMode = "overview" | "class" | "sequence";

const MODES: Array<{ id: ProjectionMode; label: string; icon: string; title: string }> = [
  { id: "overview", label: "Übersicht", icon: "bi-grid-3x3-gap", title: "Architektur-Übersicht" },
  { id: "class", label: "Klassendiagramm", icon: "bi-diagram-3", title: "Statische Struktur: Klassen, Attribute, Methoden, Beziehungen" },
  { id: "sequence", label: "Sequenzdiagramm", icon: "bi-arrow-down-up", title: "Dynamische Interaktion: Ablauf, Nachrichten, Teilnehmer" },
];

const SEQUENCE_MODES: Array<{ id: SequenceProjectionModeState; label: string; icon: string; title: string }> = [
  { id: "code", label: "Code Flow", icon: "bi-code-slash", title: "EntryPoint-basierter Code-Ablauf" },
  { id: "artifact", label: "Artifact Flow", icon: "bi-file-earmark-arrow-down", title: "Artefakt-zentrierte Reads/Writes" },
  { id: "full", label: "Full Static", icon: "bi-diagram-2", title: "Vollständige statische Projektion" },
];

export const ProjectionSwitch = memo(function ProjectionSwitch() {
  const projectionMode = useAppStore((s) => s.projectionMode);
  const sequenceProjectionMode = useAppStore((s) => s.sequenceProjectionMode);
  const setProjectionMode = useAppStore((s) => s.setProjectionMode);
  const setSequenceProjectionMode = useAppStore((s) => s.setSequenceProjectionMode);
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);

  const currentView = graph?.views.find((v) => v.id === currentViewId) ?? null;

  // Don't show on root/overview level (process overview has its own layout)
  const isRootLevel = !currentView || currentView.scope === "root";

  const handleClick = useCallback(
    (mode: ProjectionMode) => {
      setProjectionMode(mode);
    },
    [setProjectionMode],
  );

  if (isRootLevel) return null;

  return (
    <div className="projection-switch projection-switch--stacked">
      <div className="projection-switch__row">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`projection-switch__btn ${projectionMode === mode.id ? "projection-switch__btn--active" : ""}`}
            title={mode.title}
            aria-pressed={projectionMode === mode.id}
            onClick={() => handleClick(mode.id)}
          >
            <i className={`bi ${mode.icon}`} />
            <span className="projection-switch__label">{mode.label}</span>
          </button>
        ))}
      </div>
      {projectionMode === "sequence" && (
        <div className="projection-switch__row projection-switch__row--sub">
          {SEQUENCE_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`projection-switch__btn projection-switch__btn--sub ${sequenceProjectionMode === mode.id ? "projection-switch__btn--active" : ""}`}
              title={mode.title}
              aria-pressed={sequenceProjectionMode === mode.id}
              onClick={() => setSequenceProjectionMode(mode.id)}
            >
              <i className={`bi ${mode.icon}`} />
              <span className="projection-switch__label">{mode.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
