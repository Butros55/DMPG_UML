import { Router, type Router as RouterType } from "express";
import { getGraph, setGraph, getCurrentProjectPath } from "../store.js";
import { buildDemoGraph } from "../demo-graph.js";
import { ProjectGraphSchema } from "@dmpg/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import { augmentGraphWithUmlOverlays } from "../scanner/processOverview.js";

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
  const normalized = augmentGraphWithUmlOverlays(parsed.data);
  setGraph(normalized);
  res.json({ ok: true, graph: normalized });
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

/** GET /api/graph/source/:id — return source code for a symbol */
graphRouter.get("/source/:id", (req, res) => {
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
  const loc = sym.location;
  if (!loc?.file) {
    res.status(404).json({ error: "symbol has no file location" });
    return;
  }
  const scanRoot = g.sourceProjectPath ?? getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH ?? "";
  const absPath = path.isAbsolute(loc.file) ? loc.file : path.join(scanRoot, loc.file);
  try {
    const src = fs.readFileSync(absPath, "utf-8");
    const lines = src.split("\n");
    const startLine = loc.startLine ?? 1;
    const endLine = loc.endLine ?? lines.length;
    const start = Math.max(0, startLine - 1);
    const end = Math.min(endLine, lines.length);
    const code = lines.slice(start, end).join("\n");
    res.json({
      code,
      file: loc.file,
      startLine,
      endLine: end,
      totalLines: lines.length,
      language: loc.file.endsWith(".py") ? "python" : loc.file.endsWith(".ts") || loc.file.endsWith(".tsx") ? "typescript" : loc.file.endsWith(".js") || loc.file.endsWith(".jsx") ? "javascript" : "text",
    });
  } catch (err: any) {
    res.status(500).json({ error: `Could not read file: ${err.message}` });
  }
});
