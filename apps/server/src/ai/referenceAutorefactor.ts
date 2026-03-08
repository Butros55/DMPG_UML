import type {
  DiagramView,
  ProjectGraph,
  RelationType,
  ReviewCategory,
  ReviewSeverity,
  Symbol as GraphSymbol,
  SymbolUmlType,
  UmlReferenceAutorefactorActionResult,
  UmlReferenceAutorefactorOptions,
  UmlReferenceAutorefactorRequest,
  UmlReferenceAutorefactorResponse,
  UmlReferenceCompareResponse,
  UmlReferenceRefactorAction,
  UmlReferenceRefactorPlan,
  UmlReferenceRefactorValidation,
  ViewReviewIssue,
  ViewScope,
} from "@dmpg/shared";
import {
  RelationTypeEnum,
  UmlReferenceAutorefactorResponseSchema,
  UmlReferenceRefactorPlanSchema,
  UmlReferenceRefactorValidationSchema,
} from "@dmpg/shared";
import { callAiJson } from "./client.js";
import { buildViewHeuristics } from "./umlReview.js";
import { compareUmlReferenceImages, persistUmlReferenceCompareReview } from "./visionReview.js";
import { AI_USE_CASES, getTaskTypeForUseCase } from "./useCases.js";
import { createGraphSnapshot, restoreGraphSnapshot, setGraph } from "../store.js";

const SUPPORTED_AUTO_APPLY_ACTIONS = new Set<UmlReferenceRefactorAction["type"]>([
  "set_uml_type",
  "rename_symbol",
  "rename_view",
  "add_context_stub",
  "add_note",
  "add_artifact",
  "add_database_node",
  "add_component_node",
  "move_symbol",
  "reassign_parent",
  "create_view",
  "add_relation",
  "change_view_scope",
  "rerun_layout",
]);

const REVIEW_ONLY_ACTIONS = new Set<UmlReferenceRefactorAction["type"]>([
  "split_group",
  "merge_group",
  "rebuild_view",
  "remove_relation",
  "aggregate_relations",
]);

const STRUCTURAL_ACTIONS = new Set<UmlReferenceRefactorAction["type"]>([
  "set_uml_type",
  "rename_view",
  "move_symbol",
  "reassign_parent",
  "create_view",
  "change_view_scope",
  "rerun_layout",
  "split_group",
  "merge_group",
  "rebuild_view",
]);

const LABEL_ACTIONS = new Set<UmlReferenceRefactorAction["type"]>([
  "rename_symbol",
  "rename_view",
  "add_note",
]);

const RELATION_ACTIONS = new Set<UmlReferenceRefactorAction["type"]>([
  "add_relation",
  "remove_relation",
  "aggregate_relations",
  "add_context_stub",
]);

const DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION = `Vergleiche meinen aktuellen React-Flow-UML-View mit dem Referenzbild und passe das UML automatisch so weit wie sinnvoll an. Pruefe besonders:
1. ob mein Diagramm zu UI-artig statt UML-artig wirkt,
2. ob Packages, Datenbank-Zylinder, Artifacts, Components oder Notes fehlen,
3. ob das Layering / die View-Hierarchie verbessert werden sollte,
4. ob sichtbare Relationen oder externe Kontextknoten fehlen,
5. welche Aenderungen automatisch angewendet werden koennen,
6. welche Aenderungen nur als Review-Hinweis verbleiben sollten.`;

const UML_REFERENCE_REFACTOR_PLAN_FORMAT = {
  type: "object",
  properties: {
    summary: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: [
              "set_uml_type",
              "rename_symbol",
              "rename_view",
              "add_context_stub",
              "add_note",
              "add_artifact",
              "add_database_node",
              "add_component_node",
              "move_symbol",
              "split_group",
              "merge_group",
              "reassign_parent",
              "create_view",
              "rebuild_view",
              "add_relation",
              "remove_relation",
              "aggregate_relations",
              "change_view_scope",
              "rerun_layout",
            ],
          },
          targetIds: { type: "array", items: { type: "string" } },
          viewId: { type: "string" },
          payload: { type: "object" },
          confidence: { type: "number" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          autoApplicable: { type: "boolean" },
        },
        required: ["id", "type", "targetIds", "payload", "confidence", "severity", "autoApplicable"],
      },
    },
    primaryFocusTargetIds: { type: "array", items: { type: "string" } },
    changedViewIds: { type: "array", items: { type: "string" } },
    remainingReviewOnlyItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          message: { type: "string" },
          reason: { type: "string" },
          actionId: { type: "string" },
          targetIds: { type: "array", items: { type: "string" } },
          viewId: { type: "string" },
        },
        required: ["message", "reason"],
      },
    },
  },
  required: ["summary", "actions", "primaryFocusTargetIds", "changedViewIds", "remainingReviewOnlyItems"],
} as const satisfies Record<string, unknown>;

const LABEL_REFINEMENT_FORMAT = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          actionId: { type: "string" },
          newLabel: { type: "string" },
          reason: { type: "string" },
        },
        required: ["actionId", "newLabel"],
      },
    },
  },
  required: ["labels"],
} as const satisfies Record<string, unknown>;

const VALIDATION_DECISIONS_FORMAT = {
  type: "object",
  properties: {
    summary: { type: "string" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          actionId: { type: "string" },
          decision: { type: "string", enum: ["apply", "review_only", "skip"] },
          reason: { type: "string" },
        },
        required: ["actionId", "decision", "reason"],
      },
    },
  },
  required: ["summary", "decisions"],
} as const satisfies Record<string, unknown>;

type NormalizedAutorefactorOptions = Required<UmlReferenceAutorefactorOptions>;

interface ReferenceAutorefactorRunInput extends UmlReferenceAutorefactorRequest {
  graph: ProjectGraph;
}

