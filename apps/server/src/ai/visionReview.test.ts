import test from "node:test";
import assert from "node:assert/strict";
import {
  DiagramImageCompareRequestSchema,
  DiagramImageReviewResponseSchema,
  DiagramImageSuggestionsResponseSchema,
  type ProjectGraph,
  UmlReferenceCompareRequestSchema,
  UmlReferenceCompareResponseSchema,
} from "@dmpg/shared";
import { persistUmlReferenceCompareReview } from "./visionReview.js";

test("diagram image compare request validation requires exactly two images", () => {
  const parsed = DiagramImageCompareRequestSchema.safeParse({
    images: [{ mimeType: "image/png", dataBase64: "AA==" }],
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.issues[0]?.message ?? "", /exactly two images/);
  }
});

test("diagram image review response schema accepts structured issues", () => {
  const parsed = DiagramImageReviewResponseSchema.safeParse({
    summary: "The diagram is readable but sparse.",
    issues: [
      {
        type: "too_sparse",
        severity: "medium",
        message: "Only a few relations are visible.",
        suggestion: "Show key dependencies.",
        confidence: 0.81,
      },
    ],
    recommendedNodeTypes: [{ targetLabel: "Database", umlType: "database" }],
  });

  assert.equal(parsed.success, true);
});

test("diagram image suggestions response schema accepts structured UML suggestions", () => {
  const parsed = DiagramImageSuggestionsResponseSchema.safeParse({
    summary: "Two improvements stand out.",
    suggestions: [
      { type: "add_context_stub", target: "MES", message: "Expose MES as context.", confidence: 0.74 },
      { type: "aggregate_relations", message: "Aggregate repeated imports into one edge.", confidence: 0.68 },
    ],
  });

  assert.equal(parsed.success, true);
});

test("uml reference compare request validation requires exactly two images", () => {
  const parsed = UmlReferenceCompareRequestSchema.safeParse({
    images: [{ mimeType: "image/png", dataBase64: "AA==" }],
    viewId: "view:root",
    graphContext: { focus: "professor reference" },
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.issues[0]?.message ?? "", /exactly two images/);
  }
});

test("uml reference compare request accepts optional graph and view context", () => {
  const parsed = UmlReferenceCompareRequestSchema.safeParse({
    images: [
      { label: "current_view", mimeType: "image/png", dataBase64: "AA==" },
      { label: "reference_view", mimeType: "image/png", dataBase64: "AA==" },
    ],
    instruction: "Compare current UML view against the professor image.",
    viewId: "view:root",
    graphContext: {
      layer: "Layer-1",
      focus: "package notation",
    },
    persistSuggestions: true,
  });

  assert.equal(parsed.success, true);
});

test("uml reference compare response schema accepts structured UML migration guidance", () => {
  const parsed = UmlReferenceCompareResponseSchema.safeParse({
    summary: "The reference is more UML-like and better layered.",
    overallAssessment: {
      umlQualityDelta: "better_reference",
      mainProblem: "notation",
    },
    differences: [
      {
        category: "notation",
        severity: "high",
        message: "The current diagram uses generic cards instead of UML package/database notation.",
        suggestion: "Promote storage nodes to database shapes and major groups to packages.",
        target: "Datenquellen",
        confidence: 0.91,
      },
    ],
    migrationSuggestions: [
      {
        type: "replace_group_with_package",
        target: "Datenquellen",
        message: "Render the domain block as a UML package instead of a flat group card.",
        confidence: 0.9,
      },
      {
        type: "add_context_stub",
        target: "MES",
        message: "Add MES as an external context stub at layer 1.",
        confidence: 0.82,
      },
    ],
    recommendedActions: [
      { priority: 1, action: "Convert core groups to UML packages." },
      { priority: 2, action: "Add external context stubs before refining relations." },
    ],
    graphSuggestions: [
      {
        type: "node_type_change",
        targetIds: ["sym:group:1"],
        message: "Change the current group node to a package-oriented shape.",
      },
      {
        type: "context_stub_addition",
        targetIds: ["sym:ext:mes"],
        message: "Represent MES explicitly as context.",
      },
    ],
    isCurrentDiagramTooUiLike: true,
  });

  assert.equal(parsed.success, true);
});

test("persistUmlReferenceCompareReview maps structured compare findings into view review hints", () => {
  const graph: ProjectGraph = {
    symbols: [
      { id: "sym:group:datenquellen", label: "Datenquellen", kind: "group" },
      { id: "sym:db:mes", label: "MES", kind: "module" },
    ],
    relations: [],
    views: [
      {
        id: "view:root",
        title: "Root",
        nodeRefs: ["sym:group:datenquellen", "sym:db:mes"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:root",
  };

  const issues = persistUmlReferenceCompareReview(graph, "view:root", {
    summary: "Reference is more UML-like.",
    overallAssessment: {
      umlQualityDelta: "better_reference",
      mainProblem: "notation",
    },
    differences: [
      {
        category: "notation",
        severity: "high",
        message: "Datenquellen should be shown as a UML package rather than a plain card.",
        suggestion: "Use package notation for the Datenquellen group.",
        target: "Datenquellen",
        confidence: 0.93,
      },
      {
        category: "context",
        severity: "medium",
        message: "MES is an important external context but is barely represented.",
        suggestion: "Add a clearer context stub for MES.",
        target: "MES",
        confidence: 0.84,
      },
    ],
    migrationSuggestions: [],
    recommendedActions: [{ priority: 1, action: "Fix package notation first." }],
  });

  assert.equal(issues.length, 2);
  assert.equal(graph.views[0]?.reviewHints?.length, 2);
  assert.equal(graph.views[0]?.reviewHints?.[0]?.source, "uml_reference_compare");
  assert.equal(graph.views[0]?.reviewHints?.[0]?.type, "layering_issue");
  assert.equal(graph.views[0]?.reviewHints?.[1]?.type, "missing_context");
  assert.equal(graph.views[0]?.reviewActions?.[0]?.source, "uml_reference_compare");
  assert.equal(graph.views[0]?.reviewSummary?.isCurrentDiagramTooUiLike, undefined);
});
