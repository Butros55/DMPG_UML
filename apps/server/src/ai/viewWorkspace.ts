import type {
  AiSessionRunKind,
  AiViewWorkspaceRunRequest,
  AiWorkspaceRunStep,
  AiExternalContextReviewResponse,
  AiLabelImprovementResponse,
  Relation,
  AiStructureReviewResponse,
  ProjectGraph,
  UmlReferenceAutorefactorResponse,
} from "@dmpg/shared";
import {
  improveLabelsForView,
  improveSequenceRelationLabelsForView,
  reviewExternalContextForView,
  reviewViewStructure,
  type SequenceRelationLabelImprovementResult,
} from "./umlReview.js";
import { runReferenceDrivenUmlAutorefactor } from "./referenceAutorefactor.js";
import { setGraph } from "../store.js";

export interface ViewWorkspaceRunEvent {
  runKind: AiSessionRunKind;
  phase: string;
  action?: string;
  step?: AiWorkspaceRunStep;
  viewId?: string;
  current?: number;
  total?: number;
  message?: string;
  thought?: string;
  symbolId?: string;
  symbolLabel?: string;
  targetIds?: string[];
  focusViewId?: string;
  relationId?: string;
  relationType?: Relation["type"];
  relationLabel?: string;
  source?: string;
  target?: string;
  sourceLabel?: string;
  targetLabel?: string;
  appliedCount?: number;
  reviewOnlyCount?: number;
  autoApplied?: boolean;
  undoSnapshotId?: string;
  applyRunId?: string;
}

export interface ViewWorkspaceRunSummary {
  graph: ProjectGraph;
  viewId: string;
  targetIds: string[];
  focusViewId: string;
  appliedCount: number;
  reviewOnlyCount: number;
  autoApplied: boolean;
  undoSnapshotId?: string;
  applyRunId?: string;
}

export interface ViewWorkspaceDependencies {
  reviewViewStructure: typeof reviewViewStructure;
  reviewExternalContextForView: typeof reviewExternalContextForView;
  improveLabelsForView: typeof improveLabelsForView;
  improveSequenceRelationLabelsForView: typeof improveSequenceRelationLabelsForView;
  runReferenceDrivenUmlAutorefactor: typeof runReferenceDrivenUmlAutorefactor;
  persistGraph: (graph: ProjectGraph) => void;
}

const DEFAULT_DEPENDENCIES: ViewWorkspaceDependencies = {
  reviewViewStructure,
  reviewExternalContextForView,
  improveLabelsForView,
  improveSequenceRelationLabelsForView,
  runReferenceDrivenUmlAutorefactor,
  persistGraph: setGraph,
};

function findView(graph: ProjectGraph, viewId: string) {
  const view = graph.views.find((candidate) => candidate.id === viewId);
  if (!view) {
    throw new Error(`View not found: ${viewId}`);
  }
  return view;
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter((value) => value.length > 0);
}

function firstSymbolId(targetIds: readonly string[]): string | undefined {
  return targetIds[0];
}

function collectStructureTargets(review: AiStructureReviewResponse): string[] {
  return unique(review.issues.flatMap((issue) => issue.targetIds ?? []));
}

function collectContextTargets(review: AiExternalContextReviewResponse): string[] {
  return unique(review.suggestedContextNodes.flatMap((suggestion) => suggestion.relatedSymbolIds ?? []));
}

function collectLabelTargets(review: AiLabelImprovementResponse): string[] {
  return unique(review.improvements.map((improvement) => improvement.targetId));
}

function collectSequenceRelationTargets(review: SequenceRelationLabelImprovementResult): string[] {
  return unique(review.improvements.flatMap((improvement) => [improvement.sourceId, improvement.targetId]));
}

function describeStep(step: AiWorkspaceRunStep): string {
  switch (step) {
    case "structure":
      return "Struktur";
    case "context":
      return "Kontext";
    case "labels":
      return "Labels";
    case "reference":
      return "Referenz";
    default:
      return step;
  }
}

function isSkippableVisionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("vision") ||
    message.includes("multimodal") ||
    message.includes("capability") ||
    message.includes("does not advertise")
  );
}

