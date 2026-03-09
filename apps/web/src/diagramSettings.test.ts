import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DIAGRAM_SETTINGS, sanitizeDiagramSettings } from "./diagramSettings.js";

test("diagram settings show artifacts by default", () => {
  assert.equal(DEFAULT_DIAGRAM_SETTINGS.showArtifacts, true);
});

test("sanitizeDiagramSettings accepts persisted artifact visibility", () => {
  const sanitized = sanitizeDiagramSettings({ showArtifacts: false });

  assert.equal(sanitized.showArtifacts, false);
});

test("sanitizeDiagramSettings falls back to the default when artifact visibility is invalid", () => {
  const sanitized = sanitizeDiagramSettings({ showArtifacts: "no" });

  assert.equal(sanitized.showArtifacts, true);
});
