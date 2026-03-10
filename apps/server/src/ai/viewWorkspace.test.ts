import test from "node:test";
import assert from "node:assert/strict";
import type {
  AiExternalContextReviewResponse,
  AiLabelImprovementResponse,
  AiStructureReviewResponse,
  AiViewWorkspaceRunRequest,
  ProjectGraph,
  UmlReferenceAutorefactorResponse,
} from "@dmpg/shared";
import { runViewWorkspaceSession, type ViewWorkspaceDependencies, type ViewWorkspaceRunEvent } from "./viewWorkspace.js";
import { AI_USE_CASES } from "./useCases.js";

function buildGraph(): ProjectGraph {
  return {
    rootViewId: "view:root",
    projectPath: "C:/tmp/dmpg-workspace",
    symbols: [
      { id: "grp:data", label: "Data Sources", kind: "group" },
      { id: "mod:etl", label: "ETL Pipeline", kind: "module", parentId: "grp:data" },
      { id: "ext:mes", label: "MES", kind: "external" },
    ],
    relations: [],
    views: [
      {
        id: "view:root",
        title: "Architecture Overview",
        scope: "root",
        nodeRefs: ["grp:data", "mod:etl"],
        edgeRefs: [],
      },
    ],
  };
}

function buildBaseDependencies(graph: ProjectGraph): ViewWorkspaceDependencies {
  return {
    reviewViewStructure: async () => {
      const view = graph.views[0]!;
      view.reviewHints = [{
        reviewId: "structure:1",
        type: "group_too_broad",
        severity: "medium",
        message: "Data Sources is too broad.",
        targetIds: ["grp:data"],
        source: "structure_review",
      }];

      const review: AiStructureReviewResponse = {
        viewId: "view:root",
        issues: view.reviewHints,
      };
      return {
        review,
        heuristics: {
          viewId: "view:root",
          nodeCount: 2,
          internalEdgeCount: 0,
          externalDependencyCount: 0,
          isolatedNodeCount: 2,
          isolatedNodeRatio: 1,
          edgeDensity: 0,
          layoutPattern: "unknown",
          sparse: true,
          reasons: ["Sparse"],
          applicableUseCases: [AI_USE_CASES.UML_STRUCTURE_REVIEW],
        },
      };
    },
    reviewExternalContextForView: async () => {
      const view = graph.views[0]!;
      view.contextSuggestions = [{
        reviewId: "context:1",
        label: "MES",
        relatedSymbolIds: ["mod:etl"],
        reason: "Expose the MES dependency.",
        confidence: 0.9,
        source: "external_context_review",
      }];
      const review: AiExternalContextReviewResponse = {
        viewId: "view:root",
        suggestedContextNodes: view.contextSuggestions,
      };
      return review;
    },
    improveLabelsForView: async () => {
      const view = graph.views[0]!;
      view.labelSuggestions = [{
        reviewId: "label:1",
        targetId: "grp:data",
        oldLabel: "Data Sources",
        newLabel: "Input Sources",
        reason: "Shorter and clearer.",
        confidence: 0.82,
        source: "label_improvement",
      }];
      const review: AiLabelImprovementResponse = {
        viewId: "view:root",
        improvements: view.labelSuggestions,
      };
      return review;
    },
    runReferenceDrivenUmlAutorefactor: async () => {
      throw new Error("reference step not expected");
    },
    persistGraph: () => {},
  };
}

test("runViewWorkspaceSession persists structure, context and label steps without reference image", async () => {
  const graph = buildGraph();
  const events: ViewWorkspaceRunEvent[] = [];
  const persisted: string[] = [];
  const deps = buildBaseDependencies(graph);
  deps.persistGraph = (nextGraph) => {
    persisted.push(nextGraph.views[0]?.id ?? "unknown");
  };

  const request: AiViewWorkspaceRunRequest = {
    viewId: "view:root",
    includeStructure: true,
    includeContext: true,
    includeLabels: true,
  };

  const result = await runViewWorkspaceSession({
    graph,
    request,
    emit: (event) => events.push(event),
  }, deps);

  assert.equal(result.viewId, "view:root");
  assert.deepEqual(result.targetIds.sort(), ["grp:data", "mod:etl"]);
  assert.equal(result.focusViewId, "view:root");
  assert.equal(persisted.length, 3);
  assert.deepEqual(events.map((event) => event.phase), [
    "workspace",
    "structure",
    "structure_review",
    "context",
    "external_context_review",
    "labels",
    "label_improvement",
    "done",
  ]);
});

