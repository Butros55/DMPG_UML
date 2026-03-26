import type {
  AiVisionImageInput,
  DiagramImageCompareResponse,
  DiagramImageReviewResponse,
  DiagramImageSuggestionsResponse,
  ProjectGraph,
  UmlReferenceCompareResponse,
  ViewReviewIssue,
} from "@dmpg/shared";
import {
  DiagramImageCompareResponseSchema,
  DiagramImageReviewResponseSchema,
  DiagramImageSuggestionsResponseSchema,
  UmlReferenceCompareResponseSchema,
} from "@dmpg/shared";
import type { ResolvedAiTaskModel } from "./modelRouting.js";
import { callAiVisionJson } from "./client.js";
import { buildViewHeuristics } from "./umlReview.js";
import {
  normalizeDiagramImageComparePayload,
  normalizeDiagramImageReviewPayload,
  normalizeDiagramImageSuggestionsPayload,
  normalizeUmlReferenceComparePayload,
  parseStructuredResponse,
} from "./responseNormalization.js";
import { AI_USE_CASES, getTaskTypeForUseCase } from "./useCases.js";

export interface VisionCallContext {
  instruction?: string;
  viewId?: string;
  graph?: ProjectGraph | null;
  graphContext?: unknown;
}

interface VisionCallResult<T> {
  result: T;
  model: ResolvedAiTaskModel;
}

type UmlCompareGraphSuggestion = NonNullable<UmlReferenceCompareResponse["graphSuggestions"]>[number];

const DIAGRAM_IMAGE_REVIEW_FORMAT = {
  type: "object",
  properties: {
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["missing_relations", "weak_grouping", "non_uml_shape", "too_sparse", "too_dense", "missing_context", "naming_unclear"],
          },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          message: { type: "string" },
          suggestion: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["type", "severity", "message"],
      },
    },
    recommendedNodeTypes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          targetLabel: { type: "string" },
          umlType: { type: "string", enum: ["package", "database", "artifact", "component", "note"] },
        },
        required: ["targetLabel", "umlType"],
      },
    },
  },
  required: ["summary", "issues"],
} as const satisfies Record<string, unknown>;

const DIAGRAM_IMAGE_COMPARE_FORMAT = {
  type: "object",
  properties: {
    summary: { type: "string" },
    differences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["notation", "layout", "grouping", "missing_element", "relation_visibility"] },
          message: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["category", "message"],
      },
    },
  },
  required: ["summary", "differences"],
} as const satisfies Record<string, unknown>;

const DIAGRAM_IMAGE_SUGGESTIONS_FORMAT = {
  type: "object",
  properties: {
    summary: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["add_context_stub", "change_group_type", "promote_to_package", "use_database_shape", "split_view", "aggregate_relations"],
          },
          target: { type: "string" },
          message: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["type", "message"],
      },
    },
  },
  required: ["summary", "suggestions"],
} as const satisfies Record<string, unknown>;

const UML_REFERENCE_COMPARE_FORMAT = {
  type: "object",
  properties: {
    summary: { type: "string" },
    overallAssessment: {
      type: "object",
      properties: {
        umlQualityDelta: { type: "string", enum: ["better_reference", "roughly_equal", "better_current"] },
        mainProblem: { type: "string", enum: ["notation", "grouping", "relations", "context", "layering", "naming"] },
      },
      required: ["umlQualityDelta", "mainProblem"],
    },
    differences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["notation", "layout", "grouping", "missing_element", "relation_visibility", "context", "layering", "naming"],
          },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          message: { type: "string" },
          suggestion: { type: "string" },
          target: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["category", "severity", "message", "suggestion", "confidence"],
      },
    },
    migrationSuggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "replace_group_with_package",
              "use_database_shape",
              "add_context_stub",
              "split_view",
              "aggregate_relations",
              "rename_group",
              "add_note",
              "promote_artifact_shape",
            ],
          },
          target: { type: "string" },
          message: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["type", "message", "confidence"],
      },
    },
    recommendedActions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "integer" },
          action: { type: "string" },
        },
        required: ["priority", "action"],
      },
    },
    graphSuggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["view_refactor", "node_type_change", "context_stub_addition", "relation_aggregation"] },
          targetIds: { type: "array", items: { type: "string" } },
          message: { type: "string" },
        },
        required: ["type", "message"],
      },
    },
    isCurrentDiagramTooUiLike: { type: "boolean" },
  },
  required: ["summary", "overallAssessment", "differences", "migrationSuggestions", "recommendedActions"],
} as const satisfies Record<string, unknown>;

