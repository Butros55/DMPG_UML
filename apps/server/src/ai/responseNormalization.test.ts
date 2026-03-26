import test from "node:test";
import assert from "node:assert/strict";
import {
  AiExternalContextReviewResponseSchema,
  AiLabelImprovementResponseSchema,
  AiSymbolEnrichmentResponseSchema,
  DiagramImageReviewResponseSchema,
  SymbolDocSchema,
  UmlReferenceCompareResponseSchema,
} from "@dmpg/shared";
import {
  normalizeAiExternalContextReviewPayload,
  normalizeAiLabelImprovementPayload,
  normalizeAiSymbolEnrichmentPayload,
  normalizeDiagramImageReviewPayload,
  normalizeSymbolDocPayload,
  normalizeUmlReferenceComparePayload,
  parseStructuredResponse,
} from "./responseNormalization.js";

test("normalizeUmlReferenceComparePayload recovers non-canonical compare output", () => {
  const parsed = parseStructuredResponse(
    {
      summary: "The professor reference is clearly more UML-like.",
      overallAssessment: {
        umlQualityDelta: 1,
        mainProblem: "UI card style with missing UML symbols and insufficient layering",
      },
      differences: [
        "The current diagram uses UI cards instead of UML package notation.",
        {
          issue: "MES is missing as explicit context.",
          recommendation: "Add MES as an external context stub.",
          confidence: 0.84,
        },
      ],
      migrationSuggestions: [
        "Replace group cards with UML packages.",
        "Add MES as an external context stub.",
      ],
      recommendedActions: [
        "Fix notation first.",
        "Expose external context before refining edges.",
      ],
      graphSuggestions: {
        type: "node_type_change",
        message: "Convert the data source block to a package-oriented node type.",
      },
      isCurrentDiagramTooUiLike: "true",
    },
    UmlReferenceCompareResponseSchema,
    "uml_reference_compare",
    normalizeUmlReferenceComparePayload,
  );

  assert.equal(parsed.overallAssessment.umlQualityDelta, "better_reference");
  assert.equal(parsed.overallAssessment.mainProblem, "notation");
  assert.equal(parsed.differences.length, 2);
  assert.equal(parsed.differences[0]?.category, "notation");
  assert.equal(parsed.migrationSuggestions[0]?.type, "replace_group_with_package");
  assert.equal(parsed.migrationSuggestions[1]?.type, "add_context_stub");
  assert.equal(parsed.recommendedActions[0]?.priority, 1);
  assert.equal(parsed.graphSuggestions?.[0]?.type, "node_type_change");
  assert.equal(parsed.isCurrentDiagramTooUiLike, true);
});

test("normalizeDiagramImageReviewPayload recovers string findings and shape hints", () => {
  const parsed = parseStructuredResponse(
    {
      findings: [
        "The database is rendered as a plain box instead of a cylinder.",
        {
          problem: "MES is missing as surrounding context.",
          priority: "high",
        },
      ],
      recommendedShapes: [
        { target: "Orders DB", type: "database" },
      ],
    },
    DiagramImageReviewResponseSchema,
    "diagram_image_review",
    normalizeDiagramImageReviewPayload,
  );

  assert.equal(parsed.issues.length, 2);
  assert.equal(parsed.issues[0]?.type, "non_uml_shape");
  assert.equal(parsed.issues[1]?.type, "missing_context");
  assert.equal(parsed.recommendedNodeTypes?.[0]?.umlType, "database");
});

test("normalizeAiExternalContextReviewPayload resolves related symbol ids from labels", () => {
  const parsed = parseStructuredResponse(
    {
      suggestions: [
        "MES should appear as external context because it drives inbound manufacturing orders.",
      ],
    },
    AiExternalContextReviewResponseSchema,
    "AI external context review",
    (raw) =>
      normalizeAiExternalContextReviewPayload(raw, "view:root", [
        { id: "sym:mes", label: "MES" },
        { id: "sym:sap", label: "SAP" },
      ]),
  );

  assert.equal(parsed.suggestedContextNodes.length, 1);
  assert.deepEqual(parsed.suggestedContextNodes[0]?.relatedSymbolIds, ["sym:mes"]);
});

test("normalizeAiLabelImprovementPayload resolves target ids from string suggestions", () => {
  const parsed = parseStructuredResponse(
    {
      suggestions: [
        "data_pipeline/output/trainings_data/df_data.csv -> Training Data",
      ],
    },
    AiLabelImprovementResponseSchema,
    "AI label improvement",
    (raw) =>
      normalizeAiLabelImprovementPayload(raw, "view:root", [
        { id: "sym:file:1", label: "data_pipeline/output/trainings_data/df_data.csv" },
      ]),
  );

  assert.equal(parsed.improvements.length, 1);
  assert.equal(parsed.improvements[0]?.targetId, "sym:file:1");
  assert.equal(parsed.improvements[0]?.newLabel, "Training Data");
});

test("normalizeSymbolDocPayload and normalizeAiSymbolEnrichmentPayload recover alternate doc keys", () => {
  const doc = parseStructuredResponse(
    {
      description: "Loads and validates the input dataset for downstream processing.",
      parameters: ["path: str - source CSV path"],
      returns: ["dataset: DataFrame - validated rows"],
      effects: "Reads the CSV file; logs validation errors",
      calledFunctions: ["read_csv", "validate_rows"],
    },
    SymbolDocSchema,
    "AI summarize",
    normalizeSymbolDocPayload,
    { alwaysNormalize: true },
  );

  const enrichment = parseStructuredResponse(
    {
      overview: "Loads and validates the input dataset for downstream processing.",
      args: ["path: str - source CSV path"],
      result: ["dataset: DataFrame - validated rows"],
      confidence: "0.82",
    },
    AiSymbolEnrichmentResponseSchema,
    "AI symbol enrichment",
    (raw) => normalizeAiSymbolEnrichmentPayload(raw, "sym:loader"),
    { alwaysNormalize: true },
  );

  assert.equal(doc.summary, "Loads and validates the input dataset for downstream processing.");
  assert.equal(doc.inputs?.[0]?.name, "path");
  assert.equal(doc.outputs?.[0]?.name, "dataset");
  assert.deepEqual(doc.calls, ["read_csv", "validate_rows"]);
  assert.equal(enrichment.symbolId, "sym:loader");
  assert.equal(enrichment.inputs?.[0]?.type, "str");
  assert.equal(enrichment.confidence, 0.82);
});
