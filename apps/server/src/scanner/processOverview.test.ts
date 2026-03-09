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

test("buildProcessDiagramConfigFromGraph builds a scan-based Layer-1 dataflow overview", () => {
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
      "Artefacts / Outputs",
    ],
  );

  const nodeLabels = new Set(config.nodes.map((node) => node.label));
  for (const label of [
    "Database Import",
    "CSV / Files",
    "MES / External Sources",
    "df_data.csv",
    "df_data_with_order.csv",
    "df_data_with_order_cluster.csv",
    "Arrival CSVs",
    "Arrival Table",
    "Generated Data",
    "Persisted Models",
    "Simulation Results",
    "kde_min_max_values.json",
  ]) {
    assert.ok(nodeLabels.has(label), `${label} should be visible in Layer 1`);
  }

  const edges = new Set(config.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label ?? ""}`));
  assert.ok(edges.has("proc:input:database-import->proc:pkg:inputs:database import"));
  assert.ok(edges.has("proc:input:file-imports->proc:pkg:inputs:file ingest"));
  assert.ok(edges.has("proc:input:external-sources->proc:pkg:inputs:external feeds"));
  assert.ok(edges.has("proc:pkg:outputs->proc:output:arrival-table:arrival data"));
  assert.ok(edges.has("proc:pkg:outputs->proc:output:generated-data:generated data"));
  assert.ok(edges.has("proc:pkg:outputs->proc:output:persisted-models:stored models"));
  assert.ok(edges.has("proc:pkg:outputs->proc:output:simulation-results:simulation results"));
  assert.ok(edges.has("proc:pkg:extract->proc:artifact:df_data_csv:writes"));
  assert.ok(edges.has("proc:pkg:extract->proc:artifact:df_data_with_order_csv:writes"));
  assert.ok(edges.has("proc:pkg:extract->proc:artifact:df_data_with_order_cluster_csv:writes"));
  assert.ok(edges.has("proc:pkg:distribution->proc:artifact:kde_min_max_values_json:persists"));
  assert.ok(edges.has("proc:pkg:outputs->proc:artifact:arrival_csvs:creates"));
  assert.ok(edges.has("proc:pkg:inputs->proc:pkg:extract:source records"));
  assert.ok(edges.has("proc:pkg:extract->proc:pkg:transform:prepared data"));
  assert.ok(edges.has("proc:pkg:transform->proc:pkg:match:normalized entities"));
  assert.ok(edges.has("proc:pkg:match->proc:pkg:distribution:matched / filtered data"));
  assert.ok(edges.has("proc:pkg:distribution->proc:pkg:simulation:fitted distributions / KDE"));
  assert.ok(edges.has("proc:pkg:simulation->proc:pkg:outputs:simulation artefacts"));

  const extractPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:extract");
  assert.ok(extractPackage?.preview?.some((line) => line.includes("Produces: df_data.csv")));
  assert.ok(extractPackage?.preview?.some((line) => line.includes("df_data_with_order_cluster.csv")));

  const distributionPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:distribution");
  assert.ok(distributionPackage?.preview?.some((line) => line.includes("{station}_{mat}.pickle")));

  for (const pkg of config.packages) {
    assert.ok(pkg.childViewId?.startsWith("view:process-stage:"));
  }

  assert.equal(config.stageViews?.length, 7);
  const stageViewsById = new Map((config.stageViews ?? []).map((view) => [view.id, view]));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("mod:data_extraction"));
  assert.ok(!stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("mod:data_extraction:DataExtraction"));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("proc:artifact:df_data_with_order_csv"));
  assert.ok(stageViewsById.get("view:process-stage:extract")?.nodeRefs.includes("proc:artifact:df_data_with_order_cluster_csv"));
  const transformStageNodeRefs = stageViewsById.get("view:process-stage:transform")?.nodeRefs ?? [];
  assert.ok(transformStageNodeRefs.includes("mod:color_change"));
  assert.ok(transformStageNodeRefs.includes("mod:data_analyzer"));
  assert.ok(transformStageNodeRefs.includes("proc:artifact:color_change_json"));
  assert.ok(transformStageNodeRefs.includes("proc:artifact:color_change_fallback_json"));
  const matchStageNodeRefs = stageViewsById.get("view:process-stage:match")?.nodeRefs ?? [];
  assert.ok(matchStageNodeRefs.includes("mod:is_table.generate_is_table"));
  assert.ok(matchStageNodeRefs.includes("mod:filter_methods"));
  assert.ok(!matchStageNodeRefs.includes("mod:filter_methods:FilterMethods"));
  assert.ok(stageViewsById.get("view:process-stage:distribution")?.nodeRefs.includes("proc:artifact:kde_min_max_values_json"));
  assert.ok(stageViewsById.get("view:process-stage:simulation")?.nodeRefs.includes("proc:artifact:filter_stats_exports"));
  assert.ok(stageViewsById.get("view:process-stage:outputs")?.nodeRefs.includes("mod:arrival_table.generate_arrival_table"));
  assert.ok(stageViewsById.get("view:process-stage:outputs")?.nodeRefs.includes("proc:artifact:arrival_csvs"));

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

test("augmentGraphWithUmlOverlays renders the pipeline Layer-1 and clean stage views", () => {
  const graph = loadPipelineGraph();
  const augmented = augmentGraphWithUmlOverlays(JSON.parse(JSON.stringify(graph)) as ProjectGraph);

  assert.equal(augmented.rootViewId, "view:process-overview");

  const processView = augmented.views.find((view) => view.id === "view:process-overview");
  assert.ok(processView);
  assert.ok((processView?.nodeRefs.length ?? 0) >= 18);
  assert.ok(processView?.nodeRefs.includes("proc:pkg:inputs"));
  assert.ok(processView?.nodeRefs.includes("proc:pkg:outputs"));
  assert.ok(processView?.nodeRefs.includes("proc:input:database-import"));
  assert.ok(processView?.nodeRefs.includes("proc:input:file-imports"));
  assert.ok(processView?.nodeRefs.includes("proc:input:external-sources"));
  assert.ok(processView?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(processView?.nodeRefs.includes("proc:artifact:kde_min_max_values_json"));
  assert.ok(processView?.nodeRefs.includes("proc:artifact:arrival_csvs"));
  assert.ok(processView?.nodeRefs.includes("proc:output:arrival-table"));
  assert.ok(processView?.nodeRefs.includes("proc:output:generated-data"));
  assert.ok(processView?.nodeRefs.includes("proc:output:persisted-models"));
  assert.ok(processView?.nodeRefs.includes("proc:output:simulation-results"));
  assert.ok((processView?.edgeRefs.length ?? 0) >= 20);
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:note:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:src:")));

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
    assert.ok(childView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
    assert.ok(childView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
    assert.ok(childView?.nodeRefs.every((nodeRef) => {
      const node = augmented.symbols.find((candidate) => candidate.id === nodeRef);
      return node?.kind === "module" || node?.kind === "class" || node?.id.startsWith("proc:artifact:");
    }));
  }

  const oldRoot = augmented.views.find((view) => view.id === "view:root");
  assert.equal(oldRoot?.parentViewId, "view:process-overview");
  assert.equal(oldRoot?.hiddenInSidebar, true);
  assert.equal(augmented.views.find((view) => view.id === "view:grp:domain:data-sources")?.hiddenInSidebar, true);
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:__root__")?.hiddenInSidebar, true);

  const stageExtract = augmented.views.find((view) => view.id === "view:process-stage:extract");
  assert.equal(stageExtract?.hiddenInSidebar, false);
  assert.ok(stageExtract?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(stageExtract?.nodeRefs.includes("proc:artifact:df_data_with_order_csv"));
  assert.ok(stageExtract?.nodeRefs.includes("proc:artifact:df_data_with_order_cluster_csv"));
  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_extraction")?.parentViewId, "view:process-stage:extract");
  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_analyzer")?.parentViewId, "view:process-stage:transform");
  assert.equal(augmented.views.find((view) => view.id === "view:mod:simulation_data_generator")?.parentViewId, "view:process-stage:simulation");
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:arrival_table")?.parentViewId, "view:process-stage:outputs");
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:is_table")?.parentViewId, "view:process-stage:match");
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:distribution")?.parentViewId, "view:process-stage:distribution");

  const connectorView = augmented.views.find((view) => view.id === "view:grp:dir:connector");
  assert.deepEqual(connectorView?.nodeRefs, [
    "mod:connector.__init__",
    "mod:connector.druid_connector",
    "mod:connector.mes_connector",
  ]);
  assert.equal(connectorView?.nodePositions, undefined);

  const extractionModuleView = augmented.views.find((view) => view.id === "view:mod:data_extraction");
  assert.ok(extractionModuleView?.nodeRefs.includes("mod:data_extraction:DataExtraction"));
  assert.ok(extractionModuleView?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(extractionModuleView?.nodeRefs.includes("proc:artifact:df_data_with_order_csv"));
  assert.ok(extractionModuleView?.nodeRefs.includes("proc:artifact:df_data_with_order_cluster_csv"));
  assert.equal(extractionModuleView?.nodePositions, undefined);

  const stageDistribution = augmented.views.find((view) => view.id === "view:process-stage:distribution");
  assert.ok(!stageDistribution?.nodeRefs.includes("mod:distribution.save_object:SaveObject"));

  const extractionClassView = augmented.views.find((view) => view.id === "view:mod:data_extraction:DataExtraction");
  assert.ok((extractionClassView?.nodeRefs.length ?? 0) > 5);
  assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_with_order_csv"));
  assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_with_order_cluster_csv"));
  assert.ok(extractionClassView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
  assert.ok(extractionClassView?.nodeRefs.every((nodeRef) => {
    const node = augmented.symbols.find((candidate) => candidate.id === nodeRef);
    return node?.kind === "method" || node?.id.startsWith("proc:artifact:");
  }));
  assert.equal(extractionClassView?.nodePositions, undefined);

  const stageViews = augmented.views.filter((view) => view.id.startsWith("view:process-stage:"));
  assert.equal(stageViews.length, 7);

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
