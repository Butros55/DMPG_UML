import { Router, type Router as RouterType } from "express";
import { getGraph, setGraph } from "../store.js";
import { buildDemoGraph } from "../demo-graph.js";
import { ProjectGraphSchema } from "@dmpg/shared";

export const graphRouter: RouterType = Router();

/** GET /api/graph — return current graph (or demo if none) */
graphRouter.get("/", (_req, res) => {
  let g = getGraph();
  if (!g) {
    g = buildDemoGraph();
    setGraph(g);
  }
  res.json(g);
});

/** PUT /api/graph — replace the whole graph (e.g. after editing) */
graphRouter.put("/", (req, res) => {
  const parsed = ProjectGraphSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  setGraph(parsed.data);
  res.json({ ok: true });
});

/** PATCH /api/graph/symbol/:id/doc — update doc of a single symbol */
graphRouter.patch("/symbol/:id/doc", (req, res) => {
  const g = getGraph();
  if (!g) {
    res.status(404).json({ error: "no graph loaded" });
    return;
  }
  const sym = g.symbols.find((s) => s.id === req.params.id);
  if (!sym) {
    res.status(404).json({ error: "symbol not found" });
    return;
  }
  sym.doc = { ...sym.doc, ...req.body };
  setGraph(g);
  res.json({ ok: true, doc: sym.doc });
});
