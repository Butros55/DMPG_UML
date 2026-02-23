import type { ProjectGraph } from "@dmpg/shared";

/**
 * In-memory graph store. In production this would be persisted to disk/DB.
 */
let currentGraph: ProjectGraph | null = null;

export function getGraph(): ProjectGraph | null {
  return currentGraph;
}

export function setGraph(g: ProjectGraph): void {
  currentGraph = g;
}
