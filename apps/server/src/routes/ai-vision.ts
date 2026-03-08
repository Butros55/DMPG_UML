import { Router, type Router as RouterType } from "express";
import {
  DiagramImageCompareRequestSchema,
  DiagramImageReviewRequestSchema,
  DiagramImageSuggestionsRequestSchema,
  UmlReferenceAutorefactorRequestSchema,
  UmlReferenceAutorefactorUndoRequestSchema,
  UmlReferenceCompareRequestSchema,
} from "@dmpg/shared";
import { getGraph, setGraph } from "../store.js";
import {
  compareDiagramImages,
  compareUmlReferenceImages,
  persistUmlReferenceCompareReview,
  reviewDiagramImage,
  suggestDiagramImprovementsFromImages,
} from "../ai/visionReview.js";
import {
  runReferenceDrivenUmlAutorefactor,
  undoReferenceDrivenUmlAutorefactor,
} from "../ai/referenceAutorefactor.js";

export const aiVisionRouter: RouterType = Router();

function visionErrorStatus(message: string): number {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("requires") ||
    normalized.includes("unsupported vision image mime type") ||
    normalized.includes("base64") ||
    normalized.includes("does not advertise the \"vision\" capability") ||
    normalized.includes("persistsuggestions")
  ) {
    return 400;
  }
  return 502;
}

aiVisionRouter.post("/review", async (req, res) => {
  const parsed = DiagramImageReviewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await reviewDiagramImage(parsed.data.images, {
      instruction: parsed.data.instruction,
      viewId: parsed.data.viewId,
      graph: getGraph(),
      graphContext: parsed.data.graphContext,
    });
    res.json(result.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vision review failed";
    res.status(visionErrorStatus(message)).json({ error: message });
  }
});

aiVisionRouter.post("/compare", async (req, res) => {
  const parsed = DiagramImageCompareRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await compareDiagramImages(parsed.data.images, {
      instruction: parsed.data.instruction,
      viewId: parsed.data.viewId,
      graph: getGraph(),
      graphContext: parsed.data.graphContext,
    });
    res.json(result.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vision compare failed";
    res.status(visionErrorStatus(message)).json({ error: message });
  }
});

aiVisionRouter.post("/suggestions", async (req, res) => {
  const parsed = DiagramImageSuggestionsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await suggestDiagramImprovementsFromImages(parsed.data.images, {
      instruction: parsed.data.instruction,
      viewId: parsed.data.viewId,
      graph: getGraph(),
      graphContext: parsed.data.graphContext,
    });
    res.json(result.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vision suggestions failed";
    res.status(visionErrorStatus(message)).json({ error: message });
  }
});

aiVisionRouter.post("/compare-uml", async (req, res) => {
  const parsed = UmlReferenceCompareRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = getGraph();
    if (parsed.data.persistSuggestions && (!parsed.data.viewId || !graph)) {
      throw new Error("persistSuggestions requires a loaded graph and a valid viewId.");
    }

    const result = await compareUmlReferenceImages(parsed.data.images, {
      instruction: parsed.data.instruction,
      viewId: parsed.data.viewId,
      graph,
      graphContext: parsed.data.graphContext,
    });

    if (parsed.data.persistSuggestions && parsed.data.viewId && graph) {
      persistUmlReferenceCompareReview(graph, parsed.data.viewId, result.result);
      setGraph(graph);
    }

    res.json(result.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UML vision compare failed";
    res.status(visionErrorStatus(message)).json({ error: message });
  }
});

aiVisionRouter.post("/compare-apply", async (req, res) => {
  const parsed = UmlReferenceAutorefactorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = getGraph();
    if (!graph) {
      res.status(404).json({ error: "No graph loaded. Scan or load a project before running reference-driven UML autorefactor." });
      return;
    }

    const result = await runReferenceDrivenUmlAutorefactor({
      ...parsed.data,
      graph,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference-driven UML autorefactor failed";
    const normalized = message.toLowerCase();
    if (normalized.includes("view not found")) {
      res.status(404).json({ error: message });
      return;
    }
    res.status(visionErrorStatus(message)).json({ error: message });
  }
});

aiVisionRouter.post("/compare-apply/undo", async (req, res) => {
  const parsed = UmlReferenceAutorefactorUndoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = undoReferenceDrivenUmlAutorefactor(parsed.data.snapshotId);
    res.json({ ok: true, graph });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Undo for reference-driven UML autorefactor failed";
    const normalized = message.toLowerCase();
    if (normalized.includes("snapshot not found")) {
      res.status(404).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});
