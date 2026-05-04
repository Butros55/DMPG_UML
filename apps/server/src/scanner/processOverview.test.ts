import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ProjectGraph } from "@dmpg/shared";
import {
  augmentGraphWithUmlOverlays,
  buildProcessDiagramConfigFromGraph,
} from "./processOverview.js";

function loadPipelineGraph(): ProjectGraph | null {
  const graphPath = path.resolve(import.meta.dirname, "../../projects/a845846712dc/graph.json");
  if (!fs.existsSync(graphPath)) return null;
  const raw = fs.readFileSync(graphPath, "utf8");
  return JSON.parse(raw) as ProjectGraph;
}

function hasEdge(
  config: ReturnType<typeof buildProcessDiagramConfigFromGraph>,
  predicate: (edge: ReturnType<typeof buildProcessDiagramConfigFromGraph>["edges"][number]) => boolean,
): boolean {
  return config.edges.some(predicate);
}

function isStageStructuralNodeRef(nodeRef: string): boolean {
  return !nodeRef.startsWith("proc:artifact:") &&
    !nodeRef.startsWith("proc:artifact-cluster:") &&
    !nodeRef.startsWith("proc:import-cluster:");
}

test("buildProcessDiagramConfigFromGraph builds a semantically grouped Layer-1 dataflow overview", (t) => {
  const graph = loadPipelineGraph();
  if (!graph) {
    t.skip("pipeline graph fixture is not present in this workspace");
    return;
  }
  const config = buildProcessDiagramConfigFromGraph(graph);

  assert.deepEqual(
    config.packages.map((pkg) => pkg.label),
    [
      "Input Sources",
      "Extraction & Preprocessing",
      "Transformation",
      "Matching & Filtering",
      "Distribution / KDE / Persistence",
      "Simulation",
    ],
  );

  const nodeLabels = new Set(config.nodes.map((node) => node.label));
  for (const label of [
    "Database Import",
    "CSV / Files",
    "MES / External Sources",
    "Tabular Artifacts (Extraction)",
    "Arrival Table",
    "Simulation Results",
  ]) {
    assert.ok(nodeLabels.has(label), `${label} should be visible in Layer 1`);
  }
  assert.ok(
    nodeLabels.has("JSON Artifacts (Distribution)") || nodeLabels.has("Distribution Outputs"),
    "distribution artifacts should be visible either as handoffs or as output sinks",
  );

  const arrivalTable = config.nodes.find((node) => node.id === "proc:output:arrival-table");
  assert.ok(arrivalTable?.preview?.[0]?.startsWith("@preview "));
  assert.ok(arrivalTable?.preview?.some((line) => line.includes("Arrival_Groß.csv")));
  assert.ok(arrivalTable?.preview?.some((line) => line.includes("Arrival_Klein.csv")));

  const fileImports = config.nodes.find((node) => node.id === "proc:input:file-imports");
  assert.ok(fileImports?.preview?.[0]?.startsWith("@preview "));
  assert.ok(fileImports?.preview?.some((line) => line.includes("Material_Cluster_Zuordnung.XLSX")));
  assert.ok(fileImports?.preview?.some((line) => line.includes("Wegrezept.csv")));

  const databaseImports = config.nodes.find((node) => node.id === "proc:input:database-import");
  assert.ok(databaseImports?.preview?.[0]?.startsWith("@preview "));
  assert.ok(databaseImports?.preview?.some((line) => line.includes("DruidConnector")));

  const simulationResults = config.nodes.find((node) => node.id === "proc:output:simulation-results");
  assert.ok(simulationResults?.preview?.[0]?.startsWith("@preview "));
  assert.ok(simulationResults?.preview?.some((line) => line.includes("filter_stats.xlsx")));
  assert.ok(simulationResults?.preview?.some((line) => line.includes("outliners.xlsx")));

  const distributionArtifact = config.supportNodes?.find((node) => node.id === "proc:artifact:distribution_json");
  assert.ok(distributionArtifact?.preview?.[0]?.includes("\"mode\":\"single\""));
  assert.ok(distributionArtifact?.preview?.[0]?.includes("\"stageId\":\"distribution\""));

  assert.ok(hasEdge(config, (edge) => edge.source === "proc:input:database-import" && edge.target === "proc:pkg:inputs" && edge.label === "database import"));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:input:file-imports" && edge.target === "proc:pkg:inputs" && edge.label === "file ingest"));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:input:external-sources" && edge.target === "proc:pkg:inputs" && edge.label === "external feeds"));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:pkg:simulation" && edge.target === "proc:output:arrival-table" && edge.label?.startsWith("arrival data: ") === true));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:pkg:simulation" && edge.target === "proc:output:simulation-results" && edge.label?.startsWith("simulation results: ") === true));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:pkg:extract" && edge.target.startsWith("proc:artifact-cluster:extract_") && edge.label?.startsWith("writes: ") === true));
  assert.ok(hasEdge(config, (edge) => edge.source.startsWith("proc:artifact-cluster:extract_") && edge.target === "proc:pkg:simulation" && edge.label?.startsWith("consumes: ") === true));
  assert.ok(hasEdge(config, (edge) =>
    edge.source === "proc:pkg:distribution" &&
    (
      (edge.target.startsWith("proc:artifact-cluster:distribution_json") && edge.label?.startsWith("persists: ") === true) ||
      (edge.target.startsWith("proc:output:distribution") && /persists|not read|final output/.test(edge.label ?? ""))
    ),
  ));
  assert.ok(!hasEdge(config, (edge) =>
    edge.source === "proc:pkg:distribution" &&
    edge.target === "proc:artifact:station_mat_pickle" &&
    edge.label === "persists",
  ));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:distribution.fit_distribution" && edge.target === "proc:artifact:distribution_json" && edge.label === "persists"));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:kerndichteschätzer" && edge.target === "proc:artifact:kde_min_max_values_json" && edge.label === "persists"));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:arrival_table.generate_arrival_table" && edge.target === "proc:artifact:arrival_gro_csv" && edge.label === "creates"));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:arrival_table.generate_arrival_table" && edge.target === "proc:artifact:arrival_klein_csv" && edge.label === "creates"));
  assert.ok(hasEdge(config, (edge) => edge.type === "reads" && edge.target === "mod:data_extraction:DataExtraction"));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:artifact:df_data_csv" && edge.target === "mod:simulation_data_generator:SimulationDataGenerator" && edge.label === "consumes"));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:pkg:inputs" && edge.target === "proc:pkg:extract" && edge.label === "source records"));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:pkg:distribution" && edge.target === "proc:pkg:simulation" && edge.label === "fitted distributions / KDE"));
  assert.ok(!hasEdge(config, (edge) => edge.source === "proc:pkg:simulation" && edge.target === "proc:pkg:outputs"));

  const extractPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:extract");
  assert.ok(extractPackage?.preview?.some((line) => line.includes("Produces: df_data.csv")));
  const distributionPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:distribution");
  assert.ok(distributionPackage?.preview?.some((line) => line.includes("{station}_{mat}.pickle")));

  for (const pkg of config.packages) {
    assert.ok(pkg.childViewId?.startsWith("view:process-stage:"));
  }

  const configStageViews = config.stageViews ?? [];
  const configClassStageViews = configStageViews.filter((view) => view.diagramType === "class");
  const configSequenceStageViews = configStageViews.filter((view) => view.diagramType === "sequence");
  assert.equal(configClassStageViews.length, 6);
  assert.equal(configSequenceStageViews.length, 0);
  const stageViewsById = new Map(configStageViews.map((view) => [view.id, view]));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("mod:data_extraction:DataExtraction"));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("proc:import-cluster:extract"));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("proc:artifact:df_data_with_order_worker_csv"));
  assert.ok((stageViewsById.get("view:process-stage:extract")?.edgeRefs ?? []).every((edgeRef) => !edgeRef.startsWith("process-edge:")));

  const transformStageNodeRefs = stageViewsById.get("view:process-stage:transform")?.nodeRefs ?? [];
  assert.ok(transformStageNodeRefs.includes("mod:color_change"));
  assert.ok(transformStageNodeRefs.includes("proc:artifact:color_change_json"));
  assert.ok(transformStageNodeRefs.includes("proc:import-cluster:transform"));

  const distributionStageNodeRefs = stageViewsById.get("view:process-stage:distribution")?.nodeRefs ?? [];
  assert.ok(distributionStageNodeRefs.includes("mod:distribution.fit_distribution"));
  assert.ok(distributionStageNodeRefs.includes("proc:artifact:distribution_json"));
  assert.ok(distributionStageNodeRefs.includes("proc:import-cluster:distribution"));

  const simulationStageNodeRefs = stageViewsById.get("view:process-stage:simulation")?.nodeRefs ?? [];
  assert.ok(simulationStageNodeRefs.includes("mod:simulation_data_generator:SimulationDataGenerator"));
  assert.ok(simulationStageNodeRefs.includes("mod:arrival_table.generate_arrival_table"));
  assert.ok(simulationStageNodeRefs.includes("proc:artifact:arrival_gro_csv"));
  assert.ok(simulationStageNodeRefs.includes("proc:artifact:filter_stats_xlsx"));
  assert.ok(!stageViewsById.has("view:process-stage:outputs"));

  const assignedStageByNodeRef = new Map<string, string>();
  for (const stageView of configClassStageViews) {
    assert.ok(stageView.nodeRefs.length > 0);
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
    for (const nodeRef of stageView.nodeRefs.filter(isStageStructuralNodeRef)) {
      assert.equal(
        assignedStageByNodeRef.get(nodeRef),
        undefined,
        `${nodeRef} should belong to exactly one stage view`,
      );
      assignedStageByNodeRef.set(nodeRef, stageView.id);
    }
  }
});

