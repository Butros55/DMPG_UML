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

test("buildProcessDiagramConfigFromGraph produces a scan-driven DMPG pipeline overview", () => {
  const config = buildProcessDiagramConfigFromGraph(loadPipelineGraph());

  assert.deepEqual(
    config.packages.map((pkg) => pkg.label),
    [
      "SQL-Datenquellen",
      "Connectoren",
      "Data Extraction & Vorverarbeitung",
      "Transformation / Matching / Filtering",
      "Distributionen / KDE / Persistenz",
      "Simulation (Konsum)",
    ],
  );

  const nodeLabels = new Set(config.nodes.map((node) => node.label));
  assert.ok(nodeLabels.has("MES / Produktions-DB"));
  assert.ok(nodeLabels.has("Druid / Analytics-DB"));
  assert.ok(nodeLabels.has("MESConnector"));
  assert.ok(nodeLabels.has("Data Extraction"));
  assert.ok(nodeLabels.has("Matching / Clustering"));
  assert.ok(nodeLabels.has("Distribution Fit"));
  assert.ok(nodeLabels.has("Persistierte JSON-Parameter"));
  assert.ok(nodeLabels.has("KDE / PKL Artefakte"));
  assert.ok(nodeLabels.has("Arrival Tables (.csv)"));
  assert.ok(nodeLabels.has("SimulationDataGenerator"));

  const edgeSet = new Set(
    config.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label ?? ""}`),
  );
  assert.ok(
    [...edgeSet].some((edge) => edge.includes("proc:db:mes->proc:node:connectors:mes:read production data")),
  );
  assert.ok(
    [...edgeSet].some((edge) => edge.includes("proc:node:connectors:mes->proc:node:extract:extract-core:load raw data")),
  );
  assert.ok(
    [...edgeSet].some((edge) => edge.includes("proc:art:matched->proc:node:persist:distribution-fit:fit distributions")),
  );
  assert.ok(
    [...edgeSet].some((edge) => edge.includes("proc:art:json->proc:node:simulate:sim-generator:consume persisted artefacts")),
  );
  assert.ok(
    [...edgeSet].some((edge) => edge.includes("proc:art:arrival->proc:node:simulate:sim-generator:load arrival tables")),
  );

  assert.deepEqual(
    config.stageViews.map((view) => view.id),
    [
      "view:process-stage:sources",
      "view:process-stage:connectors",
      "view:process-stage:extract",
      "view:process-stage:transform",
      "view:process-stage:persist",
      "view:process-stage:simulate",
    ],
  );
});

test("augmentGraphWithUmlOverlays makes the generated process overview the root view", () => {
  const graph = loadPipelineGraph();
  const augmented = augmentGraphWithUmlOverlays(JSON.parse(JSON.stringify(graph)) as ProjectGraph);

  assert.equal(augmented.rootViewId, "view:process-overview");

  const processView = augmented.views.find((view) => view.id === "view:process-overview");
  assert.ok(processView);
  assert.ok(processView?.nodeRefs.includes("proc:pkg:sources"));
  assert.ok(processView?.nodeRefs.includes("proc:pkg:simulate"));

  const stagePackages = [
    "proc:pkg:sources",
    "proc:pkg:connectors",
    "proc:pkg:extract",
    "proc:pkg:transform",
    "proc:pkg:persist",
    "proc:pkg:simulate",
  ];
  for (const [index, packageId] of stagePackages.entries()) {
    const processPackage = augmented.symbols.find((symbol) => symbol.id === packageId);
    const expectedStageId = [
      "sources",
      "connectors",
      "extract",
      "transform",
      "persist",
      "simulate",
    ][index];
    assert.equal(processPackage?.childViewId, `view:process-stage:${expectedStageId}`);
  }

  const oldRoot = augmented.views.find((view) => view.id === "view:root");
  assert.equal(oldRoot?.parentViewId, "view:process-overview");
  assert.equal(oldRoot?.hiddenInSidebar, true);

  const stageViews = augmented.views.filter((view) => view.id.startsWith("view:process-stage:"));
  assert.equal(stageViews.length, 6);
  for (const stageView of stageViews) {
    assert.equal(stageView.parentViewId, "view:process-overview");
    assert.equal(stageView.hiddenInSidebar, false);
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
    assert.ok(stageView.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
  }
});
