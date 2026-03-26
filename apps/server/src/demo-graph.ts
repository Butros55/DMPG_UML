import type { ProjectGraph } from "@dmpg/shared";

/**
 * Returns a multi-level demo graph when no project is scanned.
 * Includes views down to the method level.
 */
export function buildDemoGraph(): ProjectGraph {
  const symbols = [
    // Level-0 groups
    { id: "grp:pipeline", label: "Pipeline", kind: "group" as const, childViewId: "view:grp:pipeline", tags: ["section:pipeline"] },
    { id: "grp:connectors", label: "Connectors / Infra", kind: "group" as const, childViewId: "view:grp:connectors", tags: ["section:connectors"] },
    { id: "grp:analytics", label: "Analytics", kind: "group" as const, childViewId: "view:grp:analytics", tags: ["section:analytics"] },
    { id: "grp:utilities", label: "Utilities", kind: "group" as const, childViewId: "view:grp:utilities", tags: ["section:utilities"] },

    // Pipeline children
    {
      id: "mod:simulation_data_generator",
      label: "SimulationDataGenerator",
      kind: "class" as const,
      parentId: "grp:pipeline",
      childViewId: "view:mod:simulation_data_generator",
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
      childViewId: "view:mod:data_extraction",
      location: { file: "data_extraction.py", startLine: 10 },
      doc: {
        summary: "Loads raw data from MES/Druid, maps work-carriers, computes process times, clusters materials.",
        inputs: [{ name: "config", type: "dict" }],
        outputs: [{ name: "dataset", type: "DataFrame" }],
        calls: ["mod:mes_connector", "mod:druid_connector"],
      },
    },

    // Methods of SimulationDataGenerator
    {
      id: "mod:simulation_data_generator:SimulationDataGenerator.run_pipeline",
      label: "SimulationDataGenerator.run_pipeline",
      kind: "method" as const,
      parentId: "mod:simulation_data_generator",
      location: { file: "simulation_data_generator.py", startLine: 15, endLine: 50 },
      doc: {
        summary: "Executes the full data pipeline end-to-end.",
        inputs: [{ name: "config", type: "dict" }],
      },
    },
    {
      id: "mod:simulation_data_generator:SimulationDataGenerator.export_results",
      label: "SimulationDataGenerator.export_results",
      kind: "method" as const,
      parentId: "mod:simulation_data_generator",
      location: { file: "simulation_data_generator.py", startLine: 52, endLine: 80 },
      doc: {
        summary: "Exports fitted distributions to JSON and Excel.",
        sideEffects: ["Writes output files"],
      },
    },

    // Methods of DataExtraction
    {
      id: "mod:data_extraction:DataExtraction.load_from_mes",
      label: "DataExtraction.load_from_mes",
      kind: "method" as const,
      parentId: "mod:data_extraction",
      location: { file: "data_extraction.py", startLine: 20, endLine: 45 },
      doc: {
        summary: "Loads raw production data from MES database.",
        outputs: [{ name: "df", type: "DataFrame" }],
      },
    },
    {
      id: "mod:data_extraction:DataExtraction.load_from_druid",
      label: "DataExtraction.load_from_druid",
      kind: "method" as const,
      parentId: "mod:data_extraction",
      location: { file: "data_extraction.py", startLine: 47, endLine: 70 },
      doc: {
        summary: "Loads time-series data from Druid.",
        outputs: [{ name: "df", type: "DataFrame" }],
      },
    },

    // Connector children
    {
      id: "mod:mes_connector",
      label: "MESConnector",
      kind: "class" as const,
      parentId: "grp:connectors",
      childViewId: "view:mod:mes_connector",
      location: { file: "mes_connector.py", startLine: 1 },
      doc: { summary: "Connects to MS SQL via pymssql, buffers queries.", sideEffects: ["Network/DB"] },
    },
    {
      id: "mod:druid_connector",
      label: "DruidConnector",
      kind: "class" as const,
      parentId: "grp:connectors",
      childViewId: "view:mod:druid_connector",
      location: { file: "druid_connector.py", startLine: 1 },
      doc: { summary: "Connects to Apache Druid via pydruid.", sideEffects: ["Network/DB"] },
    },

    // Methods of connectors
    {
      id: "mod:mes_connector:MESConnector.execute_query",
      label: "MESConnector.execute_query",
      kind: "method" as const,
      parentId: "mod:mes_connector",
      location: { file: "mes_connector.py", startLine: 10, endLine: 30 },
      doc: { summary: "Executes a SQL query against MES database.", inputs: [{ name: "query", type: "str" }] },
    },
    {
      id: "mod:druid_connector:DruidConnector.query",
      label: "DruidConnector.query",
      kind: "method" as const,
      parentId: "mod:druid_connector",
      location: { file: "druid_connector.py", startLine: 10, endLine: 25 },
      doc: { summary: "Executes a Druid query.", inputs: [{ name: "datasource", type: "str" }] },
    },

    // Analytics children
    {
      id: "mod:distribution",
      label: "Distribution",
      kind: "module" as const,
      parentId: "grp:analytics",
      childViewId: "view:mod:distribution",
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

    // Children of Distribution module
    {
      id: "mod:distribution:compute_stats",
      label: "compute_stats",
      kind: "function" as const,
      parentId: "mod:distribution",
      location: { file: "new_distribution.py", startLine: 10, endLine: 40 },
      doc: { summary: "Computes descriptive statistics per station/material group." },
    },
    {
      id: "mod:distribution:worker_effectiveness",
      label: "worker_effectiveness",
      kind: "function" as const,
      parentId: "mod:distribution",
      location: { file: "new_distribution.py", startLine: 42, endLine: 70 },
      doc: { summary: "Calculates worker effectiveness metrics." },
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

    // External artefacts
    {
      id: "ext:output.json",
      label: "output.json",
      kind: "external" as const,
      doc: { summary: "Output JSON with fitted distribution parameters." },
    },
  ];

  const relations = [
    // Cross-group calls
    { id: "e1", type: "calls" as const, source: "mod:simulation_data_generator", target: "mod:data_extraction", confidence: 1 },
    { id: "e2", type: "calls" as const, source: "mod:simulation_data_generator", target: "mod:distribution", confidence: 1 },
    { id: "e3", type: "calls" as const, source: "mod:simulation_data_generator", target: "mod:fit_distribution", confidence: 0.9 },
    { id: "e4", type: "imports" as const, source: "mod:data_extraction", target: "mod:mes_connector", confidence: 1 },
    { id: "e5", type: "imports" as const, source: "mod:data_extraction", target: "mod:druid_connector", confidence: 1 },
    { id: "e6", type: "calls" as const, source: "mod:distribution", target: "mod:fit_distribution", confidence: 1 },
    { id: "e7", type: "imports" as const, source: "mod:distribution", target: "mod:remove_outliers", confidence: 1 },

    // Method-level calls
    { id: "e20", type: "calls" as const, source: "mod:simulation_data_generator:SimulationDataGenerator.run_pipeline", target: "mod:data_extraction:DataExtraction.load_from_mes", confidence: 0.9 },
    { id: "e21", type: "calls" as const, source: "mod:simulation_data_generator:SimulationDataGenerator.run_pipeline", target: "mod:data_extraction:DataExtraction.load_from_druid", confidence: 0.9 },
    { id: "e22", type: "calls" as const, source: "mod:data_extraction:DataExtraction.load_from_mes", target: "mod:mes_connector:MESConnector.execute_query", confidence: 0.8 },
    { id: "e23", type: "calls" as const, source: "mod:data_extraction:DataExtraction.load_from_druid", target: "mod:druid_connector:DruidConnector.query", confidence: 0.8 },
    { id: "e24", type: "calls" as const, source: "mod:distribution:compute_stats", target: "mod:remove_outliers", confidence: 0.9 },
    { id: "e25", type: "writes" as const, source: "mod:simulation_data_generator:SimulationDataGenerator.export_results", target: "ext:output.json", confidence: 0.7 },

    // Contains edges
    { id: "e8", type: "contains" as const, source: "grp:pipeline", target: "mod:simulation_data_generator" },
    { id: "e9", type: "contains" as const, source: "grp:pipeline", target: "mod:data_extraction" },
    { id: "e10", type: "contains" as const, source: "grp:connectors", target: "mod:mes_connector" },
    { id: "e11", type: "contains" as const, source: "grp:connectors", target: "mod:druid_connector" },
    { id: "e12", type: "contains" as const, source: "grp:analytics", target: "mod:distribution" },
    { id: "e13", type: "contains" as const, source: "grp:analytics", target: "mod:fit_distribution" },
    { id: "e14", type: "contains" as const, source: "grp:utilities", target: "mod:remove_outliers" },
    { id: "e15", type: "contains" as const, source: "grp:utilities", target: "mod:filter_methods" },
    { id: "e16", type: "contains" as const, source: "grp:utilities", target: "mod:bath" },
    { id: "e17", type: "contains" as const, source: "mod:simulation_data_generator", target: "mod:simulation_data_generator:SimulationDataGenerator.run_pipeline" },
    { id: "e18", type: "contains" as const, source: "mod:simulation_data_generator", target: "mod:simulation_data_generator:SimulationDataGenerator.export_results" },
    { id: "e19", type: "contains" as const, source: "mod:data_extraction", target: "mod:data_extraction:DataExtraction.load_from_mes" },
    { id: "e26", type: "contains" as const, source: "mod:data_extraction", target: "mod:data_extraction:DataExtraction.load_from_druid" },
    { id: "e27", type: "contains" as const, source: "mod:mes_connector", target: "mod:mes_connector:MESConnector.execute_query" },
    { id: "e28", type: "contains" as const, source: "mod:druid_connector", target: "mod:druid_connector:DruidConnector.query" },
    { id: "e29", type: "contains" as const, source: "mod:distribution", target: "mod:distribution:compute_stats" },
    { id: "e30", type: "contains" as const, source: "mod:distribution", target: "mod:distribution:worker_effectiveness" },
  ];

  const views = [
    // Root view — only groups, no edgeRefs (projection handles it)
    {
      id: "view:root",
      title: "Level 0 — Overview",
      parentViewId: null,
      scope: "root" as const,
      nodeRefs: ["grp:pipeline", "grp:connectors", "grp:analytics", "grp:utilities"],
      edgeRefs: [] as string[],
    },
    // Group views
    {
      id: "view:grp:pipeline",
      title: "Pipeline",
      parentViewId: "view:root",
      scope: "group" as const,
      nodeRefs: ["mod:simulation_data_generator", "mod:data_extraction"],
      edgeRefs: ["e1", "e4", "e5"],
    },
    {
      id: "view:grp:connectors",
      title: "Connectors / Infra",
      parentViewId: "view:root",
      scope: "group" as const,
      nodeRefs: ["mod:mes_connector", "mod:druid_connector"],
      edgeRefs: [],
    },
    {
      id: "view:grp:analytics",
      title: "Analytics",
      parentViewId: "view:root",
      scope: "group" as const,
      nodeRefs: ["mod:distribution", "mod:fit_distribution"],
      edgeRefs: ["e6"],
    },
    {
      id: "view:grp:utilities",
      title: "Utilities",
      parentViewId: "view:root",
      scope: "group" as const,
      nodeRefs: ["mod:remove_outliers", "mod:filter_methods", "mod:bath"],
      edgeRefs: [],
    },
    // Module/class drill-down views
    {
      id: "view:mod:simulation_data_generator",
      title: "SimulationDataGenerator",
      parentViewId: "view:grp:pipeline",
      scope: "class" as const,
      nodeRefs: [
        "mod:simulation_data_generator:SimulationDataGenerator.run_pipeline",
        "mod:simulation_data_generator:SimulationDataGenerator.export_results",
      ],
      edgeRefs: ["e20", "e21", "e25"],
    },
    {
      id: "view:mod:data_extraction",
      title: "DataExtraction",
      parentViewId: "view:grp:pipeline",
      scope: "class" as const,
      nodeRefs: [
        "mod:data_extraction:DataExtraction.load_from_mes",
        "mod:data_extraction:DataExtraction.load_from_druid",
      ],
      edgeRefs: ["e22", "e23"],
    },
    {
      id: "view:mod:mes_connector",
      title: "MESConnector",
      parentViewId: "view:grp:connectors",
      scope: "class" as const,
      nodeRefs: ["mod:mes_connector:MESConnector.execute_query"],
      edgeRefs: [],
    },
    {
      id: "view:mod:druid_connector",
      title: "DruidConnector",
      parentViewId: "view:grp:connectors",
      scope: "class" as const,
      nodeRefs: ["mod:druid_connector:DruidConnector.query"],
      edgeRefs: [],
    },
    {
      id: "view:mod:distribution",
      title: "Distribution",
      parentViewId: "view:grp:analytics",
      scope: "module" as const,
      nodeRefs: ["mod:distribution:compute_stats", "mod:distribution:worker_effectiveness"],
      edgeRefs: ["e24"],
    },
  ];

  return { symbols, relations, views, rootViewId: "view:root" };
}
