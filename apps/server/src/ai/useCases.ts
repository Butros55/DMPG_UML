import { resolveAiConfig, type AiConfig } from "../env.js";
import { resolveModelForTask } from "./modelRouting.js";
import { AI_TASK_TYPES, type AiTaskType } from "./taskTypes.js";

export const AI_USE_CASES = {
  GENERAL_COMPLETION: "general_completion",
  SYMBOL_SUMMARY: "symbol_summary",
  BATCH_SYMBOL_SUMMARY: "batch_symbol_summary",
  LABEL_CLEANUP: "label_cleanup",
  DOCUMENTATION_GENERATION: "documentation_generation",
  RELATION_DISCOVERY: "relation_discovery",
  RELATION_VALIDATION: "relation_validation",
  DEAD_CODE_REVIEW: "dead_code_review",
  STRUCTURE_REVIEW: "structure_review",
  UML_SYMBOL_ENRICHMENT: "uml_symbol_enrichment",
  UML_RELATION_ENRICHMENT: "uml_relation_enrichment",
  UML_STRUCTURE_REVIEW: "uml_structure_review",
  UML_LABEL_IMPROVEMENT: "uml_label_improvement",
  UML_EXTERNAL_CONTEXT_REVIEW: "uml_external_context_review",
  UML_REFERENCE_COMPARE: "uml_reference_compare",
  UML_REFERENCE_REFACTOR_PLAN: "uml_reference_refactor_plan",
  UML_REFERENCE_REFACTOR_RELATION_VALIDATION: "uml_reference_refactor_relation_validation",
  UML_REFERENCE_REFACTOR_LABELING: "uml_reference_refactor_labeling",
  DIAGRAM_IMAGE_REVIEW: "diagram_image_review",
  DIAGRAM_IMAGE_COMPARE: "diagram_image_compare",
  DIAGRAM_IMAGE_TO_SUGGESTIONS: "diagram_image_to_suggestions",
  VISION_DIAGRAM_REVIEW: "vision_diagram_review",
} as const;

export type AiUseCase = typeof AI_USE_CASES[keyof typeof AI_USE_CASES];

interface AiUseCaseDefinition {
  taskType: AiTaskType;
  description: string;
}