function buildImagePrompt(images: AiVisionImageInput[]): string {
  return images
    .map((image, index) => `${index + 1}. ${image.label ?? `image_${index + 1}`} (${image.mimeType})`)
    .join("\n");
}

function findView(graph: ProjectGraph, viewId: string) {
  return graph.views.find((candidate) => candidate.id === viewId) ?? null;
}

function buildGraphContextBlock(context: VisionCallContext): string {
  const blocks: string[] = [];

  if (context.graphContext) {
    blocks.push(`Caller-provided context:\n${JSON.stringify(context.graphContext, null, 2)}`);
  }

  if (!context.viewId || !context.graph) {
    return blocks.length > 0 ? `\n${blocks.join("\n\n")}` : "";
  }

  const view = findView(context.graph, context.viewId);
  if (!view) {
    return blocks.length > 0 ? `\n${blocks.join("\n\n")}` : "";
  }

  const heuristics = buildViewHeuristics(context.graph, context.viewId);
  const nodes = context.graph.symbols
    .filter((symbol) => view.nodeRefs.includes(symbol.id))
    .map((symbol) => ({ id: symbol.id, label: symbol.label, kind: symbol.kind, parentId: symbol.parentId ?? null }))
    .slice(0, 30);
  const edges = context.graph.relations
    .filter((relation) => view.nodeRefs.includes(relation.source) && view.nodeRefs.includes(relation.target))
    .map((relation) => ({ source: relation.source, target: relation.target, type: relation.type, label: relation.label ?? null }))
    .slice(0, 30);

  blocks.push(`Graph/View context:
${JSON.stringify({
    viewId: view.id,
    viewTitle: view.title,
    scope: view.scope ?? "unknown",
    heuristics,
    nodes,
    edges,
  }, null, 2)}`);

  return `\n${blocks.join("\n\n")}`;
}

function slugifyReviewPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function resolveTargetIdsInView(graph: ProjectGraph, viewId: string, target?: string): string[] {
  if (!target) return [];
  const view = findView(graph, viewId);
  if (!view) return [];

  const normalized = target.trim().toLowerCase();
  if (!normalized) return [];

  return graph.symbols
    .filter((symbol) => view.nodeRefs.includes(symbol.id))
    .filter((symbol) => {
      const label = symbol.label.toLowerCase();
      const shortLabel = symbol.label.split(".").pop()?.toLowerCase() ?? label;
      return (
        label === normalized ||
        shortLabel === normalized ||
        label.includes(normalized) ||
        normalized.includes(shortLabel)
      );
    })
    .slice(0, 6)
    .map((symbol) => symbol.id);
}

