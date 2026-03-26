import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkspaceCompletionHighlight, isAiDataEvent, isWorkspaceNavigationEvent, resolveEventRunKind } from "./aiWorkspaceEvents.js";

test("resolveEventRunKind prefers the event run kind over the fallback", () => {
  assert.equal(resolveEventRunKind({ runKind: "view_workspace", phase: "done" }, "project_analysis"), "view_workspace");
  assert.equal(resolveEventRunKind({ phase: "done" }, "project_analysis"), "project_analysis");
});

test("workspace saved events with a symbol id count as navigable data events", () => {
  const event = {
    runKind: "view_workspace" as const,
    phase: "label_improvement",
    action: "saved",
    symbolId: "sym:1",
  };

  assert.equal(isWorkspaceNavigationEvent(event, "view_workspace"), true);
  assert.equal(isAiDataEvent(event, "view_workspace"), true);
  assert.equal(isAiDataEvent(event, "project_analysis"), false);
});

test("workspace completion highlight keeps unique targets and a focus view", () => {
  const highlight = buildWorkspaceCompletionHighlight({
    runKind: "view_workspace",
    phase: "done",
    symbolId: "sym:1",
    targetIds: ["sym:1", "sym:2", "sym:1"],
    focusViewId: "view:detail",
  });

  assert.deepEqual(highlight, {
    nodeIds: ["sym:1", "sym:2"],
    primaryNodeId: "sym:1",
    viewId: "view:detail",
  });
});

test("relation label updates count as workspace data events", () => {
  const event = {
    runKind: "view_workspace" as const,
    phase: "relation_labels",
    action: "updated",
    relationId: "rel:1",
    relationLabel: "Load route table",
    source: "sym:1",
    target: "sym:2",
  };

  assert.equal(isAiDataEvent(event, "view_workspace"), true);
});