export const AI_USE_CASE_DEFINITIONS: Readonly<Record<AiUseCase, AiUseCaseDefinition>> = {
  [AI_USE_CASES.GENERAL_COMPLETION]: {
    taskType: AI_TASK_TYPES.GENERAL,
    description: "Fallback for generic completions without a more specific AI task.",
  },
  [AI_USE_CASES.SYMBOL_SUMMARY]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    description: "Single-symbol summaries, signatures, parameters, outputs and side effects.",
  },
  [AI_USE_CASES.BATCH_SYMBOL_SUMMARY]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    description: "Batch symbol summaries and documentation enrichment.",
  },
  [AI_USE_CASES.LABEL_CLEANUP]: {
    taskType: AI_TASK_TYPES.LABELING,
    description: "Label cleanup for nodes, groups and view titles.",
  },
  [AI_USE_CASES.DOCUMENTATION_GENERATION]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    description: "Detailed code-aware documentation generation for graph symbols.",
  },
  [AI_USE_CASES.RELATION_DISCOVERY]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    description: "Infer candidate calls, reads, writes, instantiations and config usage from code.",
  },
  [AI_USE_CASES.RELATION_VALIDATION]: {
    taskType: AI_TASK_TYPES.RELATION_VALIDATION,
    description: "Validate inferred relation candidates before writing them into the graph.",
  },
  [AI_USE_CASES.DEAD_CODE_REVIEW]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    description: "Review potentially unused functions and methods for dead-code tagging.",
  },
  [AI_USE_CASES.STRUCTURE_REVIEW]: {
    taskType: AI_TASK_TYPES.DIAGRAM_REVIEW,
    description: "Review UML group structure, layering and readability.",
  },
  [AI_USE_CASES.UML_SYMBOL_ENRICHMENT]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    description: "Targeted UML symbol enrichment for missing summaries, parameters and returns.",
  },
  [AI_USE_CASES.UML_RELATION_ENRICHMENT]: {
    taskType: AI_TASK_TYPES.CODE_ANALYSIS,
    description: "Suggest missing UML relations for a focused view or graph slice.",
  },
  [AI_USE_CASES.UML_STRUCTURE_REVIEW]: {
    taskType: AI_TASK_TYPES.DIAGRAM_REVIEW,
    description: "Review view quality, grouping sharpness, layering and sparse UML structure.",
  },
  [AI_USE_CASES.UML_LABEL_IMPROVEMENT]: {
    taskType: AI_TASK_TYPES.LABELING,
    description: "Suggest better labels for views, groups and symbols without auto-applying them.",
  },
  [AI_USE_CASES.UML_EXTERNAL_CONTEXT_REVIEW]: {
    taskType: AI_TASK_TYPES.DIAGRAM_REVIEW,
    description: "Suggest missing external context nodes or aggregated dependencies for sparse views.",
  },
  [AI_USE_CASES.UML_REFERENCE_COMPARE]: {
    taskType: AI_TASK_TYPES.VISION_REVIEW,
    description: "Specialized current-vs-reference UML comparison for React Flow screenshots and professor/reference diagrams.",
  },
  [AI_USE_CASES.UML_REFERENCE_REFACTOR_PLAN]: {
    taskType: AI_TASK_TYPES.DIAGRAM_REVIEW,
    description: "Generate a machine-applicable UML refactor plan from compare results and graph context.",
  },
  [AI_USE_CASES.UML_REFERENCE_REFACTOR_RELATION_VALIDATION]: {
    taskType: AI_TASK_TYPES.RELATION_VALIDATION,
    description: "Validate relation and context mutations before auto-applying a reference-driven UML refactor.",
  },
  [AI_USE_CASES.UML_REFERENCE_REFACTOR_LABELING]: {
    taskType: AI_TASK_TYPES.LABELING,
    description: "Refine auto-generated naming changes during reference-driven UML refactors.",
  },
  [AI_USE_CASES.DIAGRAM_IMAGE_REVIEW]: {
    taskType: AI_TASK_TYPES.VISION_REVIEW,
    description: "Structured UML review of a diagram screenshot or exported diagram image.",
  },
  [AI_USE_CASES.DIAGRAM_IMAGE_COMPARE]: {
    taskType: AI_TASK_TYPES.VISION_REVIEW,
    description: "Structured visual comparison between a current diagram image and a reference diagram.",
  },
  [AI_USE_CASES.DIAGRAM_IMAGE_TO_SUGGESTIONS]: {
    taskType: AI_TASK_TYPES.VISION_REVIEW,
    description: "Generate structured UML improvement suggestions from diagram imagery.",
  },
  [AI_USE_CASES.VISION_DIAGRAM_REVIEW]: {
    taskType: AI_TASK_TYPES.VISION_REVIEW,
    description: "Legacy alias for multimodal review of screenshots, exported diagrams and draw.io imagery.",
  },
};

export const ALL_AI_USE_CASES = Object.values(AI_USE_CASES) as readonly AiUseCase[];

export function getTaskTypeForUseCase(useCase: AiUseCase): AiTaskType {
  return AI_USE_CASE_DEFINITIONS[useCase].taskType;
}

export function getActiveAiUseCaseRouting(aiConfig: AiConfig = resolveAiConfig()) {
  return ALL_AI_USE_CASES.map((useCase) => {
    const taskType = getTaskTypeForUseCase(useCase);
    const model = resolveModelForTask(taskType, aiConfig);

    return {
      useCase,
      taskType,
      description: AI_USE_CASE_DEFINITIONS[useCase].description,
      resolvedModel: model.model,
      source: model.source,
    };
  });
}
