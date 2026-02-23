import type { ProjectGraph } from "@dmpg/shared";

/**
 * Returns a small demo graph when no project is scanned.
 */
export function buildDemoGraph(): ProjectGraph {
  const symbols = [
    // Level-0 groups
    { id: "grp:pipeline", label: "Pipeline", kind: "group" as const, childViewId: "view:pipeline", tags: ["layer:pipeline"] },
    { id: "grp:connectors", label: "Connectors / Infra", kind: "group" as const, childViewId: "view:connectors", tags: ["layer:connector"] },
    { id: "grp:analytics", label: "Analytics", kind: "group" as const, childViewId: "view:analytics", tags: ["layer:analytics"] },
    { id: "grp:utilities", label: "Utilities", kind: "group" as const, childViewId: "view:utilities", tags: ["layer:util"] },

    // Pipeline children
    {
      id: "mod:simulation_data_generator",
      label: "SimulationDataGenerator",
      kind: "module" as const,
      parentId: "grp:pipeline",
      location: { file: "simulation_data_generator.py", startLine: 1 },
      doc: {
        summary: "Orchestrates the full pipeline: extraction → filtering → distribution fitting → artefact export.",
        calls: ["mod:data_extraction", "mod:distribution", "mod:fit_distribution"],
        sideEffects: ["Writes JSON/Excel artefacts"],
      },
    },
    {
      id: "mod:data_extraction",
      label: "DataExtraction",
      kind: "class" as const,
      parentId: "grp:pipeline",
      location: { file: "data_extraction.py", startLine: 10 },
      doc: {
        summary: "Loads raw data from MES/Druid, maps work-carriers, computes process times, clusters materials.",
        inputs: [{ name: "config", type: "dict" }],
        outputs: [{ name: "dataset", type: "DataFrame" }],
        calls: ["mod:mes_connector", "mod:druid_connector"],
      },
    },

    // Connector children
    {
      id: "mod:mes_connector",
      label: "MESConnector",
      kind: "class" as const,
      parentId: "grp:connectors",
      location: { file: "mes_connector.py", startLine: 1 },
      doc: { summary: "Connects to MS SQL via pymssql, buffers queries.", sideEffects: ["Network/DB"] },
    },
    {
      id: "mod:druid_connector",
      label: "DruidConnector",
      kind: "class" as const,
      parentId: "grp:connectors",
      location: { file: "druid_connector.py", startLine: 1 },
      doc: { summary: "Connects to Apache Druid via pydruid.", sideEffects: ["Network/DB"] },
    },

    // Analytics children
    {
      id: "mod:distribution",
      label: "Distribution",
      kind: "module" as const,
      parentId: "grp:analytics",
      location: { file: "new_distribution.py", startLine: 1 },
      doc: { summary: "Computes station-/material-based statistics and worker effectiveness." },
    },
    {
      id: "mod:fit_distribution",
      label: "fit_distribution",
      kind: "function" as const,
      parentId: "grp:analytics",
      location: { file: "fit_distribution.py", startLine: 1 },
      doc: {
        summary: "Fits statistical distributions via distfit, writes parameterised distributions to JSON files.",
        inputs: [{ name: "data", type: "Series" }],
        outputs: [{ name: "params", type: "JSON file" }],
        sideEffects: ["File write"],
      },
    },

    // Utility children
    {
      id: "mod:remove_outliers",
      label: "remove_outliners_with_iqr",
      kind: "function" as const,
      parentId: "grp:utilities",
      location: { file: "statistics.py", startLine: 5 },
      doc: { summary: "Removes outliers using IQR filtering." },
    },
    {
      id: "mod:filter_methods",
      label: "FilterMethods",
      kind: "constant" as const,
      parentId: "grp:utilities",
      location: { file: "filter_methods.py", startLine: 1 },
      doc: { summary: "Enum of supported filter methods." },
    },
    {
      id: "mod:bath",
      label: "Bath Constants",
      kind: "constant" as const,
      parentId: "grp:utilities",
      location: { file: "bath.py", startLine: 1 },
      doc: { summary: "Shared bath/station constants." },
    },
  ];

  const relations = [
    { id: "e1", type: "calls" as const, source: "mod:simulation_data_generator", target: "mod:data_extraction", confidence: 1 },
    { id: "e2", type: "calls" as const, source: "mod:simulation_data_generator", target: "mod:distribution", confidence: 1 },
    { id: "e3", type: "calls" as const, source: "mod:simulation_data_generator", target: "mod:fit_distribution", confidence: 0.9 },
    { id: "e4", type: "imports" as const, source: "mod:data_extraction", target: "mod:mes_connector", confidence: 1 },
    { id: "e5", type: "imports" as const, source: "mod:data_extraction", target: "mod:druid_connector", confidence: 1 },
    { id: "e6", type: "calls" as const, source: "mod:distribution", target: "mod:fit_distribution", confidence: 1 },
    { id: "e7", type: "imports" as const, source: "mod:distribution", target: "mod:remove_outliers", confidence: 1 },
    { id: "e8", type: "contains" as const, source: "grp:pipeline", target: "mod:simulation_data_generator" },
    { id: "e9", type: "contains" as const, source: "grp:pipeline", target: "mod:data_extraction" },
    { id: "e10", type: "contains" as const, source: "grp:connectors", target: "mod:mes_connector" },
    { id: "e11", type: "contains" as const, source: "grp:connectors", target: "mod:druid_connector" },
    { id: "e12", type: "contains" as const, source: "grp:analytics", target: "mod:distribution" },
    { id: "e13", type: "contains" as const, source: "grp:analytics", target: "mod:fit_distribution" },
    { id: "e14", type: "contains" as const, source: "grp:utilities", target: "mod:remove_outliers" },
    { id: "e15", type: "contains" as const, source: "grp:utilities", target: "mod:filter_methods" },
    { id: "e16", type: "contains" as const, source: "grp:utilities", target: "mod:bath" },
  ];

  const views = [
    {
      id: "view:root",
      title: "Level 0 — Overview",
      parentViewId: null,
      nodeRefs: ["grp:pipeline", "grp:connectors", "grp:analytics", "grp:utilities"],
      edgeRefs: ["e1", "e2", "e3", "e4", "e5", "e6", "e7"],
    },
    {
      id: "view:pipeline",
      title: "Pipeline",
      parentViewId: "view:root",
      nodeRefs: ["mod:simulation_data_generator", "mod:data_extraction"],
      edgeRefs: ["e1"],
    },
    {
      id: "view:connectors",
      title: "Connectors / Infra",
      parentViewId: "view:root",
      nodeRefs: ["mod:mes_connector", "mod:druid_connector"],
      edgeRefs: [],
    },
    {
      id: "view:analytics",
      title: "Analytics",
      parentViewId: "view:root",
      nodeRefs: ["mod:distribution", "mod:fit_distribution"],
      edgeRefs: ["e6"],
    },
    {
      id: "view:utilities",
      title: "Utilities",
      parentViewId: "view:root",
      nodeRefs: ["mod:remove_outliers", "mod:filter_methods", "mod:bath"],
      edgeRefs: [],
    },
  ];

  return { symbols, relations, views, rootViewId: "view:root" };
}
