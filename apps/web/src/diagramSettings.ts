import type { RelationType } from "@dmpg/shared";

export type DiagramEdgeType = "step" | "smoothstep" | "straight";
export type DiagramRouting = "ORTHOGONAL" | "POLYLINE" | "SPLINES";
export type DiagramLayoutDirection = "DOWN" | "RIGHT";
export type DiagramLabelMode = "off" | "compact" | "detailed";
export type DiagramArtifactMode = "hidden" | "grouped" | "individual";
export type DiagramPresetId = "uml_clean" | "dense" | "exploration";

export const ALL_RELATION_TYPES: RelationType[] = [
  "imports",
  "contains",
  "calls",
  "reads",
  "writes",
  "inherits",
  "uses_config",
  "instantiates",
];

const EDGE_TYPES: DiagramEdgeType[] = ["step", "smoothstep", "straight"];
const ROUTING_TYPES: DiagramRouting[] = ["ORTHOGONAL", "POLYLINE", "SPLINES"];
const LAYOUT_DIRECTIONS: DiagramLayoutDirection[] = ["DOWN", "RIGHT"];
const LABEL_MODES: DiagramLabelMode[] = ["off", "compact", "detailed"];
const ARTIFACT_MODES: DiagramArtifactMode[] = ["hidden", "grouped", "individual"];
const PRESET_IDS: Array<DiagramPresetId | "custom"> = ["uml_clean", "dense", "exploration", "custom"];

export const RELATION_VERBS: Record<RelationType, string> = {
  calls: "calls",
  imports: "imports",
  reads: "reads",
  writes: "writes to",
  inherits: "inherits",
  instantiates: "creates",
  uses_config: "config",
  contains: "contains",
};

export const EDGE_CLASS_BY_RELATION: Record<RelationType, string> = {
  calls: "edge-calls",
  imports: "edge-imports",
  reads: "edge-reads",
  writes: "edge-writes",
  inherits: "edge-inherits",
  instantiates: "edge-instantiates",
  uses_config: "edge-uses-config",
  contains: "edge-contains",
};

export const EDGE_ANIMATED_BY_RELATION: Record<RelationType, boolean> = {
  calls: true,
  imports: false,
  reads: true,
  writes: true,
  inherits: false,
  instantiates: true,
  uses_config: true,
  contains: false,
};

export interface DiagramLayoutSettings {
  direction: DiagramLayoutDirection;
  routing: DiagramRouting;
  mergeEdges: boolean;
  nodeNodeSpacing: number;
  betweenLayersSpacing: number;
  edgeNodeSpacing: number;
  edgeEdgeSpacing: number;
  componentComponentSpacing: number;
  thoroughness: number;
}

export interface DiagramSettings {
  activePreset: DiagramPresetId | "custom";
  edgeType: DiagramEdgeType;
  edgeStrokeWidth: number;
  labels: DiagramLabelMode;
  inputArtifactMode: DiagramArtifactMode;
  generatedArtifactMode: DiagramArtifactMode;
  nodeCompactMode: boolean;
  edgeAggregation: boolean;
  autoLayout: boolean;
  focusMode: boolean;
  focusDepth: number;
  /** Dim unrelated edges when hovering over a node */
  hoverHighlight: boolean;
  relationFilters: Record<RelationType, boolean>;
  layout: DiagramLayoutSettings;
}

export type DiagramSettingsPatch = Partial<Omit<DiagramSettings, "layout" | "relationFilters">> & {
  layout?: Partial<DiagramLayoutSettings>;
  relationFilters?: Partial<Record<RelationType, boolean>>;
};

export interface DiagramPresetDefinition {
  id: DiagramPresetId;
  label: string;
  description: string;
  settings: DiagramSettingsPatch;
}

export function createDefaultRelationFilters(): Record<RelationType, boolean> {
  return {
    imports: true,
    contains: true,
    calls: true,
    reads: true,
    writes: true,
    inherits: true,
    uses_config: true,
    instantiates: true,
  };
}

