import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ProjectGraph } from "@dmpg/shared";
import {
  augmentGraphWithUmlOverlays,
  buildProcessDiagramConfigFromGraph,
} from "./processOverview.js";

function loadPipelineGraph(): ProjectGraph {
  const graphPath = path.resolve(import.meta.dirname, "../../projects/a845846712dc/graph.json");
  const raw = fs.readFileSync(graphPath, "utf8");
  return JSON.parse(raw) as ProjectGraph;
}

function hasEdge(
  config: ReturnType<typeof buildProcessDiagramConfigFromGraph>,
  predicate: (edge: ReturnType<typeof buildProcessDiagramConfigFromGraph>["edges"][number]) => boolean,
): boolean {
  return config.edges.some(predicate);
}

test("buildProcessDiagramConfigFromGraph builds a semantically grouped Layer-1 dataflow overview", () => {
  const config = buildProcessDiagramConfigFromGraph(loadPipelineGraph());

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
    "JSON Artifacts (Distribution)",
    "Arrival Table",
    "Simulation Results",
  ]) {
    assert.ok(nodeLabels.has(label), `${label} should be visible in Layer 1`);
  }

  const arrivalTable = config.nodes.find((node) => node.id === "proc:output:arrival-table");
  assert.ok(arrivalTable?.preview?.[0]?.startsWith("@preview "));
  assert.ok(arrivalTable?.preview?.some((line) => line.includes("Arrival_Groß.csv")));
  assert.ok(arrivalTable?.preview?.some((line) => line.includes("Arrival_Klein.csv")));

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
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:pkg:distribution" && edge.target.startsWith("proc:artifact-cluster:distribution_json") && edge.label?.startsWith("persists: ") === true));
  assert.ok(hasEdge(config, (edge) => edge.source === "proc:pkg:distribution" && edge.target === "proc:artifact:station_mat_pickle" && edge.label === "persists"));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:distribution.fit_distribution" && edge.target === "proc:artifact:distribution_json" && edge.label === "persists"));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:kerndichteschätzer" && edge.target === "proc:artifact:kde_min_max_values_json" && edge.label === "persists"));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:arrival_table.generate_arrival_table" && edge.target === "proc:artifact:arrival_gro_csv" && edge.label === "creates"));
  assert.ok(hasEdge(config, (edge) => edge.source === "mod:arrival_table.generate_arrival_table" && edge.target === "proc:artifact:arrival_klein_csv" && edge.label === "creates"));
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

  assert.equal(config.stageViews?.length, 6);
  const stageViewsById = new Map((config.stageViews ?? []).map((view) => [view.id, view]));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("mod:data_extraction"));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("proc:artifact:df_data_with_order_worker_csv"));

  const transformStageNodeRefs = stageViewsById.get("view:process-stage:transform")?.nodeRefs ?? [];
  assert.ok(transformStageNodeRefs.includes("mod:color_change"));
  assert.ok(transformStageNodeRefs.includes("proc:artifact:color_change_json"));
  assert.ok(transformStageNodeRefs.includes("proc:artifact:color_change_fallback_json"));

  const distributionStageNodeRefs = stageViewsById.get("view:process-stage:distribution")?.nodeRefs ?? [];
  assert.ok(distributionStageNodeRefs.includes("mod:distribution.fit_distribution"));
  assert.ok(distributionStageNodeRefs.includes("proc:artifact:distribution_json"));
  assert.ok(distributionStageNodeRefs.includes("proc:artifact:effency_json"));
  assert.ok(distributionStageNodeRefs.includes("proc:artifact:kde_min_max_values_json"));

  const simulationStageNodeRefs = stageViewsById.get("view:process-stage:simulation")?.nodeRefs ?? [];
  assert.ok(simulationStageNodeRefs.includes("mod:simulation_data_generator"));
  assert.ok(simulationStageNodeRefs.includes("mod:arrival_table.generate_arrival_table"));
  assert.ok(simulationStageNodeRefs.includes("proc:artifact:arrival_gro_csv"));
  assert.ok(simulationStageNodeRefs.includes("proc:artifact:arrival_klein_csv"));
  assert.ok(simulationStageNodeRefs.includes("proc:artifact:filter_stats_xlsx"));
  assert.ok(simulationStageNodeRefs.includes("proc:artifact:outliners_xlsx"));
  assert.ok(!stageViewsById.has("view:process-stage:outputs"));

  const assignedStageByNodeRef = new Map<string, string>();
  for (const stageView of config.stageViews ?? []) {
    assert.ok(stageView.nodeRefs.length > 0);
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
    for (const nodeRef of stageView.nodeRefs) {
      assert.equal(
        assignedStageByNodeRef.get(nodeRef),
        undefined,
        `${nodeRef} should belong to exactly one stage view`,
      );
      assignedStageByNodeRef.set(nodeRef, stageView.id);
    }
  }
});

