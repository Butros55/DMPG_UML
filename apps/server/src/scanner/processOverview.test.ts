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
  assert.ok(nodeLabels.has("DruidConnector / MESConnector"));
  assert.ok(nodeLabels.has("Material_Cluster_Zuordnung.XLSX"));
  assert.ok(nodeLabels.has("df_data.csv"));
  assert.ok(nodeLabels.has("Arrival CSVs"));
  assert.ok(nodeLabels.has("{station}_{mat}.pickle"));
  assert.ok(nodeLabels.has("kde_min_max_values.json"));
  assert.ok(!nodeLabels.has("DB Imports"));
  assert.ok(!nodeLabels.has("Generated Tables"));

  const edges = new Set(config.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label ?? ""}`));
  assert.ok(edges.has("proc:src:connector-access->proc:pkg:inputs:query / API access"));
  assert.ok(edges.has("proc:pkg:extract->proc:artifact:df_data_csv:writes"));
  assert.ok(edges.has("proc:artifact:df_data_csv->proc:pkg:simulation:consumes"));
  assert.ok(edges.has("proc:pkg:match->proc:artifact:arrival_csvs:creates"));
  assert.ok(edges.has("proc:pkg:distribution->proc:artifact:station_mat_pickle:persists"));
  assert.ok(edges.has("proc:pkg:distribution->proc:artifact:kde_min_max_values_json:persists"));
  assert.ok(edges.has("proc:pkg:simulation->proc:artifact:effency_json:persists"));
  assert.ok(edges.has("proc:artifact:station_mat_pickle->proc:pkg:outputs:final artefact"));
  assert.ok(edges.has("proc:pkg:inputs->proc:pkg:extract:load source data"));

  const extractPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:extract");
  assert.ok(extractPackage?.preview?.some((line) => line.includes("Produces: df_data.csv")));

  const distributionPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:distribution");
  assert.ok(distributionPackage?.preview?.some((line) => line.includes("{station}_{mat}.pickle")));

  for (const pkg of config.packages) {
    assert.ok(pkg.childViewId?.startsWith("view:process-stage:"));
  }

  assert.equal(config.stageViews?.length, 7);
  for (const stageView of config.stageViews ?? []) {
    assert.ok(stageView.nodeRefs.length > 0);
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:")));
  }
});

test("augmentGraphWithUmlOverlays renders the pipeline Layer-1 and clean stage views", () => {
  const graph = loadPipelineGraph();
  const augmented = augmentGraphWithUmlOverlays(JSON.parse(JSON.stringify(graph)) as ProjectGraph);

  assert.equal(augmented.rootViewId, "view:process-overview");

  const processView = augmented.views.find((view) => view.id === "view:process-overview");
  assert.ok(processView);
  assert.ok((processView?.nodeRefs.length ?? 0) >= 20);
  assert.ok(processView?.nodeRefs.includes("proc:pkg:inputs"));
  assert.ok(processView?.nodeRefs.includes("proc:pkg:outputs"));
  assert.ok(processView?.nodeRefs.includes("proc:src:connector-access"));
  assert.ok(processView?.nodeRefs.includes("proc:artifact:df_data_csv"));
  assert.ok(processView?.nodeRefs.includes("proc:artifact:arrival_csvs"));
  assert.ok(processView?.nodeRefs.includes("proc:artifact:station_mat_pickle"));
  assert.ok((processView?.edgeRefs.length ?? 0) >= 30);
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:note:")));

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
    assert.ok(childView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:")));
    assert.ok(childView?.nodeRefs.every((nodeRef) => {
      const node = augmented.symbols.find((candidate) => candidate.id === nodeRef);
      return node?.kind === "module" || node?.kind === "class";
    }));
  }

  const oldRoot = augmented.views.find((view) => view.id === "view:root");
  assert.equal(oldRoot?.parentViewId, "view:process-overview");
  assert.equal(oldRoot?.hiddenInSidebar, true);
  assert.equal(augmented.views.find((view) => view.id === "view:grp:domain:data-sources")?.hiddenInSidebar, true);
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:__root__")?.hiddenInSidebar, true);

  const stageExtract = augmented.views.find((view) => view.id === "view:process-stage:extract");
  assert.equal(stageExtract?.hiddenInSidebar, false);
  assert.equal(augmented.views.find((view) => view.id === "view:mod:data_extraction")?.parentViewId, "view:process-stage:extract");
  assert.equal(augmented.views.find((view) => view.id === "view:grp:dir:distribution")?.parentViewId, "view:process-stage:distribution");

  const connectorView = augmented.views.find((view) => view.id === "view:grp:dir:connector");
  assert.deepEqual(connectorView?.nodeRefs, [
    "mod:connector.__init__",
    "mod:connector.druid_connector",
    "mod:connector.mes_connector",
  ]);
  assert.equal(connectorView?.nodePositions, undefined);

  const extractionModuleView = augmented.views.find((view) => view.id === "view:mod:data_extraction");
  assert.deepEqual(extractionModuleView?.nodeRefs, ["mod:data_extraction:DataExtraction"]);
  assert.equal(extractionModuleView?.nodePositions, undefined);

  const extractionClassView = augmented.views.find((view) => view.id === "view:mod:data_extraction:DataExtraction");
  assert.ok((extractionClassView?.nodeRefs.length ?? 0) > 5);
  assert.ok(extractionClassView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
  assert.ok(extractionClassView?.nodeRefs.every((nodeRef) => {
    const node = augmented.symbols.find((candidate) => candidate.id === nodeRef);
    return node?.kind === "method";
  }));
  assert.equal(extractionClassView?.nodePositions, undefined);

  assert.equal(augmented.views.filter((view) => view.id.startsWith("view:process-stage:")).length, 7);
});
