import { memo, useCallback } from "react";
import { useAppStore } from "../store";

type ProjectionMode = "overview" | "class" | "sequence";

const MODES: Array<{ id: ProjectionMode; label: string; icon: string; title: string }> = [
  { id: "overview", label: "Übersicht", icon: "bi-grid-3x3-gap", title: "Architektur-Übersicht" },
  { id: "class", label: "Klassendiagramm", icon: "bi-diagram-3", title: "Statische Struktur: Klassen, Attribute, Methoden, Beziehungen" },
  { id: "sequence", label: "Sequenzdiagramm", icon: "bi-arrow-down-up", title: "Dynamische Interaktion: Ablauf, Nachrichten, Teilnehmer" },
];

export const ProjectionSwitch = memo(function ProjectionSwitch() {
  const projectionMode = useAppStore((s) => s.projectionMode);
  const setProjectionMode = useAppStore((s) => s.setProjectionMode);
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
    <div className="projection-switch">
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
  );
});
