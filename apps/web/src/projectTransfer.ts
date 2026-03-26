import {
  ProjectGraphSchema,
  ProjectPackageSchema,
  type ProjectGraph,
  type ProjectPackage,
} from "@dmpg/shared";

export const PROJECT_PACKAGE_EXTENSION = ".dmpg-uml.json";

function projectNameFromGraph(graph: Pick<ProjectGraph, "projectName" | "projectPath">): string {
  const explicit = graph.projectName?.trim();
  if (explicit) return explicit;

  const projectPath = graph.projectPath?.trim();
  if (projectPath) {
    const normalized = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const parts = normalized.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }

  return "uml-project";
}

function sanitizeFileStem(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "uml-project";
}

function stripPackageExtension(fileName: string): string {
  return fileName
    .replace(/\.dmpg-uml\.json$/i, "")
    .replace(/\.json$/i, "")
    .trim();
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function simpleHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildImportedProjectPath(projectName: string, discriminator: string): string {
  const stem = sanitizeFileStem(projectName);
  const suffix = simpleHash(discriminator).slice(0, 8);
  return `imported/${stem}-${suffix}`;
}

function assertRootViewExists(graph: ProjectGraph): void {
  if (graph.views.some((view) => view.id === graph.rootViewId)) return;
  throw new Error("Das Projektpaket ist ungueltig: rootViewId verweist auf keine vorhandene View.");
}

function toImportedGraph(
  graph: ProjectGraph,
  projectName: string,
  sourceProjectPath: string | undefined,
  discriminator: string,
): ProjectGraph {
  const normalizedName = projectName.trim() || projectNameFromGraph(graph);
  const importedGraph: ProjectGraph = {
    ...graph,
    projectName: normalizedName,
    projectPath: buildImportedProjectPath(normalizedName, discriminator),
    sourceProjectPath: sourceProjectPath?.trim() || graph.sourceProjectPath?.trim() || graph.projectPath?.trim(),
  };

  assertRootViewExists(importedGraph);
  return importedGraph;
}

export function buildProjectPackage(graph: ProjectGraph): ProjectPackage {
  const projectName = projectNameFromGraph(graph);
  return {
    format: "dmpg-uml-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      name: projectName,
      sourceProjectPath: graph.sourceProjectPath ?? graph.projectPath,
      graph,
    },
  };
}

export function exportProjectPackage(graph: ProjectGraph): void {
  const projectPackage = buildProjectPackage(graph);
  const fileName = `${sanitizeFileStem(projectPackage.project.name)}${PROJECT_PACKAGE_EXTENSION}`;
  downloadJson(fileName, projectPackage);
}

export async function importProjectPackageFile(file: File): Promise<ProjectGraph> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("Die Projektdatei ist kein gueltiges JSON.");
  }

  const packageResult = ProjectPackageSchema.safeParse(parsedJson);
  if (packageResult.success) {
    const projectPackage = packageResult.data;
    return toImportedGraph(
      projectPackage.project.graph,
      projectPackage.project.name,
      projectPackage.project.sourceProjectPath,
      `${projectPackage.project.name}|${projectPackage.exportedAt}|${file.name}`,
    );
  }

  const graphResult = ProjectGraphSchema.safeParse(parsedJson);
  if (graphResult.success) {
    const graph = graphResult.data;
    const fallbackName = stripPackageExtension(file.name) || projectNameFromGraph(graph);
    return toImportedGraph(
      graph,
      fallbackName,
      graph.sourceProjectPath ?? graph.projectPath,
      `${file.name}|${graph.projectPath ?? ""}|${graph.symbols.length}|${graph.relations.length}`,
    );
  }

  throw new Error("Die Datei enthaelt kein gueltiges DMPG-UML-Projektpaket.");
}
