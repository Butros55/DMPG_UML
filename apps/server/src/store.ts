import type { ProjectGraph } from "@dmpg/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { augmentGraphWithUmlOverlays } from "./scanner/processOverview.js";

/**
 * Multi-project persistent graph store.
 * Each project (identified by its directory path) gets its own data on disk.
 * Supports switching between projects while preserving all data.
 */

const DATA_DIR = path.resolve(process.env.DMPG_DATA_DIR ?? path.join(process.cwd(), ".dmpg-data"));
const PROJECTS_DIR = path.join(DATA_DIR, "projects");
const META_FILE = path.join(DATA_DIR, "projects-meta.json");
const SNAPSHOTS_DIR_NAME = "snapshots";
const MAX_GRAPH_SNAPSHOTS = 12;

// Legacy single-project files (for migration)
const LEGACY_GRAPH_FILE = path.join(DATA_DIR, "graph.json");
const LEGACY_AI_FILE = path.join(DATA_DIR, "ai-progress.json");

// Ensure directories exist
for (const dir of [DATA_DIR, PROJECTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ── Project metadata ──────────────────────────── */

export interface ProjectMeta {
  /** Absolute path to the project directory */
  projectPath: string;
  /** Display name (last folder segment) */
  name: string;
  /** Number of symbols at last scan */
  symbolCount: number;
  /** Timestamp of last successful scan */
  lastScanned: string;
  /** Internal hash used as folder name */
  hash: string;
}

interface ProjectsIndex {
  /** Path of the currently active project */
  activeProject: string | null;
  /** All known projects */
  projects: ProjectMeta[];
}

function hashPath(p: string): string {
  return crypto.createHash("sha256").update(p.toLowerCase().replace(/\\/g, "/")).digest("hex").slice(0, 12);
}

function comparableProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function projectDir(hash: string): string {
  return path.join(PROJECTS_DIR, hash);
}

function graphDisplayName(graph: Pick<ProjectGraph, "projectName" | "projectPath">): string {
  const explicit = graph.projectName?.trim();
  if (explicit) return explicit;
  const fromPath = graph.projectPath?.trim();
  if (fromPath) return path.basename(fromPath);
  return "Imported Project";
}

export function getConfiguredProjectPath(): string | null {
  const raw = (process.env.FSCAN_PROJECT_PATH ?? process.env.SCAN_PROJECT_PATH ?? "").trim();
  return raw ? path.resolve(raw) : null;
}

export function normalizePersistedGraph(graph: ProjectGraph): {
  graph: ProjectGraph;
  changed: boolean;
} {
  const before = JSON.stringify(graph);
  const normalized = augmentGraphWithUmlOverlays(graph);
  return {
    graph: normalized,
    changed: JSON.stringify(normalized) !== before,
  };
}

function persistGraphForProject(graph: ProjectGraph, projectPath: string): void {
  const hash = hashPath(projectPath);
  const dir = projectDir(hash);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "graph.json"), JSON.stringify(graph), "utf-8");
}

function loadNormalizedGraphFile(gFile: string): { graph: ProjectGraph; changed: boolean } | null {
  if (!fs.existsSync(gFile)) return null;
  const parsed = JSON.parse(fs.readFileSync(gFile, "utf-8")) as ProjectGraph;
  return normalizePersistedGraph(parsed);
}

function loadProjectsIndex(): ProjectsIndex {
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, "utf-8")) as ProjectsIndex;
    }
  } catch { /* ignore */ }
  return { activeProject: null, projects: [] };
}

function saveProjectsIndex(idx: ProjectsIndex): void {
  try {
    fs.writeFileSync(META_FILE, JSON.stringify(idx, null, 2), "utf-8");
  } catch (err) {
    console.error("[store] Failed to save projects index:", (err as Error).message);
  }
}

/* ── Migrate legacy single-project data ────────── */

