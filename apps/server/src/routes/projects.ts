import { Router, type Router as RouterType } from "express";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  listProjects,
  switchProject,
  deleteProject,
  getActiveProjectPath,
  getGraph,
} from "../store.js";

export const projectsRouter: RouterType = Router();

function execFileCapture(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

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

/** POST /api/projects/open-folder — reveal a project in the native file explorer */
projectsRouter.post("/open-folder", (req, res) => {
  const projectPath = typeof req.body?.projectPath === "string" ? req.body.projectPath.trim() : "";
  if (!projectPath) {
    res.status(400).json({ error: "projectPath is required" });
    return;
  }

  const resolvedProjectPath = path.resolve(projectPath);
  if (!fs.existsSync(resolvedProjectPath) || !fs.statSync(resolvedProjectPath).isDirectory()) {
    res.status(400).json({ error: "projectPath must point to an existing directory" });
    return;
  }

  if (process.platform !== "win32") {
    res.status(501).json({ error: "Native folder opening is currently implemented for Windows only" });
    return;
  }

  execFile("explorer.exe", [resolvedProjectPath], { windowsHide: true }, (error) => {
    if (error) {
      res.status(500).json({ error: `Explorer could not be opened: ${error.message}` });
      return;
    }
    res.json({ ok: true, projectPath: resolvedProjectPath });
  });
});

/** POST /api/projects/pick-folder — open native folder picker */
projectsRouter.post("/pick-folder", async (req, res) => {
  if (process.platform !== "win32") {
    res.status(501).json({ error: "Native folder picker is currently implemented for Windows only" });
    return;
  }

  const initialPath = typeof req.body?.initialPath === "string"
    ? req.body.initialPath.trim()
    : "";
  const resolvedInitialPath = initialPath && fs.existsSync(initialPath)
    ? path.resolve(initialPath)
    : "";

  const pickerScript = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "[System.Windows.Forms.Application]::EnableVisualStyles()",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select Project Root'",
    "$dialog.ShowNewFolderButton = $true",
    "if ($env:DMPG_INITIAL_PATH -and (Test-Path $env:DMPG_INITIAL_PATH)) { $dialog.SelectedPath = $env:DMPG_INITIAL_PATH }",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) { [Console]::Out.Write($dialog.SelectedPath) }",
  ].join("; ");

  try {
    const { stdout } = await execFileCapture(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", pickerScript],
      {
        windowsHide: true,
        env: {
          ...process.env,
          DMPG_INITIAL_PATH: resolvedInitialPath,
        },
      },
    );
    const projectPath = stdout.trim();
    res.json({
      projectPath: projectPath ? path.resolve(projectPath) : null,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Folder picker failed",
    });
  }
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
