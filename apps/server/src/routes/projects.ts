import { Router, type Router as RouterType } from "express";
import {
  listProjects,
  switchProject,
  deleteProject,
  getActiveProjectPath,
  getGraph,
} from "../store.js";

export const projectsRouter: RouterType = Router();

/** GET /api/projects — list all known projects */
projectsRouter.get("/", (_req, res) => {
  const projects = listProjects();
  const active = getActiveProjectPath();
  res.json({ projects, activeProject: active });
});

/** POST /api/projects/switch — switch to a different project */
projectsRouter.post("/switch", (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || typeof projectPath !== "string") {
    res.status(400).json({ error: "projectPath is required" });
    return;
  }
  const graph = switchProject(projectPath);
  res.json({ ok: true, graph, projectPath });
});

/** DELETE /api/projects — remove a project from the index.
 *  Returns the updated project list, new active project, and its graph
 *  so the client can re-sync in a single round-trip.
 */
projectsRouter.delete("/", (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || typeof projectPath !== "string") {
    res.status(400).json({ error: "projectPath is required" });
    return;
  }
  const deleted = deleteProject(projectPath);
  if (!deleted) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Return full state so client can re-sync without extra round-trips
  const projects = listProjects();
  const activeProject = getActiveProjectPath();
  const graph = getGraph() ?? null;
  res.json({ ok: true, projects, activeProject, graph });
});