test("runViewWorkspaceSession includes reference apply result and undo metadata", async () => {
  const graph = buildGraph();
  const events: ViewWorkspaceRunEvent[] = [];
  const deps = buildBaseDependencies(graph);
  deps.runReferenceDrivenUmlAutorefactor = async () => {
    graph.views[0]!.reviewSummary = {
      source: "uml_reference_compare",
      summary: "Reference is clearer.",
    };

    const response: UmlReferenceAutorefactorResponse = {
      compare: {
        summary: "Reference is clearer.",
        overallAssessment: {
          umlQualityDelta: "better_reference",
          mainProblem: "notation",
        },
        differences: [],
        migrationSuggestions: [],
        recommendedActions: [],
      },
      plan: {
        summary: "Apply package notation.",
        actions: [],
        primaryFocusTargetIds: ["grp:data"],
        changedViewIds: ["view:root"],
        remainingReviewOnlyItems: [],
      },
      validation: {
        summary: "Safe to apply.",
        decisions: [],
      },
      appliedActions: [{
        actionId: "set-package",
        type: "set_uml_type",
        targetIds: ["grp:data"],
        viewId: "view:root",
        reason: "Applied in test.",
      }],
      skippedActions: [],
      reviewOnlyActions: [],
      changedTargetIds: ["grp:data"],
      changedViewIds: ["view:root"],
      highlightTargetIds: ["grp:data"],
      primaryFocusTargetIds: ["grp:data"],
      focusViewId: "view:root",
      autoApplied: true,
      undoInfo: {
        snapshotId: "snap-1",
        applyRunId: "apply-1",
      },
      graph,
    };
    return response;
  };

  const request: AiViewWorkspaceRunRequest = {
    viewId: "view:root",
    includeStructure: false,
    includeContext: false,
    includeLabels: false,
    currentViewImage: {
      mimeType: "image/png",
      dataBase64: "AAA=",
    },
    referenceImage: {
      mimeType: "image/png",
      dataBase64: "BBB=",
    },
    options: {
      autoApply: true,
    },
  };

  const result = await runViewWorkspaceSession({
    graph,
    request,
    emit: (event) => events.push(event),
  }, deps);

  assert.equal(result.appliedCount, 1);
  assert.equal(result.reviewOnlyCount, 0);
  assert.equal(result.autoApplied, true);
  assert.equal(result.undoSnapshotId, "snap-1");
  assert.equal(result.applyRunId, "apply-1");

  const doneEvent = events.at(-1);
  assert.equal(doneEvent?.phase, "done");
  assert.equal(doneEvent?.undoSnapshotId, "snap-1");
  assert.equal(doneEvent?.autoApplied, true);
});

test("runViewWorkspaceSession surfaces review-only reference actions in the final result", async () => {
  const graph = buildGraph();
  const deps = buildBaseDependencies(graph);
  deps.runReferenceDrivenUmlAutorefactor = async () => ({
    compare: {
      summary: "Reference suggests a split.",
      overallAssessment: {
        umlQualityDelta: "better_reference",
        mainProblem: "layering",
      },
      differences: [],
      migrationSuggestions: [],
      recommendedActions: [],
    },
    plan: {
      summary: "Split the view manually.",
      actions: [],
      primaryFocusTargetIds: ["grp:data"],
      changedViewIds: ["view:root"],
      remainingReviewOnlyItems: [],
    },
    validation: {
      summary: "Manual review required.",
      decisions: [],
    },
    appliedActions: [],
    skippedActions: [],
    reviewOnlyActions: [{
      actionId: "split-group",
      type: "split_group",
      targetIds: ["grp:data"],
      viewId: "view:root",
      reason: "Needs manual review.",
    }],
    changedTargetIds: [],
    changedViewIds: ["view:root"],
    highlightTargetIds: ["grp:data"],
    primaryFocusTargetIds: ["grp:data"],
    focusViewId: "view:root",
    autoApplied: false,
    graph,
  });

  const events: ViewWorkspaceRunEvent[] = [];
  const result = await runViewWorkspaceSession({
    graph,
    request: {
      viewId: "view:root",
      includeStructure: false,
      includeContext: false,
      includeLabels: false,
      currentViewImage: {
        mimeType: "image/png",
        dataBase64: "AAA=",
      },
      referenceImage: {
        mimeType: "image/png",
        dataBase64: "BBB=",
      },
    },
    emit: (event) => events.push(event),
  }, deps);

  assert.equal(result.appliedCount, 0);
  assert.equal(result.reviewOnlyCount, 1);
  assert.equal(result.autoApplied, false);
  assert.equal(events.at(-1)?.reviewOnlyCount, 1);
});

test("runViewWorkspaceSession skips reference errors caused by missing vision capability", async () => {
  const graph = buildGraph();
  const deps = buildBaseDependencies(graph);
  deps.runReferenceDrivenUmlAutorefactor = async () => {
    throw new Error('Configured vision model "llama3" does not advertise the "vision" capability.');
  };

  const events: ViewWorkspaceRunEvent[] = [];
  const result = await runViewWorkspaceSession({
    graph,
    request: {
      viewId: "view:root",
      includeStructure: false,
      includeContext: false,
      includeLabels: false,
      currentViewImage: {
        mimeType: "image/png",
        dataBase64: "AAA=",
      },
      referenceImage: {
        mimeType: "image/png",
        dataBase64: "BBB=",
      },
    },
    emit: (event) => events.push(event),
  }, deps);

  assert.equal(result.appliedCount, 0);
  assert.equal(result.reviewOnlyCount, 0);
  assert.equal(result.autoApplied, false);
  assert.equal(events.some((event) => event.action === "skipped"), true);
  assert.equal(events.at(-1)?.phase, "done");
});
