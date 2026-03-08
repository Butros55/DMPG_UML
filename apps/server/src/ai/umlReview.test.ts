import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph } from "@dmpg/shared";
import { resolveAiConfig } from "../env.js";
import { buildViewHeuristics, collectViewOpportunities } from "./umlReview.js";
import { AI_USE_CASES } from "./useCases.js";

function createGraph(): ProjectGraph {
  return {
    rootViewId: "view:root",
    projectPath: "C:/tmp/example",
    symbols: [
      { id: "grp:data", label: "Data Pipeline / Extraction / Raw Inputs", kind: "group" },
      { id: "mod:extract", label: "pipeline.extract.loader", kind: "module", parentId: "grp:data", doc: {} },
      { id: "fn:load", label: "load_records", kind: "function", parentId: "grp:data", location: { file: "x.py", startLine: 1, endLine: 10 }, doc: {} },
      { id: "fn:clean", label: "clean_records", kind: "function", parentId: "grp:data", location: { file: "x.py", startLine: 12, endLine: 30 }, doc: { summary: "short" } },
      { id: "cls:model", label: "AnalyticsModel", kind: "class", parentId: "grp:data", location: { file: "x.py", startLine: 32, endLine: 50 }, doc: {} },
      { id: "mod:db", label: "DatabaseConnector", kind: "module" },
      { id: "mod:cfg", label: "AppConfig", kind: "module" },
    ],
    relations: [
      { id: "rel:e1", type: "reads", source: "fn:load", target: "mod:db" },
      { id: "rel:e2", type: "uses_config", source: "cls:model", target: "mod:cfg" },
    ],
    views: [
      {
        id: "view:root",
        title: "Pipeline Overview",
        nodeRefs: ["grp:data", "mod:extract", "fn:load", "fn:clean", "cls:model"],
        edgeRefs: [],
        nodePositions: [
          { symbolId: "grp:data", x: 0, y: 0 },
          { symbolId: "mod:extract", x: 10, y: 180 },
          { symbolId: "fn:load", x: 15, y: 360 },
          { symbolId: "fn:clean", x: 12, y: 540 },
          { symbolId: "cls:model", x: 8, y: 720 },
        ],
      },
    ],
  };
}

test("buildViewHeuristics marks sparse views and suggests UML use cases", () => {
  const heuristics = buildViewHeuristics(createGraph(), "view:root");

  assert.equal(heuristics.layoutPattern, "stacked");
  assert.equal(heuristics.sparse, true);
  assert.equal(heuristics.internalEdgeCount, 0);
  assert.equal(heuristics.externalDependencyCount, 2);
  assert.ok(heuristics.reasons.length >= 1);
  assert.ok(heuristics.applicableUseCases.includes(AI_USE_CASES.UML_STRUCTURE_REVIEW));
  assert.ok(heuristics.applicableUseCases.includes(AI_USE_CASES.UML_SYMBOL_ENRICHMENT));
  assert.ok(heuristics.applicableUseCases.includes(AI_USE_CASES.UML_RELATION_ENRICHMENT));
  assert.ok(heuristics.applicableUseCases.includes(AI_USE_CASES.UML_LABEL_IMPROVEMENT));
});

test("collectViewOpportunities resolves models for applicable UML use cases", () => {
  const opportunities = collectViewOpportunities(
    createGraph(),
    resolveAiConfig({
      AI_MODEL_ROUTING_ENABLED: "true",
      OLLAMA_MODEL: "global-model",
      UML_CODE_ANALYSIS_MODEL: "code-model",
      UML_DIAGRAM_REVIEW_MODEL: "diagram-model",
      UML_LABELING_MODEL: "label-model",
    }),
  );

  const root = opportunities[0];
  const structureModel = root.resolvedModels.find((entry) => entry.useCase === AI_USE_CASES.UML_STRUCTURE_REVIEW);
  const labelModel = root.resolvedModels.find((entry) => entry.useCase === AI_USE_CASES.UML_LABEL_IMPROVEMENT);

  assert.equal(root.viewId, "view:root");
  assert.equal(structureModel?.model, "diagram-model");
  assert.equal(labelModel?.model, "label-model");
});
