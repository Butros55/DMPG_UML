import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph } from "@dmpg/shared";
import {
  filterReviewItems,
  normalizeViewReviewPanel,
  sortReviewItems,
  updateReviewEntityStatus,
} from "./reviewHints.js";

function buildGraph(): ProjectGraph {
  return {
    symbols: [
      { id: "sym:group:datenquellen", label: "Datenquellen", kind: "group" },
      { id: "sym:db:mes", label: "MES", kind: "module" },
      { id: "sym:pkg:analytics", label: "Analytics", kind: "module" },
    ],
    relations: [],
    views: [
      {
        id: "view:root",
        title: "Root View",
        nodeRefs: ["sym:group:datenquellen", "sym:db:mes", "sym:pkg:analytics"],
        edgeRefs: [],
        reviewHints: [
          {
            reviewId: "hint:structure",
            source: "structure_review",
            category: "layering",
            title: "Weak layering",
            type: "layering_issue",
            severity: "medium",
            message: "The view is too flat for a proper layer-1 representation.",
            suggestedAction: "Split the current view into two clearer layers.",
            targetIds: ["sym:group:datenquellen"],
            status: "new",
          },
          {
            reviewId: "hint:compare",
            source: "uml_reference_compare",
            category: "notation",
            title: "Notation mismatch",
            type: "layering_issue",
            severity: "high",
            message: "The current view reads like UI cards instead of UML packages.",
            suggestedAction: "Replace the main domain card with package notation.",
            target: "Datenquellen",
            targetIds: ["sym:group:datenquellen"],
            confidence: 0.92,
            status: "new",
          },
        ],
        contextSuggestions: [
          {
            reviewId: "ctx:mes",
            source: "external_context_review",
            label: "MES",
            relatedSymbolIds: ["sym:db:mes"],
            reason: "MES should be visible as an external context stub.",
            confidence: 0.82,
            status: "acknowledged",
          },
        ],
        labelSuggestions: [
          {
            reviewId: "label:analytics",
            source: "label_improvement",
            targetId: "sym:pkg:analytics",
            oldLabel: "Analytics",
            newLabel: "Analytics Package",
            reason: "The name should express package-level responsibility.",
            confidence: 0.71,
            status: "new",
          },
        ],
        graphSuggestions: [
          {
            id: "graph:package",
            source: "uml_reference_compare",
            type: "node_type_change",
            message: "Change the Datenquellen node to a package-oriented shape.",
            targetIds: ["sym:group:datenquellen"],
            status: "new",
          },
        ],
        reviewActions: [
          {
            id: "action:1",
            source: "uml_reference_compare",
            priority: 1,
            action: "Fix package notation before adjusting labels.",
            status: "new",
          },
        ],
        reviewSummary: {
          source: "uml_reference_compare",
          summary: "The professor reference is more UML-like than the current view.",
          umlQualityDelta: "better_reference",
          mainProblem: "notation",
          isCurrentDiagramTooUiLike: true,
        },
      },
    ],
    rootViewId: "view:root",
  };
}

test("normalizeViewReviewPanel maps persisted review data into a unified frontend model", () => {
  const panel = normalizeViewReviewPanel(buildGraph(), "view:root");

  assert.ok(panel);
  assert.equal(panel?.items.length, 5);
  assert.equal(panel?.topActions.length, 1);
  assert.equal(panel?.reviewSummary?.isCurrentDiagramTooUiLike, true);
  assert.equal(panel?.items[0]?.source, "uml_reference_compare");
  assert.equal(panel?.items[0]?.severity, "high");
});

test("sortReviewItems prioritizes high severity before medium and low", () => {
  const panel = normalizeViewReviewPanel(buildGraph(), "view:root");
  assert.ok(panel);

  const sorted = sortReviewItems(panel!.items);
  assert.equal(sorted[0]?.severity, "high");
  assert.equal(sorted.at(-1)?.severity, "low");
});

test("filterReviewItems narrows the list to the requested source family", () => {
  const panel = normalizeViewReviewPanel(buildGraph(), "view:root");
  assert.ok(panel);

  const contextOnly = filterReviewItems(panel!.items, "context", false);
  const labelsOnly = filterReviewItems(panel!.items, "labels", false);
  const compareOnly = filterReviewItems(panel!.items, "vision_compare", false);

  assert.equal(contextOnly.length, 1);
  assert.equal(contextOnly[0]?.source, "external_context_review");
  assert.equal(labelsOnly.length, 1);
  assert.equal(labelsOnly[0]?.source, "label_improvement");
  assert.equal(compareOnly.length, 2);
  assert.ok(compareOnly.every((item) => item.source === "uml_reference_compare"));
});

test("updateReviewEntityStatus updates persisted review status for items and actions", () => {
  const graph = buildGraph();
  const view = graph.views[0]!;
  const panel = normalizeViewReviewPanel(graph, "view:root");
  assert.ok(panel);

  const nextView = updateReviewEntityStatus(view, panel!.items[0]!.storage, "applied");
  const finalView = updateReviewEntityStatus(nextView, panel!.topActions[0]!.storage, "dismissed");

  assert.equal(finalView.reviewHints?.find((hint) => hint.reviewId === "hint:compare")?.status, "applied");
  assert.equal(finalView.reviewActions?.find((action) => action.id === "action:1")?.status, "dismissed");
});
