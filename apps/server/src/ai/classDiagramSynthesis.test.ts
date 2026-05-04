import test from "node:test";
import assert from "node:assert/strict";
import type { DiagramView, ProjectGraph, Symbol } from "@dmpg/shared";
import {
  applyClassDiagramSuggestions,
  ensureClassDiagramViewNodePools,
  synthesizeClassDiagramsForGraph,
  validateClassDiagramRelationSuggestions,
} from "./classDiagramSynthesis.js";

function symbol(id: string, label: string, kind: Symbol["kind"], parentId?: string): Symbol {
  return { id, label, kind, parentId };
}

function graphFixture(): ProjectGraph {
  const view: DiagramView = {
    id: "view:mod:sample",
    title: "sample",
    scope: "module",
    diagramType: "class",
    nodeRefs: ["mod:sample"],
    edgeRefs: [],
  };

  return {
    rootViewId: "view:root",
    projectPath: "C:/tmp/sample",
    symbols: [
      symbol("mod:sample", "sample", "module"),
      symbol("mod:sample:Alpha", "Alpha", "class", "mod:sample"),
      symbol("mod:sample:Alpha.run", "run", "method", "mod:sample:Alpha"),
      symbol("mod:sample:Beta", "Beta", "class", "mod:sample"),
      symbol("mod:sample:Gamma", "Gamma", "class", "mod:sample"),
      symbol("mod:sample.helper", "helper", "function", "mod:sample"),
      symbol("ext:data.csv", "data.csv", "external"),
    ],
    relations: [
      {
        id: "scan-e0",
        type: "inherits",
        source: "mod:sample:Alpha",
        target: "mod:sample:Beta",
        confidence: 1,
      },
    ],
    views: [view],
  };
}

test("ensureClassDiagramViewNodePools normalizes module views to module classifiers plus classes", () => {
  const graph = graphFixture();
  graph.views[0]!.nodeRefs.push("ext:data.csv", "mod:sample.helper");
  const prepared = ensureClassDiagramViewNodePools(graph);
  const view = graph.views[0]!;

  assert.equal(prepared, 1);
  assert.deepEqual(view.nodeRefs, [
    "mod:sample",
    "mod:sample:Alpha",
    "mod:sample:Beta",
    "mod:sample:Gamma",
  ]);
  assert.ok(view.edgeRefs.includes("scan-e0"));
  assert.equal(graph.symbols.find((entry) => entry.id === "mod:sample")?.stereotype, "module");
  assert.ok(!view.nodeRefs.includes("ext:data.csv"));
  assert.ok(!view.nodeRefs.includes("mod:sample.helper"));
});

test("ensureClassDiagramViewNodePools lifts method-only class views to their owning class", () => {
  const graph = graphFixture();
  graph.views.push({
    id: "view:mod:sample:Alpha",
    title: "Alpha",
    scope: "class",
    diagramType: "class",
    nodeRefs: ["mod:sample:Alpha.run"],
    edgeRefs: [],
  });

  ensureClassDiagramViewNodePools(graph);
  const view = graph.views.find((entry) => entry.id === "view:mod:sample:Alpha");

  assert.ok(view?.nodeRefs.includes("mod:sample:Alpha"));
  assert.ok(!view?.nodeRefs.includes("mod:sample:Alpha.run"));
});

test("ensureClassDiagramViewNodePools normalizes group class views to module classifiers and classes", () => {
  const graph = graphFixture();
  const moduleSymbol = graph.symbols.find((entry) => entry.id === "mod:sample");
  assert.ok(moduleSymbol);
  moduleSymbol.parentId = "grp:stage";
  graph.symbols.unshift(symbol("grp:stage", "Stage", "group"));
  graph.views.push({
    id: "view:grp:stage",
    title: "Stage",
    scope: "group",
    diagramType: "class",
    nodeRefs: ["grp:stage", "mod:sample.helper", "ext:data.csv"],
    edgeRefs: [],
  });

  ensureClassDiagramViewNodePools(graph);
  const view = graph.views.find((entry) => entry.id === "view:grp:stage");
  assert.ok(view);
  assert.deepEqual(view.nodeRefs, [
    "mod:sample",
    "mod:sample:Alpha",
    "mod:sample:Beta",
    "mod:sample:Gamma",
  ]);
  assert.ok(view.nodeRefs.every((nodeId) => {
    const node = graph.symbols.find((entry) => entry.id === nodeId);
    return node?.kind === "module" || node?.kind === "class" || node?.kind === "interface";
  }));
  assert.ok(!view.nodeRefs.includes("mod:sample.helper"));
  assert.ok(!view.nodeRefs.includes("mod:sample:Alpha.run"));
  assert.ok(!view.nodeRefs.includes("ext:data.csv"));
});

