import { Router, type Router as RouterType } from "express";
import {
  AiSymbolEnrichmentRequestSchema,
  AiViewActionRequestSchema,
  AiViewRequestSchema,
} from "@dmpg/shared";
import { getCurrentProjectPath, getGraph, setGraph } from "../store.js";
import {
  collectViewOpportunities,
  enrichSymbolInGraph,
  enrichViewSymbolsInGraph,
  improveLabelsForView,
  reviewExternalContextForView,
  reviewViewStructure,
  suggestMissingRelationsForView,
} from "../ai/umlReview.js";

export const aiUmlRouter: RouterType = Router();

function requireGraph() {
  const graph = getGraph();
  if (!graph) {
    throw new Error("No graph loaded");
  }
  return graph;
}

aiUmlRouter.post("/enrich-symbol", async (req, res) => {
  const parsed = AiSymbolEnrichmentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = requireGraph();
    const result = await enrichSymbolInGraph(
      graph,
      parsed.data.symbolId,
      getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH,
    );
    setGraph(graph);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML symbol enrichment failed" });
  }
});

aiUmlRouter.post("/enrich-view-symbols", async (req, res) => {
  const parsed = AiViewActionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = requireGraph();
    const result = await enrichViewSymbolsInGraph(
      graph,
      parsed.data.viewId,
      getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH,
      parsed.data.limit ?? 12,
    );
    setGraph(graph);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML view enrichment failed" });
  }
});

aiUmlRouter.post("/suggest-missing-relations", async (req, res) => {
  const parsed = AiViewActionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = requireGraph();
    const result = await suggestMissingRelationsForView(
      graph,
      parsed.data.viewId,
      getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH,
      parsed.data.limit ?? 15,
      parsed.data.apply ?? true,
    );
    if ((parsed.data.apply ?? true) && result.appliedRelationIds.length > 0) {
      setGraph(graph);
    }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML relation enrichment failed" });
  }
});

aiUmlRouter.post("/review-view-structure", async (req, res) => {
  const parsed = AiViewActionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = requireGraph();
    const result = await reviewViewStructure(
      graph,
      parsed.data.viewId,
      parsed.data.persist ?? true,
      parsed.data.includeContextReview ?? true,
    );
    if (parsed.data.persist ?? true) {
      setGraph(graph);
    }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML structure review failed" });
  }
});

aiUmlRouter.post("/review-external-context", async (req, res) => {
  const parsed = AiViewActionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = requireGraph();
    const result = await reviewExternalContextForView(
      graph,
      parsed.data.viewId,
      parsed.data.persist ?? true,
    );
    if (parsed.data.persist ?? true) {
      setGraph(graph);
    }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML external context review failed" });
  }
});

aiUmlRouter.post("/improve-view-labels", async (req, res) => {
  const parsed = AiViewActionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = requireGraph();
    const result = await improveLabelsForView(
      graph,
      parsed.data.viewId,
      parsed.data.persist ?? true,
    );
    if (parsed.data.persist ?? true) {
      setGraph(graph);
    }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML label improvement failed" });
  }
});

aiUmlRouter.get("/view-opportunities", (req, res) => {
  try {
    const graph = requireGraph();
    const sparseOnly = String(req.query.sparseOnly ?? "").toLowerCase() === "true";
    const opportunities = collectViewOpportunities(graph)
      .filter((opportunity) => !sparseOnly || opportunity.sparse);
    res.json({ opportunities });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "No graph loaded" });
  }
});

aiUmlRouter.post("/review-view", async (req, res) => {
  const parsed = AiViewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const graph = requireGraph();
    const structure = await reviewViewStructure(graph, parsed.data.viewId, true, true);
    const labels = await improveLabelsForView(graph, parsed.data.viewId, true);
    setGraph(graph);
    res.json({
      viewId: parsed.data.viewId,
      structure,
      labels,
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML composite review failed" });
  }
});
