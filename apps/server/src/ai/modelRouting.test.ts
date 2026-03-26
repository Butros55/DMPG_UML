import test from "node:test";
import assert from "node:assert/strict";
import { resolveAiConfig } from "../env.js";
import { getActiveAiModelConfig, resolveModelForTask } from "./modelRouting.js";
import { runWithAiRequestOverrides } from "./requestContext.js";
import { AI_TASK_TYPES } from "./taskTypes.js";

test("resolveAiConfig respects provider-specific model precedence and normalizes URLs", () => {
  const aiConfig = resolveAiConfig({
    AI_PROVIDER: "local",
    OLLAMA_BASE_URL: "https://ollama.example.com/api/",
    OLLAMA_LOCAL_URL: "http://127.0.0.1:11434/",
    OLLAMA_MODEL: "shared-model",
    OLLAMA_LOCAL_MODEL: "local-model",
  });

  assert.equal(aiConfig.provider, "local");
  assert.equal(aiConfig.baseUrl, "http://127.0.0.1:11434");
  assert.equal(aiConfig.model, "local-model");
  assert.equal(aiConfig.modelSource, "ollama_local_model");
});

test("resolveModelForTask uses specialized, default-task and fallback models when routing is enabled", () => {
  const aiConfig = resolveAiConfig({
    AI_MODEL_ROUTING_ENABLED: "true",
    OLLAMA_MODEL: "global-model",
    UML_FALLBACK_MODEL: "fallback-model",
    AI_DEFAULT_TASK_MODEL: "general-model",
    UML_CODE_ANALYSIS_MODEL: "code-model",
    UML_DIAGRAM_REVIEW_MODEL: "",
  });

  const codeModel = resolveModelForTask(AI_TASK_TYPES.CODE_ANALYSIS, aiConfig);
  const generalModel = resolveModelForTask(AI_TASK_TYPES.GENERAL, aiConfig);
  const diagramModel = resolveModelForTask(AI_TASK_TYPES.DIAGRAM_REVIEW, aiConfig);

  assert.equal(codeModel.model, "code-model");
  assert.equal(codeModel.source, "task_specific");
  assert.equal(generalModel.model, "general-model");
  assert.equal(generalModel.source, "default_task");
  assert.equal(diagramModel.model, "fallback-model");
  assert.equal(diagramModel.source, "fallback");
});

test("resolveModelForTask uses the local provider model for every task when AI_PROVIDER=local", () => {
  const aiConfig = resolveAiConfig({
    AI_PROVIDER: "local",
    AI_MODEL_ROUTING_ENABLED: "true",
    OLLAMA_MODEL: "shared-model",
    OLLAMA_LOCAL_MODEL: "local-model",
    UML_FALLBACK_MODEL: "fallback-model",
    AI_DEFAULT_TASK_MODEL: "general-model",
    UML_CODE_ANALYSIS_MODEL: "code-model",
    UML_LABELING_MODEL: "label-model",
  });

  const codeModel = resolveModelForTask(AI_TASK_TYPES.CODE_ANALYSIS, aiConfig);
  const generalModel = resolveModelForTask(AI_TASK_TYPES.GENERAL, aiConfig);
  const labelingModel = resolveModelForTask(AI_TASK_TYPES.LABELING, aiConfig);

  assert.equal(codeModel.model, "local-model");
  assert.equal(codeModel.source, "global");
  assert.equal(codeModel.routingEnabled, true);
  assert.equal(generalModel.model, "local-model");
  assert.equal(generalModel.source, "global");
  assert.equal(labelingModel.model, "local-model");
  assert.equal(labelingModel.source, "global");
});

test("resolveAiConfig ignores OLLAMA_MODEL in local mode when no local model is selected", () => {
  const aiConfig = resolveAiConfig({
    AI_PROVIDER: "local",
    OLLAMA_MODEL: "shared-model",
  });

  assert.equal(aiConfig.model, "");
  assert.equal(aiConfig.modelSource, "default");
});

test("resolveAiConfig prefers the request-scoped local model override", () => {
  const aiConfig = runWithAiRequestOverrides(
    { localModel: "qwen2.5-coder:14b" },
    () => resolveAiConfig({
      AI_PROVIDER: "local",
      OLLAMA_LOCAL_MODEL: "legacy-local-model",
    }),
  );

  assert.equal(aiConfig.model, "qwen2.5-coder:14b");
  assert.equal(aiConfig.modelSource, "request_local_override");
});

test("resolveModelForTask keeps legacy single-model behavior when routing is disabled", () => {
  const aiConfig = resolveAiConfig({
    AI_MODEL_ROUTING_ENABLED: "false",
    OLLAMA_MODEL: "global-model",
    UML_CODE_ANALYSIS_MODEL: "code-model",
  });

  const codeModel = resolveModelForTask(AI_TASK_TYPES.CODE_ANALYSIS, aiConfig);
  const labelingModel = resolveModelForTask(AI_TASK_TYPES.LABELING, aiConfig);

  assert.equal(codeModel.model, "global-model");
  assert.equal(codeModel.source, "global");
  assert.equal(labelingModel.model, "global-model");
  assert.equal(labelingModel.source, "global");
});

test("resolveModelForTask falls back to the built-in default when no env model is configured", () => {
  const aiConfig = resolveAiConfig({
    AI_MODEL_ROUTING_ENABLED: "true",
  });

  const relationModel = resolveModelForTask(AI_TASK_TYPES.RELATION_VALIDATION, aiConfig);

  assert.equal(relationModel.model, "llama3.1:8b");
  assert.equal(relationModel.source, "global_default");
});

test("getActiveAiModelConfig summarizes the resolved task configuration", () => {
  const aiConfig = resolveAiConfig({
    AI_MODEL_ROUTING_ENABLED: "true",
    OLLAMA_MODEL: "global-model",
    UML_FALLBACK_MODEL: "fallback-model",
    UML_LABELING_MODEL: "label-model",
  });

  const summary = getActiveAiModelConfig(aiConfig);
  const labelingEntry = summary.tasks.find((task) => task.taskType === AI_TASK_TYPES.LABELING);
  const visionEntry = summary.tasks.find((task) => task.taskType === AI_TASK_TYPES.VISION_REVIEW);

  assert.equal(summary.routingEnabled, true);
  assert.equal(labelingEntry?.resolvedModel, "label-model");
  assert.equal(labelingEntry?.source, "task_specific");
  assert.equal(visionEntry?.resolvedModel, "fallback-model");
  assert.equal(visionEntry?.source, "fallback");
});

test("getActiveAiModelConfig resolves every task to the local model when AI_PROVIDER=local", () => {
  const aiConfig = resolveAiConfig({
    AI_PROVIDER: "local",
    AI_MODEL_ROUTING_ENABLED: "true",
    OLLAMA_LOCAL_MODEL: "local-model",
    UML_FALLBACK_MODEL: "fallback-model",
    UML_LABELING_MODEL: "label-model",
  });

  const summary = getActiveAiModelConfig(aiConfig);

  assert.equal(summary.globalModel, "local-model");
  assert.equal(summary.routingEnabled, true);
  assert.ok(summary.tasks.every((task) => task.resolvedModel === "local-model"));
  assert.ok(summary.tasks.every((task) => task.source === "global"));
});