test("ensureClassDiagramViewNodePools hides empty class views", () => {
  const graph = graphFixture();
  graph.views.push({
    id: "view:empty",
    title: "Empty",
    scope: "group",
    diagramType: "class",
    nodeRefs: ["ext:data.csv"],
    edgeRefs: [],
  });

  ensureClassDiagramViewNodePools(graph);
  const view = graph.views.find((entry) => entry.id === "view:empty");
  assert.equal(view?.hiddenInSidebar, true);
  assert.deepEqual(view?.nodeRefs, []);
});

test("validateClassDiagramRelationSuggestions rejects unsafe relation suggestions", () => {
  const graph = graphFixture();
  const view = graph.views[0]!;
  const accepted = validateClassDiagramRelationSuggestions(
    graph,
    view,
    {
      relations: [
        {
          sourceId: "mod:sample:Alpha",
          targetId: "mod:sample:Gamma",
          relationType: "aggregation",
          confidence: 0.86,
          targetMultiplicity: "0..*",
          targetRole: "items",
          rationale: "Alpha keeps a list of Gamma instances.",
        },
        {
          sourceId: "mod:sample:Alpha",
          targetId: "missing",
          relationType: "association",
          confidence: 0.95,
        },
        {
          sourceId: "mod:sample:Alpha",
          targetId: "mod:sample:Gamma",
          relationType: "calls",
          confidence: 0.95,
        },
        {
          sourceId: "mod:sample:Alpha",
          targetId: "mod:sample:Gamma",
          relationType: "dependency",
          confidence: 0.4,
        },
        {
          sourceId: "mod:sample:Alpha",
          targetId: "mod:sample:Beta",
          relationType: "inherits",
          confidence: 0.99,
        },
      ],
    },
    ["mod:sample:Alpha", "mod:sample:Beta", "mod:sample:Gamma"],
  );

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.relationType, "aggregation");
  assert.equal(accepted[0]?.targetMultiplicity, "0..*");
  assert.equal(accepted[0]?.targetRole, "items");
});

test("applyClassDiagramSuggestions writes validated AI relations with UML endpoint data", () => {
  const graph = graphFixture();
  const view = graph.views[0]!;
  view.nodeRefs.push("mod:sample:Alpha", "mod:sample:Gamma");

  const added = applyClassDiagramSuggestions(graph, view, [
    {
      sourceId: "mod:sample:Alpha",
      targetId: "mod:sample:Gamma",
      relationType: "composition",
      confidence: 0.9,
      label: "parts",
      targetMultiplicity: "1..*",
      targetRole: "parts",
    },
  ]);

  assert.equal(added, 1);
  const relation = graph.relations.find((entry) => entry.type === "composition");
  assert.equal(relation?.aiGenerated, true);
  assert.equal(relation?.targetMultiplicity, "1..*");
  assert.equal(relation?.targetRole, "parts");
  assert.ok(relation && view.edgeRefs.includes(relation.id));
});

test("synthesizeClassDiagramsForGraph stops after a non-retryable Ollama access error", async () => {
  const graph = graphFixture();
  graph.views.push({
    id: "view:mod:sample-copy",
    title: "sample copy",
    scope: "module",
    diagramType: "class",
    nodeRefs: ["mod:sample"],
    edgeRefs: [],
  });

  const envKeys = [
    "AI_PROVIDER",
    "AI_MODEL_ROUTING_ENABLED",
    "OLLAMA_BASE_URL",
    "OLLAMA_API_KEY",
    "OLLAMA_MODEL",
    "OLLAMA_CLOUD_MODEL",
  ] as const;
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  process.env.AI_PROVIDER = "cloud";
  process.env.AI_MODEL_ROUTING_ENABLED = "false";
  process.env.OLLAMA_BASE_URL = "http://ollama.test";
  process.env.OLLAMA_API_KEY = "test-key";
  process.env.OLLAMA_MODEL = "deepseek-v4-flash:cloud";
  delete process.env.OLLAMA_CLOUD_MODEL;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return {
      ok: false,
      status: 403,
      async text() {
        return '{"error":"this model requires a subscription, upgrade for access"}';
      },
    } as Response;
  }) as typeof fetch;

  try {
    const stats = await synthesizeClassDiagramsForGraph(graph, "C:/tmp/sample", {
      embeddingIndex: null,
    });

    assert.equal(fetchCalls, 1);
    assert.equal(stats.viewsAnalyzed, 0);
    assert.equal(stats.relationsAdded, 0);
    assert.match(stats.warnings.join("\n"), /Class diagram synthesis stopped: Ollama 403/i);
    assert.doesNotMatch(stats.warnings.join("\n"), /sample-copy/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