function migrateLegacy(): void {
  if (!fs.existsSync(LEGACY_GRAPH_FILE)) return;
  try {
    const raw = fs.readFileSync(LEGACY_GRAPH_FILE, "utf-8");
    const graph = JSON.parse(raw) as ProjectGraph;
    const pp = graph.projectPath ?? getConfiguredProjectPath() ?? "";
    if (!pp) {
      console.log("[store] Legacy graph has no projectPath, skipping migration");
      return;
    }
    const hash = hashPath(pp);
    const dir = projectDir(hash);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "graph.json"), raw, "utf-8");
    // Migrate AI progress too
    if (fs.existsSync(LEGACY_AI_FILE)) {
      fs.copyFileSync(LEGACY_AI_FILE, path.join(dir, "ai-progress.json"));
    }
    // Update index
    const idx = loadProjectsIndex();
    if (!idx.projects.find((p) => p.hash === hash)) {
      idx.projects.push({
        projectPath: pp,
        name: graphDisplayName(graph),
        symbolCount: graph.symbols.length,
        lastScanned: new Date().toISOString(),
        hash,
      });
    }
    idx.activeProject = pp;
    saveProjectsIndex(idx);
    // Remove legacy files
    fs.unlinkSync(LEGACY_GRAPH_FILE);
    if (fs.existsSync(LEGACY_AI_FILE)) fs.unlinkSync(LEGACY_AI_FILE);
    console.log(`[store] Migrated legacy data to project "${graphDisplayName(graph)}" (${hash})`);
  } catch (err) {
    console.warn("[store] Legacy migration failed:", (err as Error).message);
  }
}

migrateLegacy();

/* ── Current state (in memory) ──────────────── */

let currentGraph: ProjectGraph | null = null;
let currentProjectPath: string | null = null;

export interface GraphSnapshotInfo {
  snapshotId: string;
  createdAt: string;
  reason: string;
}

// Load the active project on startup
{
  const idx = loadProjectsIndex();
  const preferredProjectPath = getConfiguredProjectPath() ?? idx.activeProject;
  if (preferredProjectPath) {
    const resolvedProjectPath = path.resolve(preferredProjectPath);
    const preferredComparablePath = comparableProjectPath(resolvedProjectPath);
    const meta = idx.projects.find((p) => comparableProjectPath(p.projectPath) === preferredComparablePath);
    if (meta) {
      const gFile = path.join(projectDir(meta.hash), "graph.json");
      try {
        const loaded = loadNormalizedGraphFile(gFile);
        if (loaded) {
          currentGraph = loaded.graph;
          currentProjectPath = resolvedProjectPath;
          if (loaded.changed) {
            persistGraphForProject(currentGraph, currentProjectPath);
            console.log(`[store] Re-normalized persisted project "${meta.name}"`);
          }
          if (
            !idx.activeProject ||
            comparableProjectPath(idx.activeProject) !== comparableProjectPath(resolvedProjectPath)
          ) {
            idx.activeProject = resolvedProjectPath;
            saveProjectsIndex(idx);
          }
          console.log(`[store] Loaded project "${meta.name}" (${currentGraph.symbols.length} symbols)`);
        }
      } catch (err) {
        console.warn(`[store] Failed to load project "${meta.name}":`, (err as Error).message);
      }
    } else if (getConfiguredProjectPath() === resolvedProjectPath) {
      currentProjectPath = resolvedProjectPath;
      idx.activeProject = resolvedProjectPath;
      saveProjectsIndex(idx);
    }
  }
}

export function getGraph(): ProjectGraph | null {
  return currentGraph;
}

export function getCurrentProjectPath(): string | null {
  return currentProjectPath;
}

export function getPersistedProjectGraph(projectPath: string): ProjectGraph | null {
  const resolvedProjectPath = path.resolve(projectPath);
  if (
    currentGraph &&
    currentProjectPath &&
    comparableProjectPath(currentProjectPath) === comparableProjectPath(resolvedProjectPath)
  ) {
    return currentGraph;
  }

  const hash = hashPath(resolvedProjectPath);
  const gFile = path.join(projectDir(hash), "graph.json");
  const loaded = loadNormalizedGraphFile(gFile);
  if (!loaded) return null;
  if (loaded.changed) {
    persistGraphForProject(loaded.graph, resolvedProjectPath);
  }
  return loaded.graph;
}