export const DEFAULT_DIAGRAM_LAYOUT_SETTINGS: DiagramLayoutSettings = {
  direction: "DOWN",
  routing: "ORTHOGONAL",
  mergeEdges: true,
  nodeNodeSpacing: 60,
  betweenLayersSpacing: 80,
  edgeNodeSpacing: 46,
  edgeEdgeSpacing: 22,
  componentComponentSpacing: 140,
  thoroughness: 12,
};

export const DEFAULT_DIAGRAM_SETTINGS: DiagramSettings = {
  activePreset: "uml_clean",
  edgeType: "step",
  edgeStrokeWidth: 1.8,
  labels: "detailed",
  inputArtifactMode: "grouped",
  generatedArtifactMode: "grouped",
  nodeCompactMode: false,
  edgeAggregation: true,
  autoLayout: true,
  focusMode: false,
  focusDepth: 1,
  hoverHighlight: true,
  relationFilters: createDefaultRelationFilters(),
  layout: { ...DEFAULT_DIAGRAM_LAYOUT_SETTINGS },
};

export const DIAGRAM_PRESETS: DiagramPresetDefinition[] = [
  {
    id: "uml_clean",
    label: "UML Clean",
    description: "Balanced spacing with orthogonal routing.",
    settings: {
      edgeType: "step",
      labels: "detailed",
      nodeCompactMode: false,
      edgeAggregation: true,
      layout: {
        ...DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
      },
    },
  },
  {
    id: "dense",
    label: "Dense",
    description: "More symbols on screen with tighter spacing.",
    settings: {
      edgeType: "step",
      labels: "compact",
      nodeCompactMode: true,
      edgeStrokeWidth: 1.4,
      edgeAggregation: true,
      layout: {
        ...DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
        nodeNodeSpacing: 34,
        betweenLayersSpacing: 44,
        edgeNodeSpacing: 26,
        edgeEdgeSpacing: 14,
        componentComponentSpacing: 80,
        thoroughness: 8,
      },
    },
  },
  {
    id: "exploration",
    label: "Exploration",
    description: "Looser spacing for relation tracing.",
    settings: {
      edgeType: "smoothstep",
      labels: "detailed",
      nodeCompactMode: false,
      edgeStrokeWidth: 2.1,
      edgeAggregation: false,
      layout: {
        ...DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
        direction: "RIGHT",
        routing: "POLYLINE",
        nodeNodeSpacing: 90,
        betweenLayersSpacing: 120,
        edgeNodeSpacing: 60,
        edgeEdgeSpacing: 30,
        componentComponentSpacing: 180,
        thoroughness: 16,
      },
    },
  },
];

const PRESET_BY_ID = new Map(DIAGRAM_PRESETS.map((preset) => [preset.id, preset]));

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asArtifactMode(value: unknown): DiagramArtifactMode | null {
  return typeof value === "string" && ARTIFACT_MODES.includes(value as DiagramArtifactMode)
    ? (value as DiagramArtifactMode)
    : null;
}

function asInputArtifactMode(value: unknown): DiagramArtifactMode | null {
  const mode = asArtifactMode(value);
  if (mode === "individual") return "grouped";
  return mode;
}

export function cloneDiagramSettings(settings: DiagramSettings = DEFAULT_DIAGRAM_SETTINGS): DiagramSettings {
  return {
    ...settings,
    relationFilters: { ...settings.relationFilters },
    layout: { ...settings.layout },
  };
}

export function mergeDiagramSettings(base: DiagramSettings, patch: DiagramSettingsPatch): DiagramSettings {
  return {
    ...base,
    ...patch,
    relationFilters: {
      ...base.relationFilters,
      ...(patch.relationFilters ?? {}),
    },
    layout: {
      ...base.layout,
      ...(patch.layout ?? {}),
    },
  };
}

