import { Router, type Response, type Router as RouterType } from "express";
import {
  AiSymbolEnrichmentRequestSchema,
  AiViewWorkspaceRunRequestSchema,
  AiViewActionRequestSchema,
  AiViewRequestSchema,
} from "@dmpg/shared";
import { getConfiguredProjectPath, getCurrentProjectPath, getGraph, setGraph } from "../store.js";
import {
  collectViewOpportunities,
  enrichSymbolInGraph,
  enrichViewSymbolsInGraph,
  improveLabelsForView,
  improveSequenceRelationLabelsForView,
  reviewExternalContextForView,
  reviewViewStructure,
  suggestMissingRelationsForView,
} from "../ai/umlReview.js";
import { runViewWorkspaceSession, type ViewWorkspaceRunEvent } from "../ai/viewWorkspace.js";

export const aiUmlRouter: RouterType = Router();
let workspaceRunActive = false;

function flushResponse(res: Response) {
  const flush = (res as unknown as { flush?: () => void }).flush;
  if (typeof flush === "function") {
    flush.call(res);
  }
}

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
      getCurrentProjectPath() ?? getConfiguredProjectPath() ?? undefined,
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
      getCurrentProjectPath() ?? getConfiguredProjectPath() ?? undefined,
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
      getCurrentProjectPath() ?? getConfiguredProjectPath() ?? undefined,
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
    const sequenceRelations = await improveSequenceRelationLabelsForView(
      graph,
      parsed.data.viewId,
      parsed.data.persist ?? true,
    );
    if (parsed.data.persist ?? true) {
      setGraph(graph);
    }
    res.json({
      ...result,
      sequenceRelations,
    });
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
    const sequenceRelations = await improveSequenceRelationLabelsForView(graph, parsed.data.viewId, true);
    setGraph(graph);
    res.json({
      viewId: parsed.data.viewId,
      structure,
      labels,
      sequenceRelations,
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "UML composite review failed" });
  }
});

aiUmlRouter.post("/workspace-run", async (req, res) => {
  const parsed = AiViewWorkspaceRunRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (workspaceRunActive) {
    res.status(409).json({ error: "A view workspace run is already active." });
    return;
  }

  try {
    const graph = requireGraph();
    workspaceRunActive = true;
    let clientGone = false;

    req.on("close", () => {
      clientGone = true;
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n");
    flushResponse(res);

    const send = (event: ViewWorkspaceRunEvent) => {
      if (clientGone) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      flushResponse(res);
    };

    await runViewWorkspaceSession({
      graph,
      request: parsed.data,
      emit: send,
      ensureActive: () => {
        if (clientGone) {
          throw new Error("__workspace_aborted__");
        }
      },
    });

    if (!clientGone) {
      res.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "View workspace run failed";
    if (message !== "__workspace_aborted__" && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({
        runKind: "view_workspace",
        phase: "error",
        message,
      })}\n\n`);
      res.end();
    }
  } finally {
    workspaceRunActive = false;
  }
});