// Debounced disk write (300ms)
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistToDisk() {
  if (!currentGraph || !currentProjectPath) return;
  try {
    persistGraphForProject(currentGraph, currentProjectPath);
  } catch (err) {
    console.error("[store] Failed to persist graph:", (err as Error).message);
  }
}

function currentProjectDataDir(): string | null {
  if (!currentProjectPath) return null;
  return projectDir(hashPath(currentProjectPath));
}

function snapshotsDir(): string | null {
  const dir = currentProjectDataDir();
  return dir ? path.join(dir, SNAPSHOTS_DIR_NAME) : null;
}

function snapshotFile(snapshotId: string): string | null {
  const dir = snapshotsDir();
  return dir ? path.join(dir, `${snapshotId}.json`) : null;
}

function pruneSnapshots(): void {
  const dir = snapshotsDir();
  if (!dir || !fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => ({
      entry,
      fullPath: path.join(dir, entry),
      mtimeMs: fs.statSync(path.join(dir, entry)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const file of files.slice(MAX_GRAPH_SNAPSHOTS)) {
    try {
      fs.unlinkSync(file.fullPath);
    } catch {
      // ignore snapshot cleanup failures
    }
  }
}

export function createGraphSnapshot(reason = "manual"): GraphSnapshotInfo | null {
  if (!currentGraph || !currentProjectPath) return null;
  const dir = snapshotsDir();
  if (!dir) return null;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const createdAt = new Date().toISOString();
  const snapshotId = `graph-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const targetFile = snapshotFile(snapshotId);
  if (!targetFile) return null;

  const payload = {
    snapshotId,
    createdAt,
    reason,
    graph: currentGraph,
  };

  fs.writeFileSync(targetFile, JSON.stringify(payload), "utf-8");
  pruneSnapshots();
  return { snapshotId, createdAt, reason };
}

export function restoreGraphSnapshot(snapshotId: string): ProjectGraph | null {
  const targetFile = snapshotFile(snapshotId);
  if (!targetFile || !fs.existsSync(targetFile)) return null;

  const raw = JSON.parse(fs.readFileSync(targetFile, "utf-8")) as { graph?: ProjectGraph };
  if (!raw.graph) return null;
  const normalized = normalizePersistedGraph(raw.graph);
  setGraph(normalized.graph);
  return normalized.graph;
}

export function setGraph(g: ProjectGraph): void {
  currentGraph = g;
  // Track the project path from the graph
  if (g.projectPath) {
    currentProjectPath = path.resolve(g.projectPath);
    // Update or add project metadata
    const idx = loadProjectsIndex();
    const hash = hashPath(currentProjectPath);
    const existing = idx.projects.find((p) => p.hash === hash);
    if (existing) {
      existing.name = graphDisplayName(g);
      existing.symbolCount = g.symbols.length;
      existing.lastScanned = new Date().toISOString();
      existing.projectPath = currentProjectPath;
    } else {
      idx.projects.push({
        projectPath: currentProjectPath,
        name: graphDisplayName(g),
        symbolCount: g.symbols.length,
        lastScanned: new Date().toISOString(),
        hash,
      });
    }
    idx.activeProject = currentProjectPath;
    saveProjectsIndex(idx);
  }
  // Debounce: coalesce rapid successive writes
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistToDisk, 300);
}

/** Force immediate save (e.g. on graceful shutdown) */
export function flushGraph(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  persistToDisk();
}

/* ── Project management API ────────────────────── */

export function listProjects(): ProjectMeta[] {
  const idx = loadProjectsIndex();
  return idx.projects;
}

export function getActiveProjectPath(): string | null {
  const idx = loadProjectsIndex();
  return idx.activeProject;
}

/**
 * Switch to a different project. Loads its graph from disk.
 * Returns the graph or null if project has no data yet.
 */
export function switchProject(projectPath: string): ProjectGraph | null {
  // Save current project first
  flushGraph();

  const normalizedProjectPath = path.resolve(projectPath);
  const hash = hashPath(normalizedProjectPath);
  const gFile = path.join(projectDir(hash), "graph.json");

  if (fs.existsSync(gFile)) {
    try {
      const loaded = loadNormalizedGraphFile(gFile);
      if (!loaded) return null;
      currentGraph = loaded.graph;
      currentProjectPath = normalizedProjectPath;
      if (loaded.changed) {
        persistGraphForProject(currentGraph, currentProjectPath);
        console.log(`[store] Re-normalized persisted project "${path.basename(normalizedProjectPath)}" during switch`);
      }

      // Update active in index
      const idx = loadProjectsIndex();
      idx.activeProject = normalizedProjectPath;
      saveProjectsIndex(idx);

      console.log(`[store] Switched to project "${path.basename(normalizedProjectPath)}" (${currentGraph!.symbols.length} symbols)`);
      return currentGraph;
    } catch (err) {
      console.warn(`[store] Failed to load project:`, (err as Error).message);
    }
  }

  // Project not yet scanned — set as active but no graph
  currentGraph = null;
  currentProjectPath = normalizedProjectPath;
  const idx = loadProjectsIndex();
  idx.activeProject = normalizedProjectPath;
  saveProjectsIndex(idx);

  return null;
}

/** Remove a project from the index and delete its data */
export function deleteProject(projectPath: string): boolean {
  const normalizedProjectPath = path.resolve(projectPath);
  const idx = loadProjectsIndex();
  const hash = hashPath(normalizedProjectPath);
  const i = idx.projects.findIndex((p) => p.hash === hash);
  if (i === -1) return false;

  idx.projects.splice(i, 1);
  if (idx.activeProject === normalizedProjectPath) {
    idx.activeProject = idx.projects[0]?.projectPath ?? null;
  }
  saveProjectsIndex(idx);

  // Delete data directory
  const dir = projectDir(hash);
  const aiFile = path.join(dir, "ai-progress.json");
  if (fs.existsSync(aiFile)) {
    try { fs.unlinkSync(aiFile); } catch { /* ignore */ }
  }
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // If we deleted the current project, switch to another
  if (
    currentProjectPath &&
    comparableProjectPath(currentProjectPath) === comparableProjectPath(normalizedProjectPath)
  ) {
    if (idx.activeProject) {
      switchProject(idx.activeProject);
    } else {
      currentGraph = null;
      currentProjectPath = null;
    }
  }

  return true;
}

/* ── AI analysis progress persistence (per-project) ── */

export interface AiProgress {
  /** Set of symbol IDs that have been fully processed per phase */
  completedSymbols: {
    labels: string[];
    docs: string[];
    relations: string[];
    deadCode: string[];
    structure?: string[]; // ["done"] when structure review completed
  };
  /** Phase the analysis was in when interrupted */
  lastPhase: string;
  /** Stats at time of save */
  stats: Record<string, number>;
}

function aiProgressFile(): string | null {
  if (!currentProjectPath) return null;
  const hash = hashPath(currentProjectPath);
  return path.join(projectDir(hash), "ai-progress.json");
}

export function loadAiProgress(): AiProgress | null {
  const f = aiProgressFile();
  if (!f) return null;
  try {
    if (fs.existsSync(f)) {
      return JSON.parse(fs.readFileSync(f, "utf-8")) as AiProgress;
    }
  } catch { /* ignore */ }
  return null;
}

export function saveAiProgress(progress: AiProgress): void {
  const f = aiProgressFile();
  if (!f) return;
  const dir = path.dirname(f);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(f, JSON.stringify(progress), "utf-8");
  } catch (err) {
    console.error("[store] Failed to save AI progress:", (err as Error).message);
  }
}

export function clearAiProgress(): void {
  const f = aiProgressFile();
  if (!f) return;
  try {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch { /* ignore */ }
}

// Graceful shutdown: flush data
process.on("SIGINT", () => { flushGraph(); process.exit(0); });
process.on("SIGTERM", () => { flushGraph(); process.exit(0); });
