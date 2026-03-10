import { resolveAiConfig, type AiConfig } from "../env.js";
import { ALL_AI_TASK_TYPES, AI_TASK_TYPES, type AiTaskType } from "./taskTypes.js";

export type AiResolvedModelSource =
  | "task_specific"
  | "default_task"
  | "fallback"
  | "global"
  | "global_default";

export interface ResolvedAiTaskModel {
  taskType: AiTaskType;
  model: string;
  source: AiResolvedModelSource;
  routingEnabled: boolean;
}

export interface AiRoutingEntry {
  taskType: AiTaskType;
  purpose: string;
  envVar: string;
}

export const AI_TASK_ROUTING_MAP: Readonly<Record<AiTaskType, AiRoutingEntry>> = {
  [AI_TASK_TYPES.GENERAL]: {
    taskType: AI_TASK_TYPES.GENERAL,
    purpose: "General-purpose AI tasks without a more specific category.",
    envVar: "AI_DEFAULT_TASK_MODEL",
  },
  [AI_TASK_TYPES.CODE_ANALYSIS]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    purpose: "Code structure analysis, signatures, docs, imports, calls and inferred relations.",
    envVar: "UML_CODE_ANALYSIS_MODEL",
  },
  [AI_TASK_TYPES.DIAGRAM_REVIEW]: {
    taskType: AI_TASK_TYPES.DIAGRAM_REVIEW,
    purpose: "UML and diagram structure review, grouping, layering and readability critique.",
    envVar: "UML_DIAGRAM_REVIEW_MODEL",
  },
  [AI_TASK_TYPES.VISION_REVIEW]: {
    taskType: AI_TASK_TYPES.VISION_REVIEW,
    purpose: "Visual review for screenshots, exported diagrams and draw.io-like imagery.",
    envVar: "UML_VISION_REVIEW_MODEL",
  },
  [AI_TASK_TYPES.LABELING]: {
    taskType: AI_TASK_TYPES.LABELING,
    purpose: "Label, title and note suggestions for nodes, groups and other diagram text.",
    envVar: "UML_LABELING_MODEL",
  },
  [AI_TASK_TYPES.RELATION_VALIDATION]: {
    taskType: AI_TASK_TYPES.RELATION_VALIDATION,
    purpose: "Plausibility checks for proposed or inferred relations.",
    envVar: "UML_RELATION_VALIDATION_MODEL",
  },
};

export function resolveModelForTask(
  taskType: AiTaskType,
  aiConfig: AiConfig = resolveAiConfig(),
): ResolvedAiTaskModel {
  const globalSource: AiResolvedModelSource = aiConfig.modelSource === "default" ? "global_default" : "global";

  if (aiConfig.provider === "local" || !aiConfig.routing.enabled) {
    return {
      taskType,
      model: aiConfig.model,
      source: globalSource,
      routingEnabled: aiConfig.routing.enabled,
    };
  }

  const taskSpecificModel = aiConfig.routing.taskModels[taskType];
  if (taskSpecificModel) {
    return {
      taskType,
      model: taskSpecificModel,
      source: "task_specific",
      routingEnabled: true,
    };
  }

  if (taskType === AI_TASK_TYPES.GENERAL && aiConfig.routing.defaultTaskModel) {
    return {
      taskType,
      model: aiConfig.routing.defaultTaskModel,
      source: "default_task",
      routingEnabled: true,
    };
  }

  if (aiConfig.routing.fallbackModel) {
    return {
      taskType,
      model: aiConfig.routing.fallbackModel,
      source: "fallback",
      routingEnabled: true,
    };
  }

  return {
    taskType,
    model: aiConfig.model,
    source: globalSource,
    routingEnabled: true,
  };
}

export function getActiveAiModelConfig(aiConfig: AiConfig = resolveAiConfig()) {
  return {
    provider: aiConfig.provider,
    baseUrl: aiConfig.baseUrl,
    globalModel: aiConfig.model,
    globalModelSource: aiConfig.modelSource,
    routingEnabled: aiConfig.routing.enabled,
    fallbackModel: aiConfig.routing.fallbackModel ?? null,
    defaultTaskModel: aiConfig.routing.defaultTaskModel ?? null,
    tasks: ALL_AI_TASK_TYPES.map((taskType) => {
      const resolution = resolveModelForTask(taskType, aiConfig);
      return {
        taskType,
        envVar: AI_TASK_ROUTING_MAP[taskType].envVar,
        purpose: AI_TASK_ROUTING_MAP[taskType].purpose,
        resolvedModel: resolution.model,
        source: resolution.source,
        configuredModel: taskType === AI_TASK_TYPES.GENERAL
          ? (aiConfig.routing.defaultTaskModel ?? null)
          : (aiConfig.routing.taskModels[taskType] ?? null),
      };
    }),
  };
}

export function formatAiModelRoutingSummary(aiConfig: AiConfig = resolveAiConfig()): string {
  const mode = aiConfig.routing.enabled ? "enabled" : "disabled";
  return `provider=${aiConfig.provider} routing=${mode} globalModel=${aiConfig.model || "(not set)"}`;
}
