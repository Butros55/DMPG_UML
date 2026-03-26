import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DIAGRAM_SETTINGS, sanitizeDiagramSettings } from "./diagramSettings.js";

test("diagram settings use grouped artifact modes by default", () => {
  assert.equal(DEFAULT_DIAGRAM_SETTINGS.inputArtifactMode, "grouped");
  assert.equal(DEFAULT_DIAGRAM_SETTINGS.generatedArtifactMode, "grouped");
  assert.equal(DEFAULT_DIAGRAM_SETTINGS.autoLayout, true);
});

test("sanitizeDiagramSettings accepts persisted split artifact modes", () => {
  const sanitized = sanitizeDiagramSettings({
    inputArtifactMode: "hidden",
    generatedArtifactMode: "individual",
  });

  assert.equal(sanitized.inputArtifactMode, "hidden");
  assert.equal(sanitized.generatedArtifactMode, "individual");
});

test("sanitizeDiagramSettings clamps input artifact mode to on or off", () => {
  const sanitized = sanitizeDiagramSettings({ inputArtifactMode: "individual" });

  assert.equal(sanitized.inputArtifactMode, "grouped");
});

test("sanitizeDiagramSettings maps legacy showArtifacts=false to generated only", () => {
  const sanitized = sanitizeDiagramSettings({ showArtifacts: false });

  assert.equal(sanitized.inputArtifactMode, "grouped");
  assert.equal(sanitized.generatedArtifactMode, "hidden");
});

test("sanitizeDiagramSettings maps legacy artifactMode to generated only", () => {
  const sanitized = sanitizeDiagramSettings({ artifactMode: "individual" });

  assert.equal(sanitized.inputArtifactMode, "grouped");
  assert.equal(sanitized.generatedArtifactMode, "individual");
});

test("sanitizeDiagramSettings falls back to grouped when split artifact modes are invalid", () => {
  const sanitized = sanitizeDiagramSettings({
    inputArtifactMode: "nope",
    generatedArtifactMode: "bad",
  });

  assert.equal(sanitized.inputArtifactMode, "grouped");
  assert.equal(sanitized.generatedArtifactMode, "grouped");
});

test("sanitizeDiagramSettings keeps grouped fallback when split artifact modes are missing", () => {
  const sanitized = sanitizeDiagramSettings({ labels: "compact" });

  assert.equal(sanitized.inputArtifactMode, "grouped");
  assert.equal(sanitized.generatedArtifactMode, "grouped");
});
