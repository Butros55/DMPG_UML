import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph } from "@dmpg/shared";
import { normalizeViewReviewPanel } from "./reviewHints.js";
import { buildReviewHighlightRequest, resolveReviewEntryTargets } from "./reviewFocus.js";

function buildGraph(): ProjectGraph {
  return {
    symbols: [
      { id: "sym:group:datenquellen", label: "Datenquellen", kind: "group" },
      { id: "sym:db:mes", label: "MES", kind: "external" },
      { id: "sym:db:druid", label: "Druid", kind: "external" },
      { id: "sym:pkg:analytics", label: "Analytics", kind: "module" },
    ],
    relations: [],
    views: [
      {
        id: "view:root",
        title: "Root View",
        scope: "root",
        nodeRefs: ["sym:group:datenquellen", "sym:pkg:analytics"],
        edgeRefs: [],
        reviewHints: [
          {
            reviewId: "hint:compare",
            source: "uml_reference_compare",
            category: "notation",
            title: "Replace group with package",
            type: "notation_issue",
            severity: "high",
            message: "The professor reference uses package notation.",
            suggestedAction: "Promote the group to a package shape.",
            target: "Datenquellen",
            targetIds: ["sym:group:datenquellen"],
            status: "new",
          },
        ],
        graphSuggestions: [
          {
            id: "graph:context",
            source: "uml_reference_compare",
            type: "context_stub_addition",
            message: "Add the external MES and Druid context stubs.",
            targetIds: ["sym:db:mes", "sym:db:druid"],
            status: "new",
          },
        ],
        reviewActions: [
          {
            id: "action:1",
            source: "uml_reference_compare",
            priority: 1,
            action: "Fix context stubs before relation aggregation.",
            status: "new",
          },
        ],
        reviewSummary: {
          source: "uml_reference_compare",
          summary: "The current diagram still looks too UI-like.",
          umlQualityDelta: "better_reference",
          mainProblem: "context",
          isCurrentDiagramTooUiLike: true,
        },
      },
      {
        id: "view:groups",
        title: "Groups",
        parentViewId: "view:root",
        scope: "group",
        nodeRefs: ["sym:group:datenquellen", "sym:db:mes", "sym:db:druid"],
        edgeRefs: [],
      },
      {
        id: "view:analytics",
        title: "Analytics",
        parentViewId: "view:root",
        scope: "module",
        nodeRefs: ["sym:pkg:analytics", "sym:db:mes"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:root",
  };
}

test("resolveReviewEntryTargets prioritizes explicit targetIds over label matching", () => {
  const graph = buildGraph();
  const resolution = resolveReviewEntryTargets(
    graph,
    "view:root",
    {
      id: "item:1",
      source: "uml_reference_compare",
      category: "notation",
      severity: "high",
      title: "Use explicit targets",
      message: "The compare result already identified the exact node.",
      target: "MES",
      targetIds: ["sym:group:datenquellen"],
      status: "new",
      sourceLabel: "UML Reference Compare",
      storage: { kind: "item", collection: "reviewHints", id: "item:1" },
    },
  );

  assert.equal(resolution.matchedBy, "target_ids");
  assert.deepEqual(resolution.targetIds, ["sym:group:datenquellen"]);
  assert.equal(resolution.primaryTargetId, "sym:group:datenquellen");
});

test("resolveReviewEntryTargets prefers the view with the strongest multi-target coverage", () => {
  const graph = buildGraph();
  const resolution = resolveReviewEntryTargets(
    graph,
    "view:root",
    {
      id: "item:2",
      source: "uml_reference_compare",
      category: "context",
      severity: "high",
      title: "Add missing context",
      message: "The compare review references multiple external systems.",
      targetIds: ["sym:db:mes", "sym:db:druid"],
      status: "new",
      sourceLabel: "UML Reference Compare",
      storage: { kind: "item", collection: "graphSuggestions", id: "item:2" },
    },
  );

  assert.equal(resolution.viewId, "view:groups");
  assert.equal(resolution.primaryTargetId, "sym:db:mes");
  assert.deepEqual(resolution.targetIds, ["sym:db:mes", "sym:db:druid"]);
});

test("resolveReviewEntryTargets keeps label fallback in the current view when match strength is equal", () => {
  const graph = buildGraph();
  const resolution = resolveReviewEntryTargets(
    graph,
    "view:root",
    {
      id: "item:3",
      source: "uml_reference_compare",
      category: "notation",
      severity: "medium",
      title: "Improve package naming",
      message: "The compare review mentions Datenquellen by label only.",
      target: "Datenquellen",
      status: "new",
      sourceLabel: "UML Reference Compare",
      storage: { kind: "item", collection: "reviewHints", id: "item:3" },
    },
  );

  assert.equal(resolution.matchedBy, "target_label");
  assert.equal(resolution.viewId, "view:root");
  assert.deepEqual(resolution.targetIds, ["sym:group:datenquellen"]);
});

test("resolveReviewEntryTargets derives targetIds for top actions from related compare items", () => {
  const graph = buildGraph();
  const panel = normalizeViewReviewPanel(graph, "view:root");
  assert.ok(panel);

  const action = panel.topActions[0];
  assert.ok(action);

  const resolution = resolveReviewEntryTargets(graph, "view:root", action, panel);
  assert.equal(resolution.matchedBy, "action_context");
  assert.equal(resolution.viewId, "view:groups");
  assert.deepEqual(resolution.targetIds, ["sym:group:datenquellen", "sym:db:mes", "sym:db:druid"]);
});

test("buildReviewHighlightRequest preserves multi-target focus and fitView options", () => {
  const graph = buildGraph();
  const request = buildReviewHighlightRequest(
    graph,
    "view:root",
    {
      id: "item:4",
      source: "uml_reference_compare",
      category: "context",
      severity: "high",
      title: "Focus external context",
      message: "Two context systems should be shown together.",
      targetIds: ["sym:db:mes", "sym:db:druid"],
      status: "new",
      sourceLabel: "UML Reference Compare",
      storage: { kind: "item", collection: "graphSuggestions", id: "item:4" },
    },
    undefined,
    { fitView: false },
  );

  assert.equal(request.viewId, "view:groups");
  assert.equal(request.primaryTargetId, "sym:db:mes");
  assert.deepEqual(request.targetIds, ["sym:db:mes", "sym:db:druid"]);
  assert.equal(request.fitView, false);
});
