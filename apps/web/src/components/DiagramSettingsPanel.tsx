import { useEffect } from "react";
import type { RelationType } from "@dmpg/shared";
import { useAppStore } from "../store";
import {
  ALL_RELATION_TYPES,
  DIAGRAM_PRESETS,
  type DiagramArtifactMode,
  type DiagramEdgeType,
  type DiagramLabelMode,
  type DiagramLayoutDirection,
  type DiagramRouting,
} from "../diagramSettings";

const EDGE_TYPES: DiagramEdgeType[] = ["step", "smoothstep", "straight"];
const LABEL_MODES: DiagramLabelMode[] = ["off", "compact", "detailed"];
const INPUT_ARTIFACT_MODES: DiagramArtifactMode[] = ["hidden", "grouped"];
const GENERATED_ARTIFACT_MODES: DiagramArtifactMode[] = ["hidden", "grouped", "individual"];
const INPUT_ARTIFACT_MODE_LABEL: Record<DiagramArtifactMode, string> = {
  hidden: "off",
  grouped: "on",
  individual: "on",
};
const GENERATED_ARTIFACT_MODE_LABEL: Record<DiagramArtifactMode, string> = {
  hidden: "hidden",
  grouped: "grouped",
  individual: "individual",
};
const ROUTING_OPTIONS: DiagramRouting[] = ["ORTHOGONAL", "POLYLINE", "SPLINES"];
const DIRECTION_OPTIONS: DiagramLayoutDirection[] = ["DOWN", "RIGHT"];

type LayoutNumberKey =
  | "nodeNodeSpacing"
  | "betweenLayersSpacing"
  | "edgeNodeSpacing"
  | "edgeEdgeSpacing"
  | "componentComponentSpacing"
  | "thoroughness";

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
};