export function sanitizeDiagramSettings(raw: unknown): DiagramSettings {
  if (!raw || typeof raw !== "object") {
    return cloneDiagramSettings(DEFAULT_DIAGRAM_SETTINGS);
  }

  const source = raw as DiagramSettingsPatch;
  const merged = mergeDiagramSettings(DEFAULT_DIAGRAM_SETTINGS, source);

  const relationFilters = createDefaultRelationFilters();
  for (const relationType of ALL_RELATION_TYPES) {
    const value = merged.relationFilters?.[relationType];
    relationFilters[relationType] = asBoolean(value, true);
  }

  const layout = {
    direction: LAYOUT_DIRECTIONS.includes(merged.layout.direction) ? merged.layout.direction : DEFAULT_DIAGRAM_LAYOUT_SETTINGS.direction,
    routing: ROUTING_TYPES.includes(merged.layout.routing) ? merged.layout.routing : DEFAULT_DIAGRAM_LAYOUT_SETTINGS.routing,
    mergeEdges: asBoolean(merged.layout.mergeEdges, DEFAULT_DIAGRAM_LAYOUT_SETTINGS.mergeEdges),
    nodeNodeSpacing: asNumber(merged.layout.nodeNodeSpacing, DEFAULT_DIAGRAM_LAYOUT_SETTINGS.nodeNodeSpacing, 16, 300),
    betweenLayersSpacing: asNumber(merged.layout.betweenLayersSpacing, DEFAULT_DIAGRAM_LAYOUT_SETTINGS.betweenLayersSpacing, 16, 320),
    edgeNodeSpacing: asNumber(merged.layout.edgeNodeSpacing, DEFAULT_DIAGRAM_LAYOUT_SETTINGS.edgeNodeSpacing, 8, 220),
    edgeEdgeSpacing: asNumber(merged.layout.edgeEdgeSpacing, DEFAULT_DIAGRAM_LAYOUT_SETTINGS.edgeEdgeSpacing, 4, 180),
    componentComponentSpacing: asNumber(
      merged.layout.componentComponentSpacing,
      DEFAULT_DIAGRAM_LAYOUT_SETTINGS.componentComponentSpacing,
      24,
      420,
    ),
    thoroughness: asNumber(merged.layout.thoroughness, DEFAULT_DIAGRAM_LAYOUT_SETTINGS.thoroughness, 4, 30),
  } satisfies DiagramLayoutSettings;

  const edgeType = EDGE_TYPES.includes(merged.edgeType) ? merged.edgeType : DEFAULT_DIAGRAM_SETTINGS.edgeType;
  const labels = LABEL_MODES.includes(merged.labels) ? merged.labels : DEFAULT_DIAGRAM_SETTINGS.labels;
  const activePreset = PRESET_IDS.includes(merged.activePreset) ? merged.activePreset : "custom";
  const legacyGeneratedArtifactMode =
    asArtifactMode((raw as { artifactMode?: unknown }).artifactMode) ??
    (asBoolean((raw as { showArtifacts?: unknown }).showArtifacts, true) ? "grouped" : "hidden");
  const inputArtifactMode =
    asInputArtifactMode((raw as { inputArtifactMode?: unknown }).inputArtifactMode) ??
    DEFAULT_DIAGRAM_SETTINGS.inputArtifactMode;
  const generatedArtifactMode =
    asArtifactMode((raw as { generatedArtifactMode?: unknown }).generatedArtifactMode) ??
    legacyGeneratedArtifactMode;

  return {
    activePreset,
    edgeType,
    edgeStrokeWidth: asNumber(merged.edgeStrokeWidth, DEFAULT_DIAGRAM_SETTINGS.edgeStrokeWidth, 0.8, 4),
    labels,
    inputArtifactMode,
    generatedArtifactMode,
    nodeCompactMode: asBoolean(merged.nodeCompactMode, DEFAULT_DIAGRAM_SETTINGS.nodeCompactMode),
    edgeAggregation: asBoolean(merged.edgeAggregation, DEFAULT_DIAGRAM_SETTINGS.edgeAggregation),
    autoLayout: asBoolean(merged.autoLayout, DEFAULT_DIAGRAM_SETTINGS.autoLayout),
    focusMode: asBoolean(merged.focusMode, DEFAULT_DIAGRAM_SETTINGS.focusMode),
    focusDepth: asNumber(merged.focusDepth, DEFAULT_DIAGRAM_SETTINGS.focusDepth, 1, 3),
    hoverHighlight: asBoolean(merged.hoverHighlight, DEFAULT_DIAGRAM_SETTINGS.hoverHighlight),
    relationFilters,
    layout,
  };
}

export function getDiagramPreset(presetId: DiagramPresetId): DiagramPresetDefinition | undefined {
  return PRESET_BY_ID.get(presetId);
}