test("augmentGraphWithUmlOverlays renders the simplified Layer-1 and updated stage views", (t) => {
  const graph = loadPipelineGraph();
  if (!graph) {
    t.skip("pipeline graph fixture is not present in this workspace");
    return;
  }
  const augmented = augmentGraphWithUmlOverlays(JSON.parse(JSON.stringify(graph)) as ProjectGraph);

  assert.equal(augmented.rootViewId, "view:process-overview");

  const processView = augmented.views.find((view) => view.id === "view:process-overview");
  assert.ok(processView);
  assert.ok((processView?.nodeRefs.length ?? 0) >= 18);
  assert.ok(processView?.nodeRefs.includes("proc:pkg:inputs"));
  assert.ok(processView?.nodeRefs.includes("proc:pkg:simulation"));
  assert.ok(!processView?.nodeRefs.includes("proc:pkg:outputs"));
  assert.ok(processView?.nodeRefs.includes("proc:input:database-import"));
  assert.ok(processView?.nodeRefs.includes("proc:artifact-cluster:extract_tabular_category"));
  assert.ok(
    processView?.nodeRefs.includes("proc:artifact-cluster:distribution_json_category") ||
    processView?.nodeRefs.some((nodeRef) => nodeRef.startsWith("proc:output:distribution")),
  );
  assert.ok(processView?.nodeRefs.includes("proc:output:arrival-table"));
  assert.ok(processView?.nodeRefs.includes("proc:output:simulation-results"));
  assert.ok(processView?.edgeRefs.includes("process-edge:flow:proc_output_arrival_table:to-simulation-output"));
  assert.ok(processView?.edgeRefs.includes("process-edge:flow:proc_output_simulation_results:to-simulation-output"));
  assert.ok(!processView?.edgeRefs.includes("process-edge:pipeline:simulation->outputs"));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));

  const distributionArtifact = augmented.symbols.find((candidate) => candidate.id === "proc:artifact:distribution_json");
  assert.ok(distributionArtifact?.preview?.lines[0]?.startsWith("@preview "));
  const extractPackage = augmented.symbols.find((candidate) => candidate.id === "proc:pkg:extract");
  assert.ok(extractPackage?.preview?.lines.some((line) => line.includes("Produces: df_data.csv")));
  const distributionPackage = augmented.symbols.find((candidate) => candidate.id === "proc:pkg:distribution");
  assert.ok(distributionPackage?.preview?.lines.some((line) => line.includes("{station}_{mat}.pickle")));

  for (const packageId of (processView?.nodeRefs ?? []).filter((nodeRef) => nodeRef.startsWith("proc:pkg:"))) {
    const symbol = augmented.symbols.find((candidate) => candidate.id === packageId);
    assert.equal(symbol?.umlType, "package");
    assert.ok(symbol?.childViewId);
    const childView = augmented.views.find((view) => view.id === symbol?.childViewId);
    assert.ok(childView);
    assert.equal(childView?.parentViewId, "view:process-overview");
    assert.equal(childView?.scope, "group");
    assert.equal(childView?.diagramType, "class");
  }

  const oldRoot = augmented.views.find((view) => view.id === "view:root");
  if (oldRoot) {
    assert.equal(oldRoot.parentViewId, "view:process-overview");
    assert.equal(oldRoot.hiddenInSidebar, true);
  }

  const stageExtract = augmented.views.find((view) => view.id === "view:process-stage:extract");
  assert.equal(stageExtract?.hiddenInSidebar, false);
  assert.ok(stageExtract?.nodeRefs.includes("mod:data_extraction:DataExtraction"));
  assert.ok(!stageExtract?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(!stageExtract?.nodeRefs.includes("proc:import-cluster:extract"));

  const stageTransform = augmented.views.find((view) => view.id === "view:process-stage:transform");
  assert.ok(stageTransform?.nodeRefs.includes("mod:data_analyzer:DataAnalyzer"));
  assert.ok(!stageTransform?.nodeRefs.includes("mod:color_change"));
  assert.ok(!stageTransform?.nodeRefs.includes("proc:artifact:color_change_json"));
  assert.ok(!stageTransform?.nodeRefs.includes("proc:import-cluster:transform"));

  const stageDistribution = augmented.views.find((view) => view.id === "view:process-stage:distribution");
  assert.ok(stageDistribution?.nodeRefs.includes("mod:distribution:Distribution"));
  assert.ok(stageDistribution?.nodeRefs.includes("mod:save_object:SaveObject"));
  assert.ok(!stageDistribution?.nodeRefs.includes("mod:distribution.fit_distribution"));
  assert.ok(!stageDistribution?.nodeRefs.includes("proc:artifact:distribution_json"));
  assert.ok(!stageDistribution?.nodeRefs.includes("proc:import-cluster:distribution"));

  const stageSimulation = augmented.views.find((view) => view.id === "view:process-stage:simulation");
  assert.ok(stageSimulation?.nodeRefs.includes("mod:simulation_data_generator:SimulationDataGenerator"));
  assert.ok(!stageSimulation?.nodeRefs.includes("mod:arrival_table.generate_arrival_table"));
  assert.ok(!stageSimulation?.nodeRefs.includes("proc:artifact:arrival_gro_csv"));
  assert.ok(!stageSimulation?.nodeRefs.includes("proc:artifact:filter_stats_xlsx"));

  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_extraction")?.hiddenInSidebar, true);
  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_extraction:DataExtraction")?.parentViewId, "view:process-stage:extract");
  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_analyzer")?.hiddenInSidebar, true);
  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_analyzer:DataAnalyzer")?.parentViewId, "view:process-stage:transform");
  assert.equal(augmented.views.find((view) => view.id === "view:mod:simulation_data_generator")?.hiddenInSidebar, true);
  assert.equal(augmented.views.find((view) => view.id === "view:mod:simulation_data_generator:SimulationDataGenerator")?.parentViewId, "view:process-stage:simulation");
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:arrival_table")?.parentViewId, "view:process-stage:simulation");

  const extractionModuleView = augmented.views.find((view) => view.id === "view:mod:data_extraction");
  assert.ok(extractionModuleView?.nodeRefs.includes("mod:data_extraction:DataExtraction"));

  const extractionClassView = augmented.views.find((view) => view.id === "view:mod:data_extraction:DataExtraction");
  assert.deepEqual(extractionClassView?.nodeRefs, ["mod:data_extraction:DataExtraction"]);

  const distributionModuleView = augmented.views.find((view) => view.id === "view:mod:distribution.fit_distribution");
  assert.deepEqual(distributionModuleView?.nodeRefs, []);

  const simulationClassView = augmented.views.find((view) => view.id === "view:mod:simulation_data_generator:SimulationDataGenerator");
  assert.deepEqual(simulationClassView?.nodeRefs, ["mod:simulation_data_generator:SimulationDataGenerator"]);
  const simulationReadEdge = augmented.relations.find((relation) =>
    relation.type === "reads" &&
    relation.id.startsWith("process-edge:view-artifact:") &&
    relation.source === "proc:artifact:df_data_csv" &&
    relation.target === "mod:simulation_data_generator:SimulationDataGenerator.extract_data",
  );
  assert.equal(simulationReadEdge, undefined);

  const stageViews = augmented.views.filter((view) => view.id.startsWith("view:process-stage:"));
  const classStageViews = stageViews.filter((view) => view.diagramType === "class");
  const sequenceStageViews = stageViews.filter((view) => view.diagramType === "sequence");
  assert.equal(classStageViews.length, 6);
  assert.equal(sequenceStageViews.length, 0);
  assert.ok(!augmented.views.some((view) => view.id === "view:process-stage:outputs"));

  const assignedStageByNodeRef = new Map<string, string>();
  const symbolsById = new Map(augmented.symbols.map((symbol) => [symbol.id, symbol]));
  for (const stageView of classStageViews) {
    assert.ok(stageView.nodeRefs.every((nodeRef) => {
      const symbol = symbolsById.get(nodeRef);
      return symbol?.kind === "class" || symbol?.kind === "interface";
    }));
    for (const nodeRef of stageView.nodeRefs.filter(isStageStructuralNodeRef)) {
      assert.equal(
        assignedStageByNodeRef.get(nodeRef),
        undefined,
        `${nodeRef} should not appear in multiple stage views`,
      );
      assignedStageByNodeRef.set(nodeRef, stageView.id);
    }
  }
});
