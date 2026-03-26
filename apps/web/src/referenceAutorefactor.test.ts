import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReferenceAutorefactorRequest,
  dataUrlToBase64,
  DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION,
  DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS,
  estimateBase64Bytes,
  normalizeReferenceImageMimeType,
} from "./referenceAutorefactor.js";

test("dataUrlToBase64 strips the data URL prefix", () => {
  assert.equal(dataUrlToBase64("data:image/png;base64,QUJDRA=="), "QUJDRA==");
});

test("estimateBase64Bytes approximates decoded payload size", () => {
  assert.equal(estimateBase64Bytes("QUJDRA=="), 4);
  assert.equal(estimateBase64Bytes("TWE="), 2);
});

test("normalizeReferenceImageMimeType accepts supported reference image types", () => {
  assert.equal(
    normalizeReferenceImageMimeType({ name: "reference.png", type: "image/png" } as Pick<File, "name" | "type">),
    "image/png",
  );
  assert.equal(
    normalizeReferenceImageMimeType({ name: "reference.jpeg", type: "" } as Pick<File, "name" | "type">),
    "image/jpeg",
  );
});

test("normalizeReferenceImageMimeType rejects unsupported reference image types", () => {
  assert.throws(
    () => normalizeReferenceImageMimeType({ name: "reference.svg", type: "image/svg+xml" } as Pick<File, "name" | "type">),
    /Reference image must be PNG, JPEG, WEBP, GIF or BMP/,
  );
});

test("buildReferenceAutorefactorRequest fills defaults for instruction and options", () => {
  const request = buildReferenceAutorefactorRequest({
    currentViewImage: { label: "current_view", mimeType: "image/png", dataBase64: "AAA=" },
    referenceImage: { label: "reference_view", mimeType: "image/png", dataBase64: "BBB=" },
    viewId: "view:root",
    options: {
      allowLabelChanges: false,
      autoApply: false,
    },
    graphContext: { title: "Overview" },
  });

  assert.equal(request.instruction, DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION);
  assert.equal(request.options?.autoApply, false);
  assert.equal(request.options?.allowLabelChanges, false);
  assert.equal(request.options?.allowStructuralChanges, DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS.allowStructuralChanges);
  assert.equal(request.options?.persistSuggestions, DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS.persistSuggestions);
  assert.deepEqual(request.graphContext, { title: "Overview" });
});