test("augmentGraphWithUmlOverlays renders the simplified Layer-1 and updated stage views", () => {
  const graph = loadPipelineGraph();
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
  assert.ok(processView?.nodeRefs.includes("proc:artifact-cluster:distribution_json_category"));
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
  }

  const oldRoot = augmented.views.find((view) => view.id === "view:root");
  if (oldRoot) {
    assert.equal(oldRoot.parentViewId, "view:process-overview");
    assert.equal(oldRoot.hiddenInSidebar, true);
  }

  const stageExtract = augmented.views.find((view) => view.id === "view:process-stage:extract");
  assert.equal(stageExtract?.hiddenInSidebar, false);
  assert.ok(stageExtract?.nodeRefs.includes("mod:data_extraction"));
  assert.ok(stageExtract?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(stageExtract?.nodeRefs.includes("proc:artifact:df_data_with_order_worker_csv"));

  const stageTransform = augmented.views.find((view) => view.id === "view:process-stage:transform");
  assert.ok(stageTransform?.nodeRefs.includes("mod:color_change"));
  assert.ok(stageTransform?.nodeRefs.includes("proc:artifact:color_change_json"));

  const stageDistribution = augmented.views.find((view) => view.id === "view:process-stage:distribution");
  assert.ok(stageDistribution?.nodeRefs.includes("mod:distribution.fit_distribution"));
  assert.ok(stageDistribution?.nodeRefs.includes("proc:artifact:distribution_json"));
  assert.ok(stageDistribution?.nodeRefs.includes("proc:artifact:kde_min_max_values_json"));

  const stageSimulation = augmented.views.find((view) => view.id === "view:process-stage:simulation");
  assert.ok(stageSimulation?.nodeRefs.includes("mod:simulation_data_generator"));
  assert.ok(stageSimulation?.nodeRefs.includes("mod:arrival_table.generate_arrival_table"));
  assert.ok(stageSimulation?.nodeRefs.includes("proc:artifact:arrival_gro_csv"));
  assert.ok(stageSimulation?.nodeRefs.includes("proc:artifact:arrival_klein_csv"));
  assert.ok(stageSimulation?.nodeRefs.includes("proc:artifact:filter_stats_xlsx"));
  assert.ok(stageSimulation?.nodeRefs.includes("proc:artifact:outliners_xlsx"));

  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_extraction")?.parentViewId, "view:process-stage:extract");
  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_analyzer")?.parentViewId, "view:process-stage:transform");
  assert.equal(augmented.views.find((view) => view.id === "view:mod:simulation_data_generator")?.parentViewId, "view:process-stage:simulation");
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:arrival_table")?.parentViewId, "view:process-stage:simulation");

  const extractionModuleView = augmented.views.find((view) => view.id === "view:mod:data_extraction");
  assert.ok(extractionModuleView?.nodeRefs.includes("mod:data_extraction:DataExtraction"));
  assert.ok(extractionModuleView?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(extractionModuleView?.nodeRefs.includes("proc:artifact:nass_var_csv"));

  const extractionClassView = augmented.views.find((view) => view.id === "view:mod:data_extraction:DataExtraction");
  assert.ok((extractionClassView?.nodeRefs.length ?? 0) > 5);
  assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_with_order_cluster_csv"));

  const distributionModuleView = augmented.views.find((view) => view.id === "view:mod:distribution.fit_distribution");
  assert.ok(distributionModuleView?.nodeRefs.includes("proc:artifact:distribution_json"));
  assert.ok(distributionModuleView?.nodeRefs.includes("proc:artifact:fallback_json"));

  const simulationModuleView = augmented.views.find((view) => view.id === "view:mod:simulation_data_generator");
  assert.ok(simulationModuleView?.nodeRefs.includes("proc:artifact:filter_stats_fallback_xlsx"));
  assert.ok(simulationModuleView?.nodeRefs.includes("proc:artifact:filter_stats_xlsx"));
  assert.ok(simulationModuleView?.nodeRefs.includes("proc:artifact:outliners_xlsx"));
  assert.ok(simulationModuleView?.nodeRefs.includes("proc:artifact:distribution_xlsx"));
  assert.ok(simulationModuleView?.nodeRefs.includes("proc:artifact:effency_json"));

  const stageViews = augmented.views.filter((view) => view.id.startsWith("view:process-stage:"));
  assert.equal(stageViews.length, 6);
  assert.ok(!augmented.views.some((view) => view.id === "view:process-stage:outputs"));

  const assignedStageByNodeRef = new Map<string, string>();
  for (const stageView of stageViews) {
    for (const nodeRef of stageView.nodeRefs) {
      assert.equal(
        assignedStageByNodeRef.get(nodeRef),
        undefined,
        `${nodeRef} should not appear in multiple stage views`,
      );
      assignedStageByNodeRef.set(nodeRef, stageView.id);
    }
  }
});