function SliderField({ label, value, min, max, step = 1, onChange, disabled }: SliderProps) {
  return (
    <label className={`diagram-settings-slider${disabled ? " is-disabled" : ""}`}>
      <span className="diagram-settings-slider__head">
        <span>{label}</span>
        <span>{Math.round(value * 100) / 100}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function DiagramSettingsPanel() {
  const settings = useAppStore((s) => s.diagramSettings);
  const updateDiagramSettings = useAppStore((s) => s.updateDiagramSettings);
  const updateDiagramLayout = useAppStore((s) => s.updateDiagramLayout);
  const setRelationFilter = useAppStore((s) => s.setRelationFilter);
  const setDiagramPreset = useAppStore((s) => s.setDiagramPreset);
  const applyDiagramLayout = useAppStore((s) => s.applyDiagramLayout);
  const resetDiagramSettings = useAppStore((s) => s.resetDiagramSettings);
  const resetProjectLayout = useAppStore((s) => s.resetProjectLayout);

  useEffect(() => {
    if (!settings.autoLayout) return;
    const timer = window.setTimeout(() => {
      applyDiagramLayout();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [
    settings.autoLayout,
    settings.layout.direction,
    settings.layout.routing,
    settings.layout.mergeEdges,
    settings.layout.nodeNodeSpacing,
    settings.layout.betweenLayersSpacing,
    settings.layout.edgeNodeSpacing,
    settings.layout.edgeEdgeSpacing,
    settings.layout.componentComponentSpacing,
    settings.layout.thoroughness,
    settings.inputArtifactMode,
    settings.generatedArtifactMode,
    settings.nodeCompactMode,
    applyDiagramLayout,
  ]);

  const updateLayoutNumber = (key: LayoutNumberKey, next: number) => {
    updateDiagramLayout({ [key]: next });
  };

  const relationLabel = (relationType: RelationType): string => {
    if (relationType === "uses_config") return "uses_config";
    return relationType;
  };

  return (
    <div className="inspector-card diagram-settings-card">
      <h3>Diagram Settings</h3>

      <div className="field-label">Preset</div>
      <select
        className="inspector-select"
        value={settings.activePreset}
        onChange={(event) => {
          const presetId = event.target.value;
          if (presetId === "custom") return;
          setDiagramPreset(presetId as "uml_clean" | "dense" | "exploration");
          if (!settings.autoLayout) {
            applyDiagramLayout();
          }
        }}
      >
        {DIAGRAM_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>

      <div className="field-label">Edges</div>
      <div className="diagram-settings-row">
        <span>Edge type</span>
        <select
          className="inspector-select"
          value={settings.edgeType}
          onChange={(event) => updateDiagramSettings({ edgeType: event.target.value as DiagramEdgeType })}
        >
          {EDGE_TYPES.map((edgeType) => (
            <option key={edgeType} value={edgeType}>
              {edgeType}
            </option>
          ))}
        </select>
      </div>

      <SliderField
        label="Stroke width"
        value={settings.edgeStrokeWidth}
        min={0.8}
        max={4}
        step={0.1}
        onChange={(next) => updateDiagramSettings({ edgeStrokeWidth: next })}
      />

      <div className="diagram-settings-row">
        <span>Labels</span>
        <select
          className="inspector-select"
          value={settings.labels}
          onChange={(event) => updateDiagramSettings({ labels: event.target.value as DiagramLabelMode })}
        >
          {LABEL_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>

      <label className="diagram-settings-check">
        <input
          type="checkbox"
          checked={settings.edgeAggregation}
          onChange={(event) => updateDiagramSettings({ edgeAggregation: event.target.checked })}
        />
        <span>Edge aggregation</span>
      </label>

      <div className="field-label">Layout</div>
      <div className="diagram-settings-row">
        <span>Direction</span>
        <select
          className="inspector-select"
          value={settings.layout.direction}
          onChange={(event) => updateDiagramLayout({ direction: event.target.value as DiagramLayoutDirection })}
        >
          {DIRECTION_OPTIONS.map((direction) => (
            <option key={direction} value={direction}>
              {direction}
            </option>
          ))}
        </select>
      </div>

      <div className="diagram-settings-row">
        <span>Routing</span>
        <select
          className="inspector-select"
          value={settings.layout.routing}
          onChange={(event) => updateDiagramLayout({ routing: event.target.value as DiagramRouting })}
        >
          {ROUTING_OPTIONS.map((routing) => (
            <option key={routing} value={routing}>
              {routing}
            </option>
          ))}
        </select>
      </div>

      <label className="diagram-settings-check">
        <input
          type="checkbox"
          checked={settings.layout.mergeEdges}
          onChange={(event) => updateDiagramLayout({ mergeEdges: event.target.checked })}
        />
        <span>mergeEdges</span>
      </label>

      <SliderField
        label="nodeNode spacing"
        value={settings.layout.nodeNodeSpacing}
        min={16}
        max={300}
        onChange={(next) => updateLayoutNumber("nodeNodeSpacing", next)}
      />
      <SliderField
        label="betweenLayers spacing"
        value={settings.layout.betweenLayersSpacing}
        min={16}
        max={320}
        onChange={(next) => updateLayoutNumber("betweenLayersSpacing", next)}
      />
      <SliderField
        label="edgeNode spacing"
        value={settings.layout.edgeNodeSpacing}
        min={8}
        max={220}
        onChange={(next) => updateLayoutNumber("edgeNodeSpacing", next)}
      />
      <SliderField
        label="edgeEdge spacing"
        value={settings.layout.edgeEdgeSpacing}
        min={4}
        max={180}
        onChange={(next) => updateLayoutNumber("edgeEdgeSpacing", next)}
      />
      <SliderField
        label="component spacing"
        value={settings.layout.componentComponentSpacing}
        min={24}
        max={420}
        onChange={(next) => updateLayoutNumber("componentComponentSpacing", next)}
      />
      <SliderField
        label="thoroughness"
        value={settings.layout.thoroughness}
        min={4}
        max={30}
        onChange={(next) => updateLayoutNumber("thoroughness", next)}
      />

      <label className="diagram-settings-check">
        <input
          type="checkbox"
          checked={settings.autoLayout}
          onChange={(event) => updateDiagramSettings({ autoLayout: event.target.checked })}
        />
        <span>Auto-layout</span>
      </label>

      <div className="field-label">Visibility</div>
      <div className="diagram-settings-row">
        <span>Input artifacts</span>
        <select
          className="inspector-select"
          value={settings.inputArtifactMode}
          onChange={(event) => updateDiagramSettings({ inputArtifactMode: event.target.value as DiagramArtifactMode })}
        >
          {INPUT_ARTIFACT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {INPUT_ARTIFACT_MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </div>

      <div className="diagram-settings-row">
        <span>Outputs / flow</span>
        <select
          className="inspector-select"
          value={settings.generatedArtifactMode}
          onChange={(event) => updateDiagramSettings({ generatedArtifactMode: event.target.value as DiagramArtifactMode })}
        >
          {GENERATED_ARTIFACT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {GENERATED_ARTIFACT_MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </div>

      <label className="diagram-settings-check">
        <input
          type="checkbox"
          checked={settings.focusMode}
          onChange={(event) => updateDiagramSettings({ focusMode: event.target.checked })}
        />
        <span>Focus mode</span>
      </label>

      <SliderField
        label="Focus depth"
        value={settings.focusDepth}
        min={1}
        max={3}
        onChange={(next) => updateDiagramSettings({ focusDepth: Math.round(next) })}
        disabled={!settings.focusMode}
      />

      <label className="diagram-settings-check">
        <input
          type="checkbox"
          checked={settings.nodeCompactMode}
          onChange={(event) => updateDiagramSettings({ nodeCompactMode: event.target.checked })}
        />
        <span>Node compact mode</span>
      </label>

      <label className="diagram-settings-check">
        <input
          type="checkbox"
          checked={settings.hoverHighlight}
          onChange={(event) => updateDiagramSettings({ hoverHighlight: event.target.checked })}
        />
        <span>Hover highlight</span>
      </label>

      <div className="field-label">Relation Filter</div>
      <div className="diagram-settings-relations">
        {ALL_RELATION_TYPES.map((relationType) => (
          <label key={relationType} className="diagram-settings-check">
            <input
              type="checkbox"
              checked={settings.relationFilters[relationType]}
              onChange={(event) => setRelationFilter(relationType, event.target.checked)}
            />
            <span>{relationLabel(relationType)}</span>
          </label>
        ))}
      </div>

      <div className="diagram-settings-actions">
        <button className="btn btn-sm btn-primary" onClick={applyDiagramLayout}>
          Apply Layout
        </button>
        <button className="btn btn-sm" onClick={resetDiagramSettings}>
          Reset Defaults
        </button>
        <button className="btn btn-sm btn-danger" onClick={resetProjectLayout}>
          Reset Project Layout
        </button>
      </div>
    </div>
  );
}
