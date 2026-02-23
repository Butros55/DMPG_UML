import { Router, type Router as RouterType } from "express";
import { scanProject } from "../scanner/index.js";
import { setGraph } from "../store.js";
import { ScanRequestSchema } from "@dmpg/shared";

export const scanRouter: RouterType = Router();

/** POST /api/scan — scan a local project directory */
scanRouter.post("/", async (req, res) => {
  const parsed = ScanRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const graph = await scanProject(parsed.data.projectPath);
    setGraph(graph);
    res.json(graph);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "scan failed" });
  }
});
