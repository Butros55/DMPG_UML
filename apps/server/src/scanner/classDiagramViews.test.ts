import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph, Relation, Symbol } from "@dmpg/shared";
import { ensureClassDiagramViewNodePools } from "./classDiagramViews.js";

function symbol(id: string, label: string, kind: Symbol["kind"], parentId?: string): Symbol {
  return { id, label, kind, parentId };
}

function relation(
  id: string,
  type: Relation["type"],
  source: string,
  target: string,
  extra: Partial<Relation> = {},
): Relation {
  return { id, type, source, target, ...extra };
}

function graphFixture(): ProjectGraph {
  return {
    rootViewId: "view:root",
    symbols: [
      symbol("mod:extract", "extract", "module"),
      symbol("mod:extract:Extractor", "Extractor", "class", "mod:extract"),
      symbol("mod:extract:Extractor.__init__", "Extractor.__init__", "method", "mod:extract:Extractor"),
      symbol("mod:extract:Extractor.druid_connector", "Extractor.druid_connector", "variable", "mod:extract:Extractor"),
      symbol("mod:extract:DruidConnector", "DruidConnector", "class", "mod:extract"),
      symbol("mod:extract:Worker", "Worker", "class", "mod:extract"),
      symbol("mod:extract:Worker.run", "Worker.run", "method", "mod:extract:Worker"),
      symbol("mod:extract:MaterialCluster", "MaterialCluster", "class", "mod:extract"),
      symbol("mod:extract:BaseExtractor", "BaseExtractor", "class", "mod:extract"),
      symbol("ext:pandas", "pandas", "external"),
      symbol("ext:numpy", "numpy", "external"),
      symbol("ext:DataFrame", "DataFrame", "external"),
    ],
    relations: [
      relation("r-inherits", "inherits", "mod:extract:Extractor", "mod:extract:BaseExtractor"),
      relation("r-composition", "composition", "mod:extract:Extractor.druid_connector", "mod:extract:DruidConnector", {
        sourceMultiplicity: "1",
        targetMultiplicity: "1",
        targetRole: "druid_connector",
      }),
      relation("r-aggregation", "aggregation", "mod:extract:Extractor", "mod:extract:Worker", {
        sourceMultiplicity: "1",
        targetMultiplicity: "0..*",
        targetRole: "workers",
      }),
      relation("r-association", "association", "mod:extract:Extractor", "mod:extract:MaterialCluster", {
        sourceMultiplicity: "1",
        targetMultiplicity: "0..1",
        targetRole: "material_cluster",
      }),
      relation("r-seed-call", "calls", "mod:extract:Extractor.__init__", "mod:extract:Worker.run"),
      relation("r-neighbor-call", "calls", "mod:extract:Worker.run", "mod:extract:MaterialCluster"),
      relation("r-pandas", "imports", "mod:extract:Extractor", "ext:pandas"),
      relation("r-numpy", "calls", "mod:extract:Extractor.__init__", "ext:numpy"),
      relation("r-dataframe", "dependency", "mod:extract:Extractor", "ext:DataFrame"),
    ],
    views: [
      {
        id: "view:process-stage:extract",
        title: "Extraction & Preprocessing",
        scope: "group",
        diagramType: "class",
        nodeRefs: ["mod:extract:Extractor", "ext:pandas"],
        edgeRefs: [],
      },
    ],
  };
}

test("process stage class views expand from seed classifiers to semantic UML neighbors", () => {
  const graph = graphFixture();
  const prepared = ensureClassDiagramViewNodePools(graph);
  const view = graph.views.find((entry) => entry.id === "view:process-stage:extract");

  assert.equal(prepared, 1);
  assert.ok(view);
  assert.equal(view.nodeRefs[0], "mod:extract:Extractor");
  for (const nodeId of [
    "mod:extract:BaseExtractor",
    "mod:extract:DruidConnector",
    "mod:extract:Worker",
    "mod:extract:MaterialCluster",
  ]) {
    assert.ok(view.nodeRefs.includes(nodeId), `${nodeId} should be included as semantic class context`);
  }
  assert.ok(view.nodeRefs.every((nodeId) => !nodeId.startsWith("ext:")));
  assert.ok(!view.nodeRefs.includes("ext:pandas"));
  assert.ok(!view.nodeRefs.includes("ext:numpy"));
  assert.ok(!view.nodeRefs.includes("ext:DataFrame"));

  for (const relationId of ["r-inherits", "r-composition", "r-aggregation", "r-association", "r-seed-call"]) {
    assert.ok(view.edgeRefs.includes(relationId), `${relationId} should be visible in the class view`);
  }
  assert.ok(!view.edgeRefs.includes("r-neighbor-call"));
  assert.ok(!view.edgeRefs.includes("r-pandas"));
  assert.ok(!view.edgeRefs.includes("r-numpy"));
  assert.ok(!view.edgeRefs.includes("r-dataframe"));

  const composition = graph.relations.find((entry) => entry.id === "r-composition");
  assert.equal(composition?.targetRole, "druid_connector");
  assert.equal(composition?.sourceMultiplicity, "1");
  assert.equal(composition?.targetMultiplicity, "1");
  assert.equal(graph.relations.find((entry) => entry.id === "r-aggregation")?.targetMultiplicity, "0..*");
  assert.equal(graph.relations.find((entry) => entry.id === "r-association")?.targetMultiplicity, "0..1");
});
