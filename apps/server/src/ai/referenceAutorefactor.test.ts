import test from "node:test";
import assert from "node:assert/strict";
import type {
  ProjectGraph,
  UmlReferenceCompareResponse,
  UmlReferenceRefactorPlan,
  UmlReferenceRefactorValidation,
} from "@dmpg/shared";
import { UmlReferenceAutorefactorRequestSchema } from "@dmpg/shared";
import {
  applyReferenceRefactorPlan,
  validateReferenceRefactorPlan,
} from "./referenceAutorefactor.js";

function buildGraph(): ProjectGraph {
  return {
    symbols: [
      { id: "sym:group:data", label: "Datenquellen", kind: "group" },
      { id: "sym:module:pipeline", label: "Data Pipeline", kind: "module", parentId: "sym:group:data" },
    ],
    relations: [],
    views: [
      {
        id: "view:root",
        title: "Overview",
        scope: "root",
        nodeRefs: ["sym:group:data", "sym:module:pipeline"],
        edgeRefs: [],
      },
      {
        id: "view:hidden-overview",
        title: "Data Pipeline Overview",
        parentViewId: "view:root",
        hiddenInSidebar: true,
        scope: "root",
        nodeRefs: ["sym:group:data", "sym:module:pipeline"],
        edgeRefs: [],
      },
      {
        id: "view:group:data",
        title: "Input Sources",
        parentViewId: "view:root",
        scope: "group",
        nodeRefs: ["sym:group:data", "sym:module:pipeline"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:root",
    projectPath: "C:/tmp/dmpg-test-project",
  };
}

function buildCompare(): UmlReferenceCompareResponse {
  return {
    summary: "The reference uses clearer package notation and stronger context exposure.",
    overallAssessment: {
      umlQualityDelta: "better_reference",
      mainProblem: "notation",
    },
    differences: [
      {
        category: "notation",
        severity: "high",
        message: "Datenquellen should be rendered as a UML package.",
        suggestion: "Switch the group to package notation.",
        target: "Datenquellen",
        confidence: 0.92,
      },
    ],
    migrationSuggestions: [
      {
        type: "replace_group_with_package",
        target: "Datenquellen",
        message: "Use package notation for the data source area.",
        confidence: 0.89,
      },
    ],
    recommendedActions: [
      { priority: 1, action: "Fix package notation first." },
    ],
  };
}

test("reference autorefactor request schema requires both current and reference images", () => {
  const parsed = UmlReferenceAutorefactorRequestSchema.safeParse({
    currentViewImage: { mimeType: "image/png", dataBase64: "AA==" },
    viewId: "view:root",
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.issues.map((issue) => issue.path.join(".")).join(","), /referenceImage/);
  }
});

test("validateReferenceRefactorPlan keeps deterministic label changes auto-applicable without AI fallback", async () => {
  const graph = buildGraph();
  const plan: UmlReferenceRefactorPlan = {
    summary: "Rename the primary group.",
    actions: [
      {
        id: "rename-symbol",
        type: "rename_symbol",
        targetIds: ["sym:group:data"],
        viewId: "view:root",
        payload: { newLabel: "SQL-Datenquellen" },
        confidence: 0.88,
        severity: "medium",
        autoApplicable: true,
      },
    ],
    primaryFocusTargetIds: ["sym:group:data"],
    changedViewIds: ["view:root"],
    remainingReviewOnlyItems: [],
  };

  const validation = await validateReferenceRefactorPlan({
    plan,
    graph,
    viewId: "view:root",
    compare: buildCompare(),
    options: {
      autoApply: true,
      allowStructuralChanges: true,
      allowLabelChanges: true,
      allowRelationChanges: true,
      persistSuggestions: true,
      dryRun: false,
    },
  });

  assert.equal(validation.decisions[0]?.decision, "apply");
});

test("applyReferenceRefactorPlan auto-applies UML type, rename and context stub actions", () => {
  const graph = buildGraph();
  const compare = buildCompare();
  const plan: UmlReferenceRefactorPlan = {
    summary: "Promote the group to a package, rename it and expose external context.",
    actions: [
      {
        id: "set-package",
        type: "set_uml_type",
        targetIds: ["sym:group:data"],
        viewId: "view:root",
        payload: { umlType: "package" },
        confidence: 0.93,
        severity: "high",
        autoApplicable: true,
      },
      {
        id: "rename-package",
        type: "rename_symbol",
        targetIds: ["sym:group:data"],
        viewId: "view:root",
        payload: { newLabel: "SQL-Datenquellen" },
        confidence: 0.86,
        severity: "medium",
        autoApplicable: true,
      },
      {
        id: "add-context",
        type: "add_context_stub",
        targetIds: [],
        viewId: "view:root",
        payload: { label: "MES", summary: "External manufacturing execution system." },
        confidence: 0.81,
        severity: "medium",
        autoApplicable: true,
      },
    ],
    primaryFocusTargetIds: ["sym:group:data"],
    changedViewIds: ["view:root"],
    remainingReviewOnlyItems: [],
  };
  const validation: UmlReferenceRefactorValidation = {
    summary: "All actions are safe to apply.",
    decisions: plan.actions.map((action) => ({
      actionId: action.id,
      decision: "apply",
      reason: "Test fixture marks these actions as deterministic.",
    })),
  };

  const response = applyReferenceRefactorPlan({
    graph,
    viewId: "view:root",
    compare,
    plan,
    validation,
    options: {
      autoApply: true,
      allowStructuralChanges: true,
      allowLabelChanges: true,
      allowRelationChanges: true,
      persistSuggestions: true,
      dryRun: false,
    },
  });

  assert.equal(response.appliedActions.length, 3);
  assert.equal(response.reviewOnlyActions.length, 0);
  assert.equal(response.autoApplied, true);

  const updatedGroup = response.graph?.symbols.find((symbol) => symbol.id === "sym:group:data");
  const mesStub = response.graph?.symbols.find((symbol) => symbol.label === "MES");
  assert.equal(updatedGroup?.umlType, "package");
  assert.equal(updatedGroup?.label, "SQL-Datenquellen");
  assert.equal(mesStub?.umlType, "artifact");
  assert.equal(mesStub?.kind, "external");
  assert.ok(response.highlightTargetIds.includes("sym:group:data"));
  assert.ok(response.changedTargetIds.includes("sym:group:data"));
  assert.ok(response.changedViewIds.includes("view:root"));
});

test("applyReferenceRefactorPlan keeps unsupported structural changes as review-only hints", () => {
  const graph = buildGraph();
  const plan: UmlReferenceRefactorPlan = {
    summary: "Split the current group into multiple layers.",
    actions: [
      {
        id: "split-group",
        type: "split_group",
        targetIds: ["sym:group:data"],
        viewId: "view:root",
        payload: { target: "Datenquellen" },
        confidence: 0.61,
        severity: "high",
        autoApplicable: true,
      },
    ],
    primaryFocusTargetIds: ["sym:group:data"],
    changedViewIds: ["view:root"],
    remainingReviewOnlyItems: [],
  };
  const validation: UmlReferenceRefactorValidation = {
    summary: "Structural split must stay review-only.",
    decisions: [
      {
        actionId: "split-group",
        decision: "review_only",
        reason: "Split group is not deterministic enough for auto-apply.",
      },
    ],
  };

  const response = applyReferenceRefactorPlan({
    graph,
    viewId: "view:root",
    compare: buildCompare(),
    plan,
    validation,
    options: {
      autoApply: true,
      allowStructuralChanges: true,
      allowLabelChanges: true,
      allowRelationChanges: true,
      persistSuggestions: true,
      dryRun: false,
    },
  });

  assert.equal(response.appliedActions.length, 0);
  assert.equal(response.reviewOnlyActions.length, 1);
  assert.equal(response.autoApplied, false);
  assert.equal(response.graph?.views[0]?.reviewHints?.[0]?.source, "uml_reference_compare");
});

test("applyReferenceRefactorPlan prefers a visible focus view over hidden legacy overviews", () => {
  const graph = buildGraph();
  const compare = buildCompare();
  const plan: UmlReferenceRefactorPlan = {
    summary: "Rename the visible data source group.",
    actions: [
      {
        id: "rename-visible-group",
        type: "rename_symbol",
        targetIds: ["sym:group:data"],
        viewId: "view:group:data",
        payload: { newLabel: "SQL-Datenquellen" },
        confidence: 0.9,
        severity: "medium",
        autoApplicable: true,
      },
    ],
    primaryFocusTargetIds: ["sym:group:data"],
    changedViewIds: ["view:hidden-overview", "view:group:data"],
    remainingReviewOnlyItems: [],
  };
  const validation: UmlReferenceRefactorValidation = {
    summary: "The rename is safe.",
    decisions: [
      {
        actionId: "rename-visible-group",
        decision: "apply",
        reason: "Deterministic rename.",
      },
    ],
  };

  const response = applyReferenceRefactorPlan({
    graph,
    viewId: "view:group:data",
    compare,
    plan,
    validation,
    options: {
      autoApply: true,
      allowStructuralChanges: true,
      allowLabelChanges: true,
      allowRelationChanges: true,
      persistSuggestions: true,
      dryRun: false,
    },
  });

  assert.equal(response.focusViewId, "view:group:data");
});