function cloneGraph(graph: ProjectGraph): ProjectGraph {
  if (typeof structuredClone === "function") {
    return structuredClone(graph);
  }
  return JSON.parse(JSON.stringify(graph)) as ProjectGraph;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

function findView(graph: ProjectGraph, viewId: string): DiagramView | null {
  return graph.views.find((candidate) => candidate.id === viewId) ?? null;
}

function findSymbol(graph: ProjectGraph, symbolId: string): GraphSymbol | null {
  return graph.symbols.find((candidate) => candidate.id === symbolId) ?? null;
}

function normalizeAutorefactorOptions(options?: UmlReferenceAutorefactorOptions): NormalizedAutorefactorOptions {
  return {
    autoApply: options?.autoApply ?? true,
    allowStructuralChanges: options?.allowStructuralChanges ?? true,
    allowLabelChanges: options?.allowLabelChanges ?? true,
    allowRelationChanges: options?.allowRelationChanges ?? true,
    persistSuggestions: options?.persistSuggestions ?? true,
    dryRun: options?.dryRun ?? false,
  };
}

function symbolLabelMatches(symbol: GraphSymbol, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  const label = symbol.label.toLowerCase();
  const shortLabel = symbol.label.split(".").pop()?.toLowerCase() ?? label;
  return label === normalized || shortLabel === normalized || label.includes(normalized) || normalized.includes(shortLabel);
}

function resolveTargetIds(graph: ProjectGraph, viewId: string, hint?: string, preferredIds?: string[]): string[] {
  const validPreferred = preferredIds?.filter((id) => graph.symbols.some((symbol) => symbol.id === id)) ?? [];
  if (validPreferred.length > 0) return unique(validPreferred);
  if (!hint) return [];

  const currentView = findView(graph, viewId);
  const currentMatches = graph.symbols
    .filter((symbol) => currentView?.nodeRefs.includes(symbol.id))
    .filter((symbol) => symbolLabelMatches(symbol, hint))
    .map((symbol) => symbol.id);
  if (currentMatches.length > 0) return unique(currentMatches);

  return unique(
    graph.symbols
      .filter((symbol) => symbolLabelMatches(symbol, hint))
      .map((symbol) => symbol.id),
  );
}

function pickBestFocusView(graph: ProjectGraph, currentViewId: string, targetIds: string[], changedViewIds: string[]): string | undefined {
  const targetSet = new Set(targetIds);
  const scored = graph.views
    .map((view) => ({
      id: view.id,
      matchCount: view.nodeRefs.filter((nodeId) => targetSet.has(nodeId)).length,
      changed: changedViewIds.includes(view.id),
      current: view.id === currentViewId,
      depth: view.scope === "class" ? 3 : view.scope === "module" ? 2 : view.scope === "group" ? 1 : 0,
    }))
    .sort((left, right) =>
      Number(right.changed) - Number(left.changed)
      || right.matchCount - left.matchCount
      || Number(right.current) - Number(left.current)
      || right.depth - left.depth,
    );
  return scored[0]?.id;
}

function humanizeActionType(type: UmlReferenceRefactorAction["type"]): string {
  return type.replace(/_/g, " ");
}

function inferReviewCategory(actionType: UmlReferenceRefactorAction["type"]): ReviewCategory {
  switch (actionType) {
    case "rename_symbol":
    case "rename_view":
      return "naming";
    case "add_relation":
    case "aggregate_relations":
      return "relation_visibility";
    case "add_context_stub":
      return "context";
    case "change_view_scope":
    case "create_view":
    case "move_symbol":
    case "reassign_parent":
    case "split_group":
    case "merge_group":
    case "rebuild_view":
    case "rerun_layout":
      return "layering";
    default:
      return "notation";
  }
}

function inferReviewSeverity(action: UmlReferenceRefactorAction): ReviewSeverity {
  return action.severity ?? "medium";
}

function parseRelationType(value: unknown): RelationType | null {
  const parsed = RelationTypeEnum.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : undefined;
}

function buildViewContext(graph: ProjectGraph, viewId: string) {
  const view = findView(graph, viewId);
  if (!view) return null;

  const heuristics = buildViewHeuristics(graph, viewId);
  const nodes = graph.symbols
    .filter((symbol) => view.nodeRefs.includes(symbol.id))
    .map((symbol) => ({
      id: symbol.id,
      label: symbol.label,
      kind: symbol.kind,
      umlType: symbol.umlType ?? null,
      parentId: symbol.parentId ?? null,
      childViewId: symbol.childViewId ?? null,
    }));
  const edges = graph.relations
    .filter((relation) => view.nodeRefs.includes(relation.source) && view.nodeRefs.includes(relation.target))
    .map((relation) => ({
      id: relation.id,
      type: relation.type,
      source: relation.source,
      target: relation.target,
      label: relation.label ?? null,
      confidence: relation.confidence ?? null,
    }));

  return {
    viewId: view.id,
    title: view.title,
    scope: view.scope ?? "root",
    heuristics,
    nodes,
    edges,
  };
}

function normalizeGeneratedPlan(plan: UmlReferenceRefactorPlan, graph: ProjectGraph, viewId: string): UmlReferenceRefactorPlan {
  const normalizedActions = plan.actions.map((action, index) => {
    const payload = action.payload ?? {};
    let targetIds = unique(action.targetIds ?? []);

    if (targetIds.length === 0) {
      const targetHint = getString(payload, "target") ?? getString(payload, "targetLabel") ?? getString(payload, "label");
      if (targetHint) {
        targetIds = resolveTargetIds(graph, action.viewId ?? viewId, targetHint);
      }
    }

    if (action.type === "add_relation") {
      const sourceId = getString(payload, "sourceId");
      const targetId = getString(payload, "targetId");
      targetIds = unique([...(targetIds ?? []), ...(sourceId ? [sourceId] : []), ...(targetId ? [targetId] : [])]);
    }

    return {
      ...action,
      id: action.id?.trim() || `refactor-action-${index + 1}-${slugify(action.type)}`,
      targetIds,
      viewId: action.viewId ?? viewId,
      payload,
    };
  });

  const changedViewIds = unique([
    ...plan.changedViewIds,
    ...normalizedActions.flatMap((action) => action.viewId ? [action.viewId] : []),
  ]);
  const primaryFocusTargetIds = plan.primaryFocusTargetIds.length > 0
    ? unique(plan.primaryFocusTargetIds)
    : unique(normalizedActions.flatMap((action) => action.targetIds)).slice(0, 8);

  return {
    ...plan,
    actions: normalizedActions,
    changedViewIds,
    primaryFocusTargetIds,
    remainingReviewOnlyItems: plan.remainingReviewOnlyItems ?? [],
  };
}

function deriveFallbackRefactorPlan(compare: UmlReferenceCompareResponse, graph: ProjectGraph, viewId: string): UmlReferenceRefactorPlan {
  const fallbackActions: UmlReferenceRefactorAction[] = [];

  for (const suggestion of compare.migrationSuggestions) {
    const targetIds = resolveTargetIds(graph, viewId, suggestion.target);
    switch (suggestion.type) {
      case "replace_group_with_package":
        fallbackActions.push({
          id: `fallback-package-${slugify(suggestion.target ?? suggestion.message)}`,
          type: "set_uml_type",
          targetIds,
          viewId,
          payload: { umlType: "package", target: suggestion.target },
          confidence: suggestion.confidence,
          severity: "high",
          autoApplicable: targetIds.length > 0,
        });
        break;
      case "use_database_shape":
        fallbackActions.push({
          id: `fallback-database-${slugify(suggestion.target ?? suggestion.message)}`,
          type: "set_uml_type",
          targetIds,
          viewId,
          payload: { umlType: "database", target: suggestion.target },
          confidence: suggestion.confidence,
          severity: "medium",
          autoApplicable: targetIds.length > 0,
        });
        break;
      case "promote_artifact_shape":
        fallbackActions.push({
          id: `fallback-artifact-${slugify(suggestion.target ?? suggestion.message)}`,
          type: "set_uml_type",
          targetIds,
          viewId,
          payload: { umlType: "artifact", target: suggestion.target },
          confidence: suggestion.confidence,
          severity: "medium",
          autoApplicable: targetIds.length > 0,
        });
        break;
      case "add_context_stub":
        fallbackActions.push({
          id: `fallback-context-${slugify(suggestion.target ?? suggestion.message)}`,
          type: "add_context_stub",
          targetIds,
          viewId,
          payload: {
            label: suggestion.target ?? "External Context",
            relatedToIds: targetIds,
          },
          confidence: suggestion.confidence,
          severity: "medium",
          autoApplicable: true,
        });
        break;
      case "add_note":
        fallbackActions.push({
          id: `fallback-note-${slugify(suggestion.message)}`,
          type: "add_note",
          targetIds,
          viewId,
          payload: {
            label: suggestion.target ?? "UML Note",
            note: suggestion.message,
          },
          confidence: suggestion.confidence,
          severity: "low",
          autoApplicable: true,
        });
        break;
      case "split_view":
        fallbackActions.push({
          id: `fallback-split-${slugify(suggestion.message)}`,
          type: "create_view",
          targetIds,
          viewId,
          payload: {
            title: suggestion.target ? `${suggestion.target} Detail` : "Reference-driven split view",
            scope: "group",
            ownerSymbolId: targetIds[0],
          },
          confidence: suggestion.confidence,
          severity: "medium",
          autoApplicable: false,
        });
        break;
      case "aggregate_relations":
        fallbackActions.push({
          id: `fallback-aggregate-${slugify(suggestion.message)}`,
          type: "aggregate_relations",
          targetIds,
          viewId,
          payload: {
            target: suggestion.target,
            note: suggestion.message,
          },
          confidence: suggestion.confidence,
          severity: "medium",
          autoApplicable: false,
        });
        break;
      case "rename_group":
      default:
        break;
    }
  }

  return normalizeGeneratedPlan({
    summary: `Fallback refactor plan derived from ${compare.migrationSuggestions.length} compare suggestions.`,
    actions: fallbackActions,
    primaryFocusTargetIds: unique(fallbackActions.flatMap((action) => action.targetIds)).slice(0, 8),
    changedViewIds: [viewId],
    remainingReviewOnlyItems: [],
  }, graph, viewId);
}

async function generateReferenceRefactorPlan(
  compare: UmlReferenceCompareResponse,
  graph: ProjectGraph,
  viewId: string,
  options: NormalizedAutorefactorOptions,
  instruction?: string,
): Promise<UmlReferenceRefactorPlan> {
  const viewContext = buildViewContext(graph, viewId);
  if (!viewContext) {
    throw new Error(`View not found: ${viewId}`);
  }

  const userPrompt = `Build a machine-applicable UML refactor plan for the current graph.
Instruction: ${instruction ?? "Adapt the current UML graph toward the reference diagram while auto-applying only deterministic changes."}
Options:
${JSON.stringify(options, null, 2)}

Compare result:
${JSON.stringify(compare, null, 2)}

Current view context:
${JSON.stringify(viewContext, null, 2)}

Rules:
- Prefer deterministic actions with explicit targetIds
- Use set_uml_type for package/database/artifact/component/note style changes
- Use add_context_stub/add_note/add_artifact/add_database_node/add_component_node for new nodes
- Use add_relation only when sourceId, targetId and relationType are concrete
- Only use split_group, merge_group, rebuild_view or remove_relation when absolutely necessary, otherwise leave them as remainingReviewOnlyItems
- If an action cannot be safely auto-applied, either set autoApplicable=false or move it into remainingReviewOnlyItems
- Keep payloads small and machine-readable
- Return JSON only`;

  try {
    const { data } = await callAiJson({
      taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_REFACTOR_PLAN),
      systemPrompt: "You convert UML compare findings into a deterministic refactor plan for an editable project graph. Return JSON only.",
      userPrompt,
      responseFormat: UML_REFERENCE_REFACTOR_PLAN_FORMAT,
      requestOptions: { temperature: 0 },
    });

    const parsed = UmlReferenceRefactorPlanSchema.safeParse(data);
    if (parsed.success) {
      const normalized = normalizeGeneratedPlan(parsed.data, graph, viewId);
      if (normalized.actions.length > 0 || normalized.remainingReviewOnlyItems.length > 0) {
        return normalized;
      }
    }
  } catch (error) {
    console.warn(`[reference-autorefactor] plan generation failed, using fallback: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return deriveFallbackRefactorPlan(compare, graph, viewId);
}

function parseLabelRefinement(data: unknown): Array<{ actionId: string; newLabel: string }> {
  if (!data || typeof data !== "object") return [];
  const labels = (data as { labels?: unknown }).labels;
  if (!Array.isArray(labels)) return [];

  return labels
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const actionId = typeof (entry as { actionId?: unknown }).actionId === "string" ? (entry as { actionId: string }).actionId.trim() : "";
      const newLabel = typeof (entry as { newLabel?: unknown }).newLabel === "string" ? (entry as { newLabel: string }).newLabel.trim() : "";
      if (!actionId || !newLabel) return null;
      return { actionId, newLabel };
    })
    .filter((entry): entry is { actionId: string; newLabel: string } => entry !== null);
}

async function refineLabelActions(
  plan: UmlReferenceRefactorPlan,
  compare: UmlReferenceCompareResponse,
  options: NormalizedAutorefactorOptions,
): Promise<UmlReferenceRefactorPlan> {
  if (!options.allowLabelChanges) return plan;

  const candidates = plan.actions.filter((action) => LABEL_ACTIONS.has(action.type));
  if (candidates.length === 0) return plan;

  try {
    const { data } = await callAiJson({
      taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_REFACTOR_LABELING),
      systemPrompt: "You refine generated UML labels and titles. Keep them concise, precise and architecture-oriented. Return JSON only.",
      userPrompt: `Refine these label-oriented refactor actions.
Compare context:
${JSON.stringify(compare.overallAssessment, null, 2)}
Actions:
${JSON.stringify(candidates, null, 2)}`,
      responseFormat: LABEL_REFINEMENT_FORMAT,
      requestOptions: { temperature: 0 },
    });

    const refinements = new Map(parseLabelRefinement(data).map((entry) => [entry.actionId, entry.newLabel]));
    if (refinements.size === 0) return plan;

    return {
      ...plan,
      actions: plan.actions.map((action) => {
        const newLabel = refinements.get(action.id);
        if (!newLabel) return action;
        if (action.type === "rename_symbol") {
          return { ...action, payload: { ...action.payload, newLabel } };
        }
        if (action.type === "rename_view") {
          return { ...action, payload: { ...action.payload, newTitle: newLabel } };
        }
        if (action.type === "add_note") {
          return { ...action, payload: { ...action.payload, label: newLabel } };
        }
        return action;
      }),
    };
  } catch (error) {
    console.warn(`[reference-autorefactor] label refinement skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    return plan;
  }
}

function localValidationReason(action: UmlReferenceRefactorAction, options: NormalizedAutorefactorOptions): { decision: "apply" | "review_only" | "skip"; reason: string } {
  if (REVIEW_ONLY_ACTIONS.has(action.type)) {
    return { decision: "review_only", reason: `${humanizeActionType(action.type)} is not yet deterministic enough for blind auto-apply.` };
  }
  if (!SUPPORTED_AUTO_APPLY_ACTIONS.has(action.type)) {
    return { decision: "skip", reason: `Unsupported action type: ${action.type}` };
  }
  if (!action.autoApplicable) {
    return { decision: "review_only", reason: "The plan marked this action as not safely auto-applicable." };
  }
  if (LABEL_ACTIONS.has(action.type) && !options.allowLabelChanges) {
    return { decision: "review_only", reason: "Label changes are disabled for this run." };
  }
  if (STRUCTURAL_ACTIONS.has(action.type) && !options.allowStructuralChanges) {
    return { decision: "review_only", reason: "Structural and layering changes are disabled for this run." };
  }
  if (RELATION_ACTIONS.has(action.type) && !options.allowRelationChanges) {
    return { decision: "review_only", reason: "Relation and context changes are disabled for this run." };
  }
  return { decision: "apply", reason: "Locally consistent and permitted by the selected options." };
}

function actionNeedsTargets(action: UmlReferenceRefactorAction): boolean {
  return !["rename_view", "create_view", "rerun_layout", "change_view_scope"].includes(action.type);
}

function structurallySensitiveActions(actions: UmlReferenceRefactorAction[]): UmlReferenceRefactorAction[] {
  return actions.filter((action) => ["create_view", "move_symbol", "reassign_parent", "change_view_scope", "set_uml_type"].includes(action.type));
}

async function validateStructuralActions(
  actions: UmlReferenceRefactorAction[],
  graph: ProjectGraph,
  viewId: string,
  compare: UmlReferenceCompareResponse,
): Promise<Map<string, { decision: "apply" | "review_only" | "skip"; reason: string }>> {
  const candidates = structurallySensitiveActions(actions);
  if (candidates.length === 0) return new Map();

  try {
    const { data } = await callAiJson({
      taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_REFACTOR_PLAN),
      systemPrompt: "You validate planned UML structure mutations. Approve only changes that stay coherent for the given view and graph slice. Return JSON only.",
      userPrompt: `Validate these planned structural UML refactor actions.
Compare:
${JSON.stringify(compare.overallAssessment, null, 2)}
View:
${JSON.stringify(buildViewContext(graph, viewId), null, 2)}
Actions:
${JSON.stringify(candidates, null, 2)}

Return decision=apply only when the action is coherent and safe. Use review_only when the action needs human review. Use skip for invalid actions.`,
      responseFormat: VALIDATION_DECISIONS_FORMAT,
      requestOptions: { temperature: 0 },
    });

    const parsed = UmlReferenceRefactorValidationSchema.safeParse(data);
    if (!parsed.success) return new Map();
    return new Map(parsed.data.decisions.map((entry) => [entry.actionId, { decision: entry.decision, reason: entry.reason }]));
  } catch (error) {
    console.warn(`[reference-autorefactor] structural validation skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    return new Map();
  }
}

async function validateRelationActions(
  actions: UmlReferenceRefactorAction[],
  graph: ProjectGraph,
  viewId: string,
): Promise<Map<string, { decision: "apply" | "review_only" | "skip"; reason: string }>> {
  const relationCandidates = actions.filter((action) => action.type === "add_relation");
  if (relationCandidates.length === 0) return new Map();

  try {
    const { data } = await callAiJson({
      taskType: getTaskTypeForUseCase(AI_USE_CASES.UML_REFERENCE_REFACTOR_RELATION_VALIDATION),
      systemPrompt: "You validate planned UML relation insertions. Approve only relations that are plausible for the current graph slice. Return JSON only.",
      userPrompt: `Validate these relation additions.
Current view:
${JSON.stringify(buildViewContext(graph, viewId), null, 2)}
Planned relation actions:
${JSON.stringify(relationCandidates, null, 2)}

Return decision=apply only for plausible relations with concrete endpoints. Return review_only for speculative relations and skip for invalid payloads.`,
      responseFormat: VALIDATION_DECISIONS_FORMAT,
      requestOptions: { temperature: 0 },
    });

    const parsed = UmlReferenceRefactorValidationSchema.safeParse(data);
    if (!parsed.success) return new Map();
    return new Map(parsed.data.decisions.map((entry) => [entry.actionId, { decision: entry.decision, reason: entry.reason }]));
  } catch (error) {
    console.warn(`[reference-autorefactor] relation validation skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    return new Map();
  }
}

export async function validateReferenceRefactorPlan(params: {
  plan: UmlReferenceRefactorPlan;
  graph: ProjectGraph;
  viewId: string;
  options?: UmlReferenceAutorefactorOptions;
  compare: UmlReferenceCompareResponse;
}): Promise<UmlReferenceRefactorValidation> {
  const options = normalizeAutorefactorOptions(params.options);
  const localDecisions = new Map<string, { decision: "apply" | "review_only" | "skip"; reason: string }>();

  for (const action of params.plan.actions) {
    const local = localValidationReason(action, options);

    if (actionNeedsTargets(action) && action.targetIds.length === 0 && action.type !== "add_context_stub" && action.type !== "add_note") {
      localDecisions.set(action.id, { decision: "skip", reason: "The action has no resolvable targets." });
      continue;
    }
    if (action.type === "rename_symbol" && !getString(action.payload, "newLabel")) {
      localDecisions.set(action.id, { decision: "skip", reason: "rename_symbol requires payload.newLabel." });
      continue;
    }
    if (action.type === "rename_view" && !getString(action.payload, "newTitle")) {
      localDecisions.set(action.id, { decision: "skip", reason: "rename_view requires payload.newTitle." });
      continue;
    }
    if (action.type === "add_relation") {
      const sourceId = getString(action.payload, "sourceId");
      const targetId = getString(action.payload, "targetId");
      const relationType = parseRelationType(action.payload.relationType);
      if (!sourceId || !targetId || !relationType) {
        localDecisions.set(action.id, { decision: "skip", reason: "add_relation requires sourceId, targetId and relationType." });
        continue;
      }
    }

    localDecisions.set(action.id, local);
  }

  const applyCandidates = params.plan.actions.filter((action) => localDecisions.get(action.id)?.decision === "apply");
  const structuralDecisions = await validateStructuralActions(applyCandidates, params.graph, params.viewId, params.compare);
  const relationDecisions = await validateRelationActions(applyCandidates, params.graph, params.viewId);

  return {
    summary: `${params.plan.actions.length} actions checked for reference-driven auto-apply.`,
    decisions: params.plan.actions.map((action) => {
      const local = localDecisions.get(action.id) ?? { decision: "skip" as const, reason: "Action was not classified." };
      const structural = structuralDecisions.get(action.id);
      const relation = relationDecisions.get(action.id);
      const final = relation ?? structural ?? local;
      return {
        actionId: action.id,
        decision: final.decision,
        reason: final.reason,
      };
    }),
  };
}

function ensureView(graph: ProjectGraph, viewId: string, fallbackTitle = "Generated View"): DiagramView {
  let view = findView(graph, viewId);
  if (view) return view;

  view = {
    id: viewId,
    title: fallbackTitle,
    parentViewId: graph.rootViewId,
    scope: "group",
    nodeRefs: [],
    edgeRefs: [],
  };
  graph.views.push(view);
  return view;
}

function ensureNodeInView(view: DiagramView, symbolId: string) {
  if (!view.nodeRefs.includes(symbolId)) {
    view.nodeRefs.push(symbolId);
  }
}

function removeNodeFromView(view: DiagramView, symbolId: string) {
  view.nodeRefs = view.nodeRefs.filter((candidate) => candidate !== symbolId);
}

function makeGeneratedSymbolId(graph: ProjectGraph, prefix: string, label: string): string {
  const base = `${prefix}:${slugify(label)}`;
  let nextId = base;
  let counter = 1;
  while (graph.symbols.some((symbol) => symbol.id === nextId)) {
    counter += 1;
    nextId = `${base}-${counter}`;
  }
  return nextId;
}

function makeGeneratedViewId(graph: ProjectGraph, title: string): string {
  const base = `view:auto:${slugify(title)}`;
  let nextId = base;
  let counter = 1;
  while (graph.views.some((view) => view.id === nextId)) {
    counter += 1;
    nextId = `${base}-${counter}`;
  }
  return nextId;
}

function ensureRelationVisible(graph: ProjectGraph, relationId: string, sourceId: string, targetId: string, preferredViewId?: string) {
  const containingViews = graph.views.filter((view) => view.nodeRefs.includes(sourceId) && view.nodeRefs.includes(targetId));
  if (containingViews.length > 0) {
    for (const view of containingViews) {
      if (!view.edgeRefs.includes(relationId)) {
        view.edgeRefs.push(relationId);
      }
    }
    return;
  }

  const preferredView = preferredViewId ? findView(graph, preferredViewId) : null;
  if (preferredView && !preferredView.edgeRefs.includes(relationId)) {
    preferredView.edgeRefs.push(relationId);
  }
}

function clearLayoutForViews(graph: ProjectGraph, viewIds: Iterable<string>) {
  for (const viewId of unique(viewIds)) {
    const view = findView(graph, viewId);
    if (view) {
      delete view.nodePositions;
    }
  }
}

function createApplyResult(action: UmlReferenceRefactorAction, reason: string): UmlReferenceAutorefactorActionResult {
  return {
    actionId: action.id,
    type: action.type,
    targetIds: unique(action.targetIds),
    viewId: action.viewId,
    reason,
  };
}

function appendReviewOnlyHints(
  graph: ProjectGraph,
  viewId: string,
  results: Array<UmlReferenceAutorefactorActionResult & { severity: ReviewSeverity; actionType: UmlReferenceRefactorAction["type"] }>,
) {
  const view = findView(graph, viewId);
  if (!view || results.length === 0) return;

  const createdAt = new Date().toISOString();
  const existing = new Map((view.reviewHints ?? []).map((hint) => [hint.reviewId ?? `${hint.type}:${hint.message}`, hint]));
  for (const result of results) {
    const issue: ViewReviewIssue = {
      reviewId: `uml_reference_refactor:${viewId}:${result.actionId}`,
      type: result.actionType === "add_context_stub" ? "missing_context" : result.actionType === "rename_symbol" || result.actionType === "rename_view" ? "naming_unclear" : "layering_issue",
      severity: result.severity,
      title: `${result.actionType === "add_context_stub" ? "Reference context review" : "Reference refactor review"}: ${humanizeActionType(result.actionType)}`,
      message: result.reason,
      suggestedAction: `Review ${humanizeActionType(result.actionType)} manually before applying it.`,
      targetIds: result.targetIds.length > 0 ? result.targetIds : undefined,
      source: "uml_reference_compare",
      category: inferReviewCategory(result.actionType),
      status: "new",
      createdAt,
    };
    existing.set(issue.reviewId!, issue);
  }
  view.reviewHints = Array.from(existing.values());
}

export function applyReferenceRefactorPlan(params: {
  graph: ProjectGraph;
  viewId: string;
  compare: UmlReferenceCompareResponse;
  plan: UmlReferenceRefactorPlan;
  validation: UmlReferenceRefactorValidation;
  options?: UmlReferenceAutorefactorOptions;
}): Omit<UmlReferenceAutorefactorResponse, "undoInfo"> {
  const options = normalizeAutorefactorOptions(params.options);
  const nextGraph = cloneGraph(params.graph);
  const decisionMap = new Map(params.validation.decisions.map((entry) => [entry.actionId, entry]));
  const appliedActions: UmlReferenceAutorefactorActionResult[] = [];
  const skippedActions: UmlReferenceAutorefactorActionResult[] = [];
  const reviewOnlyActions: Array<UmlReferenceAutorefactorActionResult & { severity: ReviewSeverity; actionType: UmlReferenceRefactorAction["type"] }> = [];
  const changedTargetIds = new Set<string>();
  const changedViewIds = new Set<string>();

  const markChanged = (action: UmlReferenceRefactorAction, extraTargetIds: string[] = [], extraViewIds: string[] = []) => {
    for (const targetId of [...action.targetIds, ...extraTargetIds]) changedTargetIds.add(targetId);
    for (const changedViewId of [action.viewId, ...extraViewIds].filter((entry): entry is string => !!entry)) changedViewIds.add(changedViewId);
  };

  for (const action of params.plan.actions) {
    const decision = decisionMap.get(action.id);
    if (!decision || decision.decision === "skip") {
      skippedActions.push(createApplyResult(action, decision?.reason ?? "Action skipped."));
      continue;
    }
    if (decision.decision === "review_only") {
      reviewOnlyActions.push({
        ...createApplyResult(action, decision.reason),
        severity: inferReviewSeverity(action),
        actionType: action.type,
      });
      continue;
    }

    try {
      switch (action.type) {
        case "set_uml_type": {
          const umlType = getString(action.payload, "umlType") as SymbolUmlType | undefined;
          if (!umlType) throw new Error("payload.umlType is required.");
          for (const targetId of action.targetIds) {
            const symbol = findSymbol(nextGraph, targetId);
            if (!symbol) continue;
            if (umlType === "package") {
              if (symbol.kind === "group" || symbol.kind === "module" || symbol.kind === "package") {
                symbol.kind = "package";
              }
              symbol.umlType = "package";
            } else {
              symbol.umlType = umlType;
            }
          }
          markChanged(action);
          appliedActions.push(createApplyResult(action, `Applied UML type change to ${action.targetIds.length} symbol(s).`));
          break;
        }
        case "rename_symbol": {
          const newLabel = getString(action.payload, "newLabel");
          if (!newLabel) throw new Error("payload.newLabel is required.");
          for (const targetId of action.targetIds) {
            const symbol = findSymbol(nextGraph, targetId);
            if (!symbol) continue;
            symbol.label = newLabel;
            if (symbol.childViewId) {
              const ownedView = findView(nextGraph, symbol.childViewId);
              if (ownedView) ownedView.title = newLabel;
            }
          }
          markChanged(action);
          appliedActions.push(createApplyResult(action, `Renamed ${action.targetIds.length} symbol(s).`));
          break;
        }
        case "rename_view": {
          const newTitle = getString(action.payload, "newTitle");
          const targetView = action.viewId ? findView(nextGraph, action.viewId) : null;
          if (!targetView || !newTitle) throw new Error("rename_view requires viewId and payload.newTitle.");
          targetView.title = newTitle;
          markChanged(action, [], [targetView.id]);
          appliedActions.push(createApplyResult(action, `Renamed view "${targetView.id}".`));
          break;
        }
        case "add_context_stub":
        case "add_note":
        case "add_artifact":
        case "add_database_node":
        case "add_component_node": {
          const targetViewId = action.viewId ?? params.viewId;
          const targetView = ensureView(nextGraph, targetViewId, "Reference View");
          const label = getString(action.payload, "label")
            ?? getString(action.payload, "target")
            ?? `${humanizeActionType(action.type)} ${targetView.nodeRefs.length + 1}`;
          const symbolId = makeGeneratedSymbolId(nextGraph, "ref", label);
          const umlType: SymbolUmlType =
            action.type === "add_note" ? "note"
              : action.type === "add_database_node" ? "database"
                : action.type === "add_component_node" ? "component"
                  : "artifact";
          const summary = getString(action.payload, "note") ?? getString(action.payload, "summary");
          nextGraph.symbols.push({
            id: symbolId,
            label,
            kind: "external",
            umlType,
            doc: summary ? { summary, aiGenerated: { summary: true } } : undefined,
            tags: ["ai-generated", `ai-refactor:${action.type}`],
          });
          ensureNodeInView(targetView, symbolId);
          markChanged(action, [symbolId], [targetView.id]);
          appliedActions.push(createApplyResult(action, `Added ${umlType} node "${label}".`));
          break;
        }
        case "add_relation": {
          const sourceId = getString(action.payload, "sourceId");
          const targetId = getString(action.payload, "targetId");
          const relationType = parseRelationType(action.payload.relationType);
          if (!sourceId || !targetId || !relationType) {
            throw new Error("add_relation requires sourceId, targetId and relationType.");
          }
          const existing = nextGraph.relations.find((relation) =>
            relation.source === sourceId &&
            relation.target === targetId &&
            relation.type === relationType,
          );
          const relationId = existing?.id ?? `rel:auto:${relationType}:${slugify(sourceId)}:${slugify(targetId)}:${Date.now()}`;
          if (!existing) {
            nextGraph.relations.push({
              id: relationId,
              source: sourceId,
              target: targetId,
              type: relationType,
              label: getString(action.payload, "label"),
              confidence: Math.max(0.55, action.confidence),
              aiGenerated: true,
            });
          }
          ensureRelationVisible(nextGraph, relationId, sourceId, targetId, action.viewId);
          markChanged(action, [sourceId, targetId]);
          appliedActions.push(createApplyResult(action, existing ? "Relation already existed; visibility kept in sync." : "Added relation."));
          break;
        }
        case "move_symbol":
        case "reassign_parent": {
          const newParentId = getString(action.payload, "newParentId");
          if (!newParentId) throw new Error(`${action.type} requires payload.newParentId.`);
          for (const targetId of action.targetIds) {
            const symbol = findSymbol(nextGraph, targetId);
            if (!symbol) continue;
            const previousParentId = symbol.parentId;
            symbol.parentId = newParentId;
            if (previousParentId) {
              const previousView = findView(nextGraph, `view:${previousParentId}`);
              if (previousView) removeNodeFromView(previousView, symbol.id);
            }
            const nextParentView = findView(nextGraph, `view:${newParentId}`);
            if (nextParentView) ensureNodeInView(nextParentView, symbol.id);
          }
          markChanged(action, [], [action.viewId ?? params.viewId]);
          appliedActions.push(createApplyResult(action, `Reassigned parent for ${action.targetIds.length} symbol(s).`));
          break;
        }
        case "create_view": {
          const title = getString(action.payload, "title") ?? "Reference-derived View";
          const scope = (getString(action.payload, "scope") as ViewScope | undefined) ?? "group";
          const ownerSymbolId = getString(action.payload, "ownerSymbolId");
          const parentViewId = getString(action.payload, "parentViewId") ?? action.viewId ?? params.viewId;
          const nodeIds = getStringArray(action.payload, "nodeIds") ?? action.targetIds;
          const newViewId = getString(action.payload, "newViewId") ?? makeGeneratedViewId(nextGraph, title);
          if (!findView(nextGraph, newViewId)) {
            nextGraph.views.push({
              id: newViewId,
              title,
              parentViewId,
              scope,
              nodeRefs: unique(nodeIds),
              edgeRefs: [],
            });
          }
          if (ownerSymbolId) {
            const owner = findSymbol(nextGraph, ownerSymbolId);
            if (owner) owner.childViewId = newViewId;
          }
          markChanged(action, nodeIds, [newViewId, parentViewId]);
          appliedActions.push(createApplyResult(action, `Created view "${title}".`));
          break;
        }
        case "change_view_scope": {
          const targetView = action.viewId ? findView(nextGraph, action.viewId) : null;
          const newScope = (getString(action.payload, "newScope") as ViewScope | undefined) ?? (getString(action.payload, "scope") as ViewScope | undefined);
          if (!targetView || !newScope) throw new Error("change_view_scope requires viewId and payload.newScope.");
          targetView.scope = newScope;
          markChanged(action, [], [targetView.id]);
          appliedActions.push(createApplyResult(action, `Changed scope of "${targetView.id}" to ${newScope}.`));
          break;
        }
        case "rerun_layout": {
          const targetViewIds = getStringArray(action.payload, "targetViewIds") ?? [action.viewId ?? params.viewId];
          clearLayoutForViews(nextGraph, targetViewIds);
          markChanged(action, [], targetViewIds);
          appliedActions.push(createApplyResult(action, `Cleared saved layout positions for ${targetViewIds.length} view(s).`));
          break;
        }
        default:
          reviewOnlyActions.push({
            ...createApplyResult(action, `${humanizeActionType(action.type)} is not auto-applied yet.`),
            severity: inferReviewSeverity(action),
            actionType: action.type,
          });
          break;
      }
    } catch (error) {
      skippedActions.push(createApplyResult(action, error instanceof Error ? error.message : "Action failed during apply."));
    }
  }

  if (options.persistSuggestions) {
    persistUmlReferenceCompareReview(nextGraph, params.viewId, params.compare);
    appendReviewOnlyHints(nextGraph, params.viewId, [
      ...reviewOnlyActions,
      ...skippedActions.map((action) => ({ ...action, severity: "medium" as const, actionType: action.type })),
    ]);
  }

  clearLayoutForViews(nextGraph, unique([...changedViewIds, ...params.plan.changedViewIds]));
  const highlightTargetIds = unique([
    ...changedTargetIds,
    ...(appliedActions.length === 0 ? params.plan.primaryFocusTargetIds : []),
  ]);
  const focusViewId = pickBestFocusView(nextGraph, params.viewId, highlightTargetIds, Array.from(changedViewIds));

  const response: Omit<UmlReferenceAutorefactorResponse, "undoInfo"> = {
    compare: params.compare,
    plan: params.plan,
    validation: params.validation,
    appliedActions,
    skippedActions,
    reviewOnlyActions,
    changedTargetIds: Array.from(changedTargetIds),
    changedViewIds: unique([...changedViewIds, ...params.plan.changedViewIds]),
    highlightTargetIds,
    primaryFocusTargetIds: params.plan.primaryFocusTargetIds.length > 0 ? params.plan.primaryFocusTargetIds : highlightTargetIds.slice(0, 3),
    focusViewId,
    autoApplied: options.autoApply && !options.dryRun && appliedActions.length > 0,
    graph: nextGraph,
  };

  const parsed = UmlReferenceAutorefactorResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(`reference_autorefactor apply produced invalid response: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function runReferenceDrivenUmlAutorefactor(input: ReferenceAutorefactorRunInput): Promise<UmlReferenceAutorefactorResponse> {
  const options = normalizeAutorefactorOptions(input.options);
  const viewId = input.viewId ?? input.graph.rootViewId;
  const instruction = input.instruction?.trim() || DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION;
  const view = findView(input.graph, viewId);
  if (!view) {
    throw new Error(`View not found: ${viewId || "unknown"}`);
  }

  const compare = await compareUmlReferenceImages(
    [
      { ...input.currentViewImage, label: input.currentViewImage.label ?? "current_view" },
      { ...input.referenceImage, label: input.referenceImage.label ?? "reference_view" },
    ],
    {
      instruction,
      viewId: view.id,
      graph: input.graph,
      graphContext: input.graphContext,
    },
  );

  let plan = await generateReferenceRefactorPlan(compare.result, input.graph, view.id, options, instruction);
  plan = await refineLabelActions(plan, compare.result, options);
  const validation = await validateReferenceRefactorPlan({
    plan,
    graph: input.graph,
    viewId: view.id,
    options,
    compare: compare.result,
  });

  if (!options.autoApply || options.dryRun) {
    const graph = options.persistSuggestions ? cloneGraph(input.graph) : input.graph;
    if (options.persistSuggestions) {
      persistUmlReferenceCompareReview(graph, view.id, compare.result);
      setGraph(graph);
    }

    return {
      ...applyReferenceRefactorPlan({
        graph: input.graph,
        viewId: view.id,
        compare: compare.result,
        plan,
        validation,
        options: { ...options, autoApply: false, dryRun: true },
      }),
      graph,
      autoApplied: false,
    };
  }

  const snapshot = createGraphSnapshot(`reference-autorefactor:${view.id}`);
  const applyRunId = `refactor-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const applied = applyReferenceRefactorPlan({
    graph: input.graph,
    viewId: view.id,
    compare: compare.result,
    plan,
    validation,
    options,
  });

  if (applied.graph) {
    setGraph(applied.graph);
  }

  return {
    ...applied,
    undoInfo: snapshot ? { snapshotId: snapshot.snapshotId, applyRunId } : undefined,
  };
}

export function undoReferenceDrivenUmlAutorefactor(snapshotId: string): ProjectGraph {
  const restored = restoreGraphSnapshot(snapshotId);
  if (!restored) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  return restored;
}
