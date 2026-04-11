import { expect, test } from "@playwright/test";
import { createSequenceGraph, installMockApiRoutes } from "./fixtures";

test("stage layer renders a structural class diagram before sequence drilldown", async ({ page }) => {
  const graph = createSequenceGraph();
  await installMockApiRoutes(page, graph);

  await page.goto("/");
  await expect(page.locator(".canvas-flow--sequence")).not.toBeVisible();
  await page.locator('[data-id="proc:pkg:transform"] .group-drilldown').click();

  await expect(page.locator(".canvas-flow--sequence")).not.toBeVisible();
  await expect(page.locator('[data-id="class:pipeline-controller"]')).toBeVisible();
  await expect(page.locator('[data-id="proc:stage-sequence-nav:transform"]')).toBeVisible();
  await expect(page.locator(".edge-inherits").first()).toBeVisible();
  await expect(page.locator(".edge-association").first()).toBeVisible();
  await expect(page.locator(".edge-composition").first()).toBeVisible();

  const controllerNode = page.locator('[data-id="class:pipeline-controller"]');
  await expect(controllerNode).toContainText("PipelineController");
  await expect(controllerNode).toContainText("repository : Repository");
  await expect(controllerNode).toContainText("builder : ScheduleBuilder");
  await expect(controllerNode).toContainText("run(payload: Payload) : JobResult");
});