export async function runViewWorkspaceSession(
  params: {
    graph: ProjectGraph;
    request: AiViewWorkspaceRunRequest;
    emit: (event: ViewWorkspaceRunEvent) => void;
    ensureActive?: () => void;
  },
  deps: ViewWorkspaceDependencies = DEFAULT_DEPENDENCIES,
): Promise<ViewWorkspaceRunSummary> {
  const includeStructure = params.request.includeStructure ?? true;
  const includeContext = params.request.includeContext ?? true;
  const includeLabels = params.request.includeLabels ?? true;
  const hasReference = !!params.request.referenceImage;

  const steps: AiWorkspaceRunStep[] = [
    ...(includeStructure ? ["structure" as const] : []),
    ...(includeContext ? ["context" as const] : []),
    ...(includeLabels ? ["labels" as const] : []),
    ...(hasReference ? ["reference" as const] : []),
  ];

  let graph = params.graph;
  const view = findView(graph, params.request.viewId);
  const highlightTargets = new Set<string>();
  let focusViewId = view.id;
  let appliedCount = 0;
  let reviewOnlyCount = 0;
  let autoApplied = false;
  let undoSnapshotId: string | undefined;
  let applyRunId: string | undefined;

  params.emit({
    runKind: "view_workspace",
    phase: "workspace",
    action: "start",
    current: 0,
    total: steps.length,
    viewId: view.id,
    message: `AI Workspace startet fur ${view.title}.`,
  });

  if (steps.length === 0) {
    params.emit({
      runKind: "view_workspace",
      phase: "done",
      viewId: view.id,
      current: 0,
      total: 0,
      targetIds: [],
      focusViewId: view.id,
      message: "Keine Workspace-Schritte ausgewaehlt.",
    });
    return {
      graph,
      viewId: view.id,
      targetIds: [],
      focusViewId: view.id,
      appliedCount: 0,
      reviewOnlyCount: 0,
      autoApplied: false,
    };
  }

  for (const [index, step] of steps.entries()) {
    params.ensureActive?.();

    params.emit({
      runKind: "view_workspace",
      phase: step,
      action: "progress",
      step,
      viewId: view.id,
      current: index,
      total: steps.length,
      message: `${describeStep(step)} wird gepruft...`,
      thought: `${describeStep(step)} fur ${view.title}`,
    });

    if (step === "structure") {
      const result = await deps.reviewViewStructure(graph, view.id, true, false);
      deps.persistGraph(graph);
      const targetIds = collectStructureTargets(result.review);
      targetIds.forEach((targetId) => highlightTargets.add(targetId));

      params.emit({
        runKind: "view_workspace",
        phase: "structure_review",
        action: "saved",
        step,
        viewId: view.id,
        current: index + 1,
        total: steps.length,
        message: `${result.review.issues.length} Struktur-Hinweise aktualisiert.`,
        symbolId: firstSymbolId(targetIds),
        targetIds,
        focusViewId: view.id,
      });
      continue;
    }

    if (step === "context") {
      const result = await deps.reviewExternalContextForView(graph, view.id, true);
      deps.persistGraph(graph);
      const targetIds = collectContextTargets(result);
      targetIds.forEach((targetId) => highlightTargets.add(targetId));

      params.emit({
        runKind: "view_workspace",
        phase: "external_context_review",
        action: "saved",
        step,
        viewId: view.id,
        current: index + 1,
        total: steps.length,
        message: `${result.suggestedContextNodes.length} Kontext-Hinweise aktualisiert.`,
        symbolId: firstSymbolId(targetIds),
        targetIds,
        focusViewId: view.id,
      });
      continue;
    }

    if (step === "labels") {
      const result = await deps.improveLabelsForView(graph, view.id, true);
      const targetIds = collectLabelTargets(result);
      targetIds.forEach((targetId) => highlightTargets.add(targetId));
      const sequenceResult = await deps.improveSequenceRelationLabelsForView(graph, view.id, true);
      const relationTargetIds = collectSequenceRelationTargets(sequenceResult);
      relationTargetIds.forEach((targetId) => highlightTargets.add(targetId));
      deps.persistGraph(graph);

      for (const improvement of sequenceResult.improvements) {
        params.emit({
          runKind: "view_workspace",
          phase: "relation_labels",
          action: "updated",
          step,
          viewId: view.id,
          current: index + 1,
          total: steps.length,
          message: improvement.newLabel,
          thought: improvement.reason,
          symbolId: improvement.sourceId,
          targetIds: [improvement.sourceId, improvement.targetId],
          focusViewId: view.id,
          relationId: improvement.relationId,
          relationLabel: improvement.newLabel,
          source: improvement.sourceId,
          target: improvement.targetId,
          sourceLabel: graph.symbols.find((symbol) => symbol.id === improvement.sourceId)?.label,
          targetLabel: graph.symbols.find((symbol) => symbol.id === improvement.targetId)?.label,
        });
      }

      params.emit({
        runKind: "view_workspace",
        phase: "label_improvement",
        action: "saved",
        step,
        viewId: view.id,
        current: index + 1,
        total: steps.length,
        message: `${result.improvements.length} Label-Hinweise und ${sequenceResult.improvements.length} Sequenz-Beziehungen aktualisiert.`,
        symbolId: firstSymbolId(unique([...targetIds, ...relationTargetIds])),
        targetIds: unique([...targetIds, ...relationTargetIds]),
        focusViewId: view.id,
      });
      continue;
    }

    if (step === "reference") {
      try {
        const result: UmlReferenceAutorefactorResponse = await deps.runReferenceDrivenUmlAutorefactor({
          graph,
          viewId: view.id,
          currentViewImage: params.request.currentViewImage!,
          referenceImage: params.request.referenceImage!,
          instruction: params.request.instruction,
          options: params.request.options,
          graphContext: {
            viewId: view.id,
            viewTitle: view.title,
          },
        });

        graph = result.graph ?? graph;
        deps.persistGraph(graph);

        const targetIds = unique(result.highlightTargetIds);
        targetIds.forEach((targetId) => highlightTargets.add(targetId));
        focusViewId = result.focusViewId ?? focusViewId;
        appliedCount = result.appliedActions.length;
        reviewOnlyCount = result.reviewOnlyActions.length;
        autoApplied = result.autoApplied;
        undoSnapshotId = result.undoInfo?.snapshotId;
        applyRunId = result.undoInfo?.applyRunId;

        params.emit({
          runKind: "view_workspace",
          phase: "uml_reference_compare",
          action: "saved",
          step,
          viewId: view.id,
          current: index + 1,
          total: steps.length,
          message: `${result.appliedActions.length} automatisch angewendet, ${result.reviewOnlyActions.length} als Review offen.`,
          symbolId: result.primaryFocusTargetIds[0] ?? firstSymbolId(targetIds),
          targetIds,
          focusViewId,
          appliedCount,
          reviewOnlyCount,
          autoApplied,
        });
      } catch (error) {
        if (!isSkippableVisionError(error)) {
          throw error;
        }

        params.emit({
          runKind: "view_workspace",
          phase: "uml_reference_compare",
          action: "skipped",
          step,
          viewId: view.id,
          current: index + 1,
          total: steps.length,
          focusViewId,
          message: `Referenz-Vergleich uebersprungen: ${error instanceof Error ? error.message : "Vision-Modell nicht verfuegbar."}`,
        });
      }
    }
  }

  params.ensureActive?.();

  const finalTargetIds = unique(highlightTargets);
  params.emit({
    runKind: "view_workspace",
    phase: "done",
    viewId: view.id,
    current: steps.length,
    total: steps.length,
    targetIds: finalTargetIds,
    symbolId: firstSymbolId(finalTargetIds),
    focusViewId,
    appliedCount,
    reviewOnlyCount,
    autoApplied,
    undoSnapshotId,
    applyRunId,
    message: "AI Workspace abgeschlossen.",
  });

  return {
    graph,
    viewId: view.id,
    targetIds: finalTargetIds,
    focusViewId,
    appliedCount,
    reviewOnlyCount,
    autoApplied,
    undoSnapshotId,
    applyRunId,
  };
}