function normalizeRecommendedActions(actions: UmlReferenceCompareResponse["recommendedActions"]) {
  const deduped = new Map<string, { priority: number; action: string }>();
  for (const action of actions) {
    const key = action.action.trim().toLowerCase();
    if (!key) continue;
    const existing = deduped.get(key);
    if (!existing || action.priority < existing.priority) {
      deduped.set(key, action);
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => left.priority - right.priority)
    .slice(0, 6)
    .map((action, index) => ({ priority: index + 1, action: action.action.trim() }));
}

function deriveGraphSuggestions(
  response: UmlReferenceCompareResponse,
  context: VisionCallContext,
): UmlReferenceCompareResponse["graphSuggestions"] {
  if (!context.graph || !context.viewId) {
    return response.graphSuggestions;
  }

  const existing = response.graphSuggestions ?? [];
  const derived = [
    ...response.migrationSuggestions.map((suggestion) => {
      switch (suggestion.type) {
        case "add_context_stub":
          return {
            type: "context_stub_addition" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, suggestion.target),
            message: suggestion.message,
          };
        case "aggregate_relations":
          return {
            type: "relation_aggregation" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, suggestion.target),
            message: suggestion.message,
          };
        case "split_view":
          return {
            type: "view_refactor" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, suggestion.target),
            message: suggestion.message,
          };
        case "replace_group_with_package":
        case "use_database_shape":
        case "promote_artifact_shape":
          return {
            type: "node_type_change" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, suggestion.target),
            message: suggestion.message,
          };
        default:
          return null;
      }
    }).filter((value): value is NonNullable<typeof value> => value !== null),
    ...response.differences.map((difference) => {
      switch (difference.category) {
        case "context":
        case "missing_element":
          return {
            type: "context_stub_addition" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, difference.target),
            message: difference.suggestion,
          };
        case "relation_visibility":
          return {
            type: "relation_aggregation" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, difference.target),
            message: difference.suggestion,
          };
        case "grouping":
        case "layering":
        case "layout":
          return {
            type: "view_refactor" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, difference.target),
            message: difference.suggestion,
          };
        case "notation":
          return {
            type: "node_type_change" as const,
            targetIds: resolveTargetIdsInView(context.graph!, context.viewId!, difference.target),
            message: difference.suggestion,
          };
        default:
          return null;
      }
    }).filter((value): value is NonNullable<typeof value> => value !== null),
  ];

  const deduped = new Map<string, UmlCompareGraphSuggestion>();
  for (const suggestion of [...existing, ...derived]) {
    const key = `${suggestion.type}|${suggestion.message.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, suggestion);
    }
  }

  const normalized = Array.from(deduped.values())
    .map((suggestion) => ({
      ...suggestion,
      targetIds: suggestion.targetIds?.length ? suggestion.targetIds : undefined,
    }))
    .slice(0, 8);

  return normalized.length > 0 ? normalized : undefined;
}

function finalizeUmlReferenceCompareResponse(
  response: UmlReferenceCompareResponse,
  context: VisionCallContext,
): UmlReferenceCompareResponse {
  return {
    ...response,
    recommendedActions: normalizeRecommendedActions(response.recommendedActions),
    graphSuggestions: deriveGraphSuggestions(response, context),
  };
}

function compareDifferenceToReviewIssue(difference: UmlReferenceCompareResponse["differences"][number], targetIds: string[]): ViewReviewIssue {
  switch (difference.category) {
    case "context":
    case "missing_element":
      return {
        type: "missing_context",
        severity: difference.severity,
        title: "Missing context",
        message: difference.message,
        suggestedAction: difference.suggestion,
        source: "uml_reference_compare",
        category: difference.category,
        target: difference.target,
        confidence: difference.confidence,
        status: "new",
        targetIds: targetIds.length > 0 ? targetIds : undefined,
      };
    case "naming":
      return {
        type: "naming_unclear",
        severity: difference.severity,
        title: "Naming unclear",
        message: difference.message,
        suggestedAction: difference.suggestion,
        source: "uml_reference_compare",
        category: difference.category,
        target: difference.target,
        confidence: difference.confidence,
        status: "new",
        targetIds: targetIds.length > 0 ? targetIds : undefined,
      };
    case "grouping":
      return {
        type: "group_too_broad",
        severity: difference.severity,
        title: "Grouping mismatch",
        message: difference.message,
        suggestedAction: difference.suggestion,
        source: "uml_reference_compare",
        category: difference.category,
        target: difference.target,
        confidence: difference.confidence,
        status: "new",
        targetIds: targetIds.length > 0 ? targetIds : undefined,
      };
    case "relation_visibility":
      return {
        type: "external_dependency_overload",
        severity: difference.severity,
        title: "Relation visibility weak",
        message: difference.message,
        suggestedAction: difference.suggestion,
        source: "uml_reference_compare",
        category: difference.category,
        target: difference.target,
        confidence: difference.confidence,
        status: "new",
        targetIds: targetIds.length > 0 ? targetIds : undefined,
      };
    default:
      return {
        type: "layering_issue",
        severity: difference.severity,
        title: difference.category === "notation" ? "Notation mismatch" : "Layering mismatch",
        message: difference.message,
        suggestedAction: difference.suggestion,
        source: "uml_reference_compare",
        category: difference.category,
        target: difference.target,
        confidence: difference.confidence,
        status: "new",
        targetIds: targetIds.length > 0 ? targetIds : undefined,
      };
  }
}

export function persistUmlReferenceCompareReview(
  graph: ProjectGraph,
  viewId: string,
  response: UmlReferenceCompareResponse,
): ViewReviewIssue[] {
  const view = findView(graph, viewId);
  if (!view) {
    throw new Error(`View not found: ${viewId}`);
  }

  const createdAt = new Date().toISOString();
  const compareTargetIds = Array.from(new Set([
    ...(response.graphSuggestions?.flatMap((suggestion) => suggestion.targetIds ?? []) ?? []),
    ...response.differences.flatMap((difference) => resolveTargetIdsInView(graph, viewId, difference.target)),
  ]));
  const issues = response.differences.map((difference) =>
    ({
      ...compareDifferenceToReviewIssue(difference, resolveTargetIdsInView(graph, viewId, difference.target)),
      reviewId: `uml_reference_compare:${viewId}:difference:${slugifyReviewPart(difference.message)}`,
      createdAt,
    })
  );
  const deduped = new Map<string, ViewReviewIssue>();
  for (const issue of [...(view.reviewHints ?? []), ...issues]) {
    const key = `${issue.type}|${issue.message}`;
    if (!deduped.has(key)) {
      deduped.set(key, issue);
    }
  }

  view.reviewHints = Array.from(deduped.values());
  view.reviewActions = response.recommendedActions.map((action) => {
    const existing = view.reviewActions?.find((candidate) => candidate.action === action.action);
    return {
      id: existing?.id ?? `uml_reference_compare:${viewId}:action:${action.priority}:${slugifyReviewPart(action.action)}`,
      source: "uml_reference_compare",
      priority: action.priority,
      action: action.action,
      targetIds: existing?.targetIds ?? (compareTargetIds.length > 0 ? compareTargetIds : undefined),
      status: existing?.status ?? "new",
      createdAt: existing?.createdAt ?? createdAt,
    };
  });
  view.graphSuggestions = response.graphSuggestions?.map((suggestion, index) => {
    const existing = view.graphSuggestions?.find((candidate) =>
      candidate.type === suggestion.type &&
      candidate.message === suggestion.message,
    );
    return {
      id: existing?.id ?? `uml_reference_compare:${viewId}:graph:${suggestion.type}:${index}`,
      source: "uml_reference_compare",
      type: suggestion.type,
      targetIds: suggestion.targetIds,
      message: suggestion.message,
      status: existing?.status ?? "new",
      createdAt: existing?.createdAt ?? createdAt,
    };
  });
  view.reviewSummary = {
    source: "uml_reference_compare",
    summary: response.summary,
    umlQualityDelta: response.overallAssessment.umlQualityDelta,
    mainProblem: response.overallAssessment.mainProblem,
    isCurrentDiagramTooUiLike: response.isCurrentDiagramTooUiLike,
    createdAt,
  };
  return view.reviewHints;
}

export async function reviewDiagramImage(
  images: AiVisionImageInput[],
  context: VisionCallContext = {},
): Promise<VisionCallResult<DiagramImageReviewResponse>> {
  const { data, model } = await callAiVisionJson({
    endpointName: "diagram_image_review",
    taskType: getTaskTypeForUseCase(AI_USE_CASES.DIAGRAM_IMAGE_REVIEW),
    images,
    responseFormat: DIAGRAM_IMAGE_REVIEW_FORMAT,
    systemPrompt: `You are a UML diagram reviewer working from screenshots and diagram images.
Review the image for readability, UML quality, grouping, naming, context, and visible relation quality.
Return JSON only.`,
    userPrompt: `Review these diagram images for UML quality.
Images:
${buildImagePrompt(images)}
Instruction: ${context.instruction ?? "Review the diagram image for UML quality, missing context and naming clarity."}${buildGraphContextBlock(context)}`,
  });

  return {
    result: parseStructuredResponse(
      data,
      DiagramImageReviewResponseSchema,
      "diagram_image_review",
      normalizeDiagramImageReviewPayload,
    ),
    model,
  };
}

export async function compareDiagramImages(
  images: AiVisionImageInput[],
  context: VisionCallContext = {},
): Promise<VisionCallResult<DiagramImageCompareResponse>> {
  if (images.length !== 2) {
    throw new Error("diagram_image_compare requires exactly two images: current and reference.");
  }

  const { data, model } = await callAiVisionJson({
    endpointName: "diagram_image_compare",
    taskType: getTaskTypeForUseCase(AI_USE_CASES.DIAGRAM_IMAGE_COMPARE),
    images,
    responseFormat: DIAGRAM_IMAGE_COMPARE_FORMAT,
    systemPrompt: `You compare a current UML diagram image with a reference diagram image.
Focus on notation, layout, grouping, missing elements and relation visibility.
Return JSON only.`,
    userPrompt: `Compare the two diagram images.
Image 1 is the current diagram: ${images[0]?.label ?? "current_view"}
Image 2 is the reference diagram: ${images[1]?.label ?? "reference_view"}
Instruction: ${context.instruction ?? "Compare the current diagram to the reference and list meaningful UML differences."}${buildGraphContextBlock(context)}`,
  });

  return {
    result: parseStructuredResponse(
      data,
      DiagramImageCompareResponseSchema,
      "diagram_image_compare",
      normalizeDiagramImageComparePayload,
    ),
    model,
  };
}

export async function compareUmlReferenceImages(
  images: AiVisionImageInput[],
  context: VisionCallContext = {},
): Promise<VisionCallResult<UmlReferenceCompareResponse>> {
  if (images.length !== 2) {
    throw new Error("uml_reference_compare requires exactly two images: current and reference.");
  }

  const { data, model } = await callAiVisionJson({
    endpointName: "uml_reference_compare",
    taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_COMPARE),
    images,
    responseFormat: UML_REFERENCE_COMPARE_FORMAT,
    systemPrompt: `You are a strict UML and software architecture comparison reviewer.
Compare a CURRENT React Flow architecture screenshot with a REFERENCE professor/example/draw.io diagram.
Do not produce a generic image diff. Judge the diagrams as architecture communication artifacts.
Focus on:
1. Whether the current diagram looks like UI cards instead of scientific UML notation
2. Missing UML shapes such as package, database, artifact, component or note
3. Weak or unclear layering, especially missing Layer-1 process flow or overly flat grouping
4. Missing visible relations, missing external context stubs, and relation aggregation quality
5. Naming quality, semantic responsibility clarity, and whether groups should become packages
Return concrete, migration-oriented JSON only.
If graph/view context is given, align graphSuggestions to actual view refactors, node type changes, context stubs or relation aggregation.`,
    userPrompt: `Compare these two architecture images as IST vs SOLL UML diagrams.
Image 1 is the CURRENT React Flow view: ${images[0]?.label ?? "current_view"}
Image 2 is the REFERENCE diagram: ${images[1]?.label ?? "reference_view"}
Instruction: ${context.instruction ?? "Explain how to move the current diagram closer to the reference in UML quality, notation, layering, context and relation visibility."}

Return:
- summary
- overallAssessment with umlQualityDelta and mainProblem
- differences with severity, suggestion, target and confidence
- migrationSuggestions with concrete UML migration types
- recommendedActions in priority order
- graphSuggestions when view or graph context allows it
- isCurrentDiagramTooUiLike when the current diagram reads more like UI cards than UML${buildGraphContextBlock(context)}`,
  });

  const parsed = parseStructuredResponse(
    data,
    UmlReferenceCompareResponseSchema,
    "uml_reference_compare",
    normalizeUmlReferenceComparePayload,
  );

  return {
    result: finalizeUmlReferenceCompareResponse(parsed, context),
    model,
  };
}

export async function suggestDiagramImprovementsFromImages(
  images: AiVisionImageInput[],
  context: VisionCallContext = {},
): Promise<VisionCallResult<DiagramImageSuggestionsResponse>> {
  const { data, model } = await callAiVisionJson({
    endpointName: "diagram_image_to_suggestions",
    taskType: getTaskTypeForUseCase(AI_USE_CASES.DIAGRAM_IMAGE_TO_SUGGESTIONS),
    images,
    responseFormat: DIAGRAM_IMAGE_SUGGESTIONS_FORMAT,
    systemPrompt: `You generate structured improvement suggestions from UML screenshots and diagram images.
Focus on grouping, missing context, node types, packages, database shapes and relation aggregation.
Return JSON only.`,
    userPrompt: `Generate structured UML improvement suggestions for these images.
Images:
${buildImagePrompt(images)}
Instruction: ${context.instruction ?? "Suggest better grouping, context stubs, UML node types and relation aggregation improvements."}${buildGraphContextBlock(context)}`,
  });

  return {
    result: parseStructuredResponse(
      data,
      DiagramImageSuggestionsResponseSchema,
      "diagram_image_to_suggestions",
      normalizeDiagramImageSuggestionsPayload,
    ),
    model,
  };
}
