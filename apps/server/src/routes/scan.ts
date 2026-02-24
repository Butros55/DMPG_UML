import { Router, type Router as RouterType } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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

/** GET /api/scan/browse?path=... — browse filesystem directories */
scanRouter.get("/browse", (req, res) => {
  const rawPath = (req.query.path as string) || "";
  const dir = rawPath || (process.platform === "win32" ? os.homedir() : "/");

  try {
    const resolved = path.resolve(dir);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const folders = entries
      .filter((e) => {
        try {
          return e.isDirectory() && !e.name.startsWith(".");
        } catch {
          return false;
        }
      })
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentDir = path.dirname(resolved);
    res.json({
      current: resolved,
      parent: parentDir !== resolved ? parentDir : null,
      folders,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
