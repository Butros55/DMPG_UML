import { expect, test } from "@playwright/test";
import { createSequenceGraph, installMockApiRoutes } from "./fixtures";

// Desired app-side hooks for durable selectors:
// - data-testid="sequence-participant-hover-card"
// - data-testid="sequence-message-hover-card"
// - data-testid="sequence-message-inspector"
// - data-testid="sequence-edge-label"

test.describe("sequence native hover and inspector", () => {
  test.beforeEach(async ({ page }) => {
    const graph = createSequenceGraph();
    await installMockApiRoutes(page, graph);
    await page.goto("/");
    await expect(page.locator(".canvas-flow--sequence")).toBeVisible();
    await expect(page.locator('[data-id="participant:digital-zwilling"]')).toBeVisible();
    await expect(page.locator('.sequence-edge-label[data-edge-id="rel:generate-sim-data"]')).toBeVisible();
  });

  test("sequence participant hover shows sequence panel", async ({ page }) => {
    const participant = page.locator('[data-id="participant:digital-zwilling"]');
    await participant.hover();

    const hoverCard = page.locator('[data-testid="sequence-participant-hover-card"], .symbol-hover-card');
    await expect(hoverCard).toBeVisible();
    await expect(hoverCard).toContainText("Participant");
    await expect(hoverCard).toContainText("Role");
    await expect(hoverCard).toContainText("Lane");
    await expect(hoverCard).toContainText("Messages");
    await expect(hoverCard).toContainText("Digitaler Zwilling");
  });

  test("sequence message hover shows message panel", async ({ page }) => {
    const message = page.locator('.sequence-edge-label[data-edge-id="rel:generate-sim-data"]');
    await message.hover();

    const hoverCard = page.locator('[data-testid="sequence-message-hover-card"], .symbol-hover-card');
    await expect(hoverCard).toBeVisible();
    await expect(hoverCard).toContainText("Message");
    await expect(hoverCard).toContainText("#1");
    await expect(hoverCard).toContainText("calls");
    await expect(hoverCard).toContainText("Digitaler Zwilling");
    await expect(hoverCard).toContainText("Apache Druid");
  });

  test("inspector shows message details when edge selected", async ({ page }) => {
    const message = page.locator('.sequence-edge-label[data-edge-id="rel:generate-sim-data"]');
    await message.click();

    const inspector = page.locator('[data-testid="sequence-message-inspector"], .inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("Sequence Message");
    await expect(inspector).toContainText("relationIds");
    await expect(inspector).toContainText("Evidence");
    await expect(inspector).toContainText("Open in IDE");
    await expect(inspector).toContainText("Digitaler Zwilling");
    await expect(inspector).toContainText("Apache Druid");
  });
});
