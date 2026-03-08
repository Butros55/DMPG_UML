import test from "node:test";
import assert from "node:assert/strict";
import { resolveAiConfig } from "../env.js";
import { AI_TASK_TYPES, normalizeAiTaskType } from "./taskTypes.js";
import { AI_USE_CASES, getActiveAiUseCaseRouting, getTaskTypeForUseCase } from "./useCases.js";

test("normalizeAiTaskType falls back to general when no task is provided", () => {
  assert.equal(normalizeAiTaskType(), AI_TASK_TYPES.GENERAL);
  assert.equal(normalizeAiTaskType(AI_TASK_TYPES.LABELING), AI_TASK_TYPES.LABELING);
});

test("AI use cases map to the intended task types", () => {
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.SYMBOL_SUMMARY), AI_TASK_TYPES.CODE_ANALYSIS);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.BATCH_SYMBOL_SUMMARY), AI_TASK_TYPES.CODE_ANALYSIS);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.LABEL_CLEANUP), AI_TASK_TYPES.LABELING);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.DOCUMENTATION_GENERATION), AI_TASK_TYPES.CODE_ANALYSIS);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.RELATION_DISCOVERY), AI_TASK_TYPES.CODE_ANALYSIS);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.RELATION_VALIDATION), AI_TASK_TYPES.RELATION_VALIDATION);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.DEAD_CODE_REVIEW), AI_TASK_TYPES.CODE_ANALYSIS);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.STRUCTURE_REVIEW), AI_TASK_TYPES.DIAGRAM_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_SYMBOL_ENRICHMENT), AI_TASK_TYPES.CODE_ANALYSIS);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_RELATION_ENRICHMENT), AI_TASK_TYPES.CODE_ANALYSIS);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_STRUCTURE_REVIEW), AI_TASK_TYPES.DIAGRAM_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_LABEL_IMPROVEMENT), AI_TASK_TYPES.LABELING);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_EXTERNAL_CONTEXT_REVIEW), AI_TASK_TYPES.DIAGRAM_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_COMPARE), AI_TASK_TYPES.VISION_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_REFACTOR_PLAN), AI_TASK_TYPES.DIAGRAM_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_REFACTOR_LABELING), AI_TASK_TYPES.LABELING);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_REFACTOR_RELATION_VALIDATION), AI_TASK_TYPES.RELATION_VALIDATION);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.DIAGRAM_IMAGE_REVIEW), AI_TASK_TYPES.VISION_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.DIAGRAM_IMAGE_COMPARE), AI_TASK_TYPES.VISION_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.DIAGRAM_IMAGE_TO_SUGGESTIONS), AI_TASK_TYPES.VISION_REVIEW);
  assert.equal(getTaskTypeForUseCase(AI_USE_CASES.VISION_DIAGRAM_REVIEW), AI_TASK_TYPES.VISION_REVIEW);
});

test("getActiveAiUseCaseRouting resolves models through the shared task router", () => {
  const aiConfig = resolveAiConfig({
    AI_MODEL_ROUTING_ENABLED: "true",
    OLLAMA_MODEL: "global-model",
    UML_FALLBACK_MODEL: "fallback-model",
    UML_RELATION_VALIDATION_MODEL: "validator-model",
  });

  const relationValidation = getActiveAiUseCaseRouting(aiConfig).find(
    (entry) => entry.useCase === AI_USE_CASES.RELATION_VALIDATION,
  );
  const visionReview = getActiveAiUseCaseRouting(aiConfig).find(
    (entry) => entry.useCase === AI_USE_CASES.VISION_DIAGRAM_REVIEW,
  );

  assert.equal(relationValidation?.taskType, AI_TASK_TYPES.RELATION_VALIDATION);
  assert.equal(relationValidation?.resolvedModel, "validator-model");
  assert.equal(relationValidation?.source, "task_specific");
  assert.equal(visionReview?.taskType, AI_TASK_TYPES.VISION_REVIEW);
  assert.equal(visionReview?.resolvedModel, "fallback-model");
  assert.equal(visionReview?.source, "fallback");
});
