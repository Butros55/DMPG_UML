export const AI_TASK_TYPES = {
  GENERAL: "general",
  CODE_ANALYSIS: "code_analysis",
  DIAGRAM_REVIEW: "diagram_review",
  VISION_REVIEW: "vision_review",
  LABELING: "labeling",
  RELATION_VALIDATION: "relation_validation",
} as const;

export type AiTaskType = typeof AI_TASK_TYPES[keyof typeof AI_TASK_TYPES];

export const ALL_AI_TASK_TYPES: readonly AiTaskType[] = [
  AI_TASK_TYPES.GENERAL,
  AI_TASK_TYPES.CODE_ANALYSIS,
  AI_TASK_TYPES.DIAGRAM_REVIEW,
  AI_TASK_TYPES.VISION_REVIEW,
  AI_TASK_TYPES.LABELING,
  AI_TASK_TYPES.RELATION_VALIDATION,
];

export function normalizeAiTaskType(taskType?: AiTaskType): AiTaskType {
  return taskType ?? AI_TASK_TYPES.GENERAL;
}
