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

test("buildProcessDiagramConfigFromGraph produces a fixed six-stage Layer-1 overview", () => {
  const config = buildProcessDiagramConfigFromGraph(loadPipelineGraph());

  assert.deepEqual(
    config.packages.map((pkg) => pkg.label),
    [
      "SQL-Datenquellen",
      "Connectoren",
      "Data Extraction",
      "Transformation / Matching",
      "Distribution / Persistenz",
      "Simulation",
    ],
  );

  assert.equal(config.nodes.length, 0);
  assert.deepEqual(
    config.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label ?? ""}`),
    [
      "proc:pkg:sources->proc:pkg:connectors:query source systems",
      "proc:pkg:connectors->proc:pkg:extract:load raw data",
      "proc:pkg:extract->proc:pkg:transform:prepare / match data",
      "proc:pkg:transform->proc:pkg:persist:fit / persist",
      "proc:pkg:persist->proc:pkg:simulate:consume artefacts",
    ],
  );

  for (const pkg of config.packages) {
    assert.ok(pkg.drilldown);
    assert.ok((pkg.drilldown?.preferredViewIds?.length ?? 0) > 0 || (pkg.drilldown?.preferredSymbolIds?.length ?? 0) > 0);
  }
});

test("augmentGraphWithUmlOverlays renders only six process blocks at Layer-1", () => {
  const graph = loadPipelineGraph();
  const augmented = augmentGraphWithUmlOverlays(JSON.parse(JSON.stringify(graph)) as ProjectGraph);

  assert.equal(augmented.rootViewId, "view:process-overview");

  const processView = augmented.views.find((view) => view.id === "view:process-overview");
  assert.ok(processView);
  assert.deepEqual(processView?.nodeRefs, [
    "proc:pkg:sources",
    "proc:pkg:connectors",
    "proc:pkg:extract",
    "proc:pkg:transform",
    "proc:pkg:persist",
    "proc:pkg:simulate",
  ]);
  assert.equal(processView?.edgeRefs.length, 5);
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:node:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:art:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:db:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:note:")));

  for (const packageId of processView?.nodeRefs ?? []) {
    const symbol = augmented.symbols.find((candidate) => candidate.id === packageId);
    assert.equal(symbol?.umlType, "package");
    assert.ok(symbol?.childViewId);
    const childView = augmented.views.find((view) => view.id === symbol?.childViewId);
    assert.ok(childView);
    assert.ok(childView?.scope === "group" || childView?.scope === "module");
  }

  const oldRoot = augmented.views.find((view) => view.id === "view:root");
  assert.equal(oldRoot?.parentViewId, "view:process-overview");
  assert.equal(augmented.views.filter((view) => view.id.startsWith("view:process-stage:")).length, 0);
});
