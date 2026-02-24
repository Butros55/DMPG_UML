import type { ProjectGraph } from "@dmpg/shared";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Persistent graph store. Saves to disk (JSON) with debounced writes.
 * Automatically loads persisted data on startup.
 */

const DATA_DIR = path.resolve(process.env.DMPG_DATA_DIR ?? path.join(process.cwd(), ".dmpg-data"));
const GRAPH_FILE = path.join(DATA_DIR, "graph.json");
const AI_PROGRESS_FILE = path.join(DATA_DIR, "ai-progress.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let currentGraph: ProjectGraph | null = null;

// Auto-load persisted graph on startup
try {
  if (fs.existsSync(GRAPH_FILE)) {
    const raw = fs.readFileSync(GRAPH_FILE, "utf-8");
    currentGraph = JSON.parse(raw) as ProjectGraph;
    console.log(`[store] Loaded persisted graph from ${GRAPH_FILE} (${currentGraph.symbols.length} symbols)`);
  }
} catch (err) {
  console.warn("[store] Failed to load persisted graph:", (err as Error).message);
}

export function getGraph(): ProjectGraph | null {
  return currentGraph;
}

// Debounced disk write (300ms)
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistToDisk() {
  if (!currentGraph) return;
  try {
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(currentGraph), "utf-8");
  } catch (err) {
    console.error("[store] Failed to persist graph:", (err as Error).message);
  }
}

export function setGraph(g: ProjectGraph): void {
  currentGraph = g;
  // Debounce: coalesce rapid successive writes
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistToDisk, 300);
}

/** Force immediate save (e.g. on graceful shutdown) */
export function flushGraph(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  persistToDisk();
}

/* ── AI analysis progress persistence ──────────── */

export interface AiProgress {
  /** Set of symbol IDs that have been fully processed per phase */
  completedSymbols: {
    labels: string[];
    docs: string[];
    relations: string[];
    deadCode: string[];
  };
  /** Phase the analysis was in when interrupted */
  lastPhase: string;
  /** Stats at time of save */
  stats: Record<string, number>;
}

export function loadAiProgress(): AiProgress | null {
  try {
    if (fs.existsSync(AI_PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(AI_PROGRESS_FILE, "utf-8")) as AiProgress;
    }
  } catch { /* ignore */ }
  return null;
}

export function saveAiProgress(progress: AiProgress): void {
  try {
    fs.writeFileSync(AI_PROGRESS_FILE, JSON.stringify(progress), "utf-8");
  } catch (err) {
    console.error("[store] Failed to save AI progress:", (err as Error).message);
  }
}

export function clearAiProgress(): void {
  try {
    if (fs.existsSync(AI_PROGRESS_FILE)) fs.unlinkSync(AI_PROGRESS_FILE);
  } catch { /* ignore */ }
}

// Graceful shutdown: flush data
process.on("SIGINT", () => { flushGraph(); process.exit(0); });
process.on("SIGTERM", () => { flushGraph(); process.exit(0); });
