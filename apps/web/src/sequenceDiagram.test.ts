import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph, RelationType } from "@dmpg/shared";

import { buildPackageSequenceDiagramDetails } from "./sequenceDiagram.js";

function createRelationFilters(): Record<RelationType, boolean> {
  return {
    imports: true,
    contains: true,
    calls: true,
    reads: true,
    writes: true,
    inherits: true,
    uses_config: true,
    instantiates: true,
    association: true,
    aggregation: true,
    composition: true,
  };
}

test("buildPackageSequenceDiagramDetails keeps sync and async calls separate and only adds responses for sync", () => {
  const graph: ProjectGraph = {
    symbols: [
      { id: "sym:controller", label: "Controller", kind: "function" },
      { id: "sym:worker", label: "Worker", kind: "function", tags: ["async"] },
    ],
    relations: [
      {
        id: "rel:sync",
        type: "calls",
        source: "sym:controller",
        target: "sym:worker",
        evidence: [{ file: "pipeline.py", startLine: 10, callKind: "sync" }],
      },
      {
        id: "rel:async",
        type: "calls",
        source: "sym:controller",
        target: "sym:worker",
        evidence: [{ file: "pipeline.py", startLine: 20, callKind: "async" }],
      },
    ],
    views: [
      {
        id: "view:process-overview",
        title: "Overview",
        scope: "root",
        diagramType: "class",
        nodeRefs: ["sym:controller", "sym:worker"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:process-overview",
  };

  const details = buildPackageSequenceDiagramDetails({
    graph,
    view: graph.views[0]!,
    visibleViewNodeRefs: ["sym:controller", "sym:worker"],
    hiddenSymbolIds: new Set<string>(),
    symbolOverrides: new Map(),
    relationFilters: createRelationFilters(),
    labelsMode: "compact",
    selectedSymbolId: null,
    selectedEdgeId: null,
  });

  const edgeIds = new Set(details.edges.map((edge) => edge.id));
  assert.ok(edgeIds.has("rel:sync"));
  assert.ok(edgeIds.has("rel:sync:response"));
  assert.ok(edgeIds.has("rel:async"));
  assert.ok(!edgeIds.has("rel:async:response"));

  const syncEdge = details.edges.find((edge) => edge.id === "rel:sync");
  const asyncEdge = details.edges.find((edge) => edge.id === "rel:async");
  assert.equal(syncEdge?.data?.sequenceKind, "sync");
  assert.equal(asyncEdge?.data?.sequenceKind, "async");
  assert.equal(details.projection.usedMessages, 2);
});
