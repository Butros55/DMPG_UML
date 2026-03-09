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

test("buildProcessDiagramConfigFromGraph produces a fixed pipeline-oriented Layer-1 overview", () => {
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

  assert.deepEqual(
    config.nodes.map((node) => node.label),
    [
      "DB Imports",
      "CSV / Excel Inputs",
      "MES / API Inputs",
      "Generated Tables",
      "JSON / KDE Models",
      "Simulation Results",
    ],
  );
  assert.deepEqual(
    config.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label ?? ""}`),
    [
      "proc:src:db-imports->proc:pkg:inputs:database imports",
      "proc:src:file-inputs->proc:pkg:inputs:file inputs",
      "proc:src:mes-api->proc:pkg:inputs:connector feeds",
      "proc:pkg:outputs->proc:out:tables:tables",
      "proc:pkg:outputs->proc:out:json-models:json / kde",
      "proc:pkg:outputs->proc:out:sim-results:simulation results",
      "proc:pkg:inputs->proc:pkg:extract:load inputs",
      "proc:pkg:extract->proc:pkg:transform:prepare data",
      "proc:pkg:transform->proc:pkg:match:enrich / align",
      "proc:pkg:match->proc:pkg:distribution:fit / persist inputs",
      "proc:pkg:distribution->proc:pkg:simulation:consume persisted models",
      "proc:pkg:simulation->proc:pkg:outputs:produce artefacts",
    ],
  );

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
  assert.equal(processView?.nodeRefs.length, 13);
  assert.ok(processView?.nodeRefs.includes("proc:pkg:inputs"));
  assert.ok(processView?.nodeRefs.includes("proc:pkg:outputs"));
  assert.ok(processView?.nodeRefs.includes("proc:src:db-imports"));
  assert.ok(processView?.nodeRefs.includes("proc:out:sim-results"));
  assert.equal(processView?.edgeRefs.length, 12);
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("ext:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("stub:")));
  assert.ok(processView?.nodeRefs.every((nodeRef) => !nodeRef.startsWith("proc:note:")));

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

  assert.equal(augmented.views.filter((view) => view.id.startsWith("view:process-stage:")).length, 7);
});
