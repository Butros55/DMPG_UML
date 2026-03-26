import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import type { ProjectGraph } from "@dmpg/shared";

function cloneGraph<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hashPath(projectPath: string): string {
  return crypto.createHash("sha256").update(projectPath.toLowerCase().replace(/\\/g, "/")).digest("hex").slice(0, 12);
}

function loadLegacyGraph(): ProjectGraph {
  const packagePath = path.resolve(import.meta.dirname, "../../../output/data_pipeline.dmpg-uml.json");
  const raw = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    project: { graph: ProjectGraph };
  };
  return cloneGraph(raw.project.graph);
}

async function loadStoreModule(dataDir: string) {
  const previousDataDir = process.env.DMPG_DATA_DIR;
  process.env.DMPG_DATA_DIR = dataDir;
  try {
    const storeUrl = `${pathToFileURL(path.resolve(import.meta.dirname, "./store.ts")).href}?test=${Date.now()}-${Math.random()}`;
    return await import(storeUrl);
  } finally {
    if (previousDataDir == null) {
      delete process.env.DMPG_DATA_DIR;
    } else {
      process.env.DMPG_DATA_DIR = previousDataDir;
    }
  }
}

function writePersistedProject(dataDir: string, graph: ProjectGraph, options?: { active?: boolean }) {
  const projectPath = graph.projectPath ?? "C:\\temp\\legacy-project";
  const hash = hashPath(projectPath);
  const projectDir = path.join(dataDir, "projects", hash);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "graph.json"), JSON.stringify(graph), "utf8");
  fs.writeFileSync(
    path.join(dataDir, "projects-meta.json"),
    JSON.stringify({
      activeProject: options?.active === false ? null : projectPath,
      projects: [
        {
          projectPath,
          name: graph.projectName ?? "legacy-project",
          symbolCount: graph.symbols.length,
          lastScanned: "2026-03-01T12:00:00.000Z",
          hash,
        },
      ],
    }),
    "utf8",
  );
  return { projectPath, graphPath: path.join(projectDir, "graph.json") };
}

function assertMigratedGraph(graph: ProjectGraph | null) {
  assert.ok(graph);
  assert.equal(graph?.views.find((view) => view.id === "view:root")?.hiddenInSidebar, true);
  assert.equal(graph?.views.find((view) => view.id === "view:artifacts:view:grp:dir:__root__")?.hiddenInSidebar, true);
  assert.equal(graph?.views.find((view) => view.id === "view:art-cat:misc:view:grp:dir:__root__")?.hiddenInSidebar, true);
  assert.equal(graph?.views.find((view) => view.id === "view:process-stage:inputs")?.hiddenInSidebar, false);
}

test("normalizePersistedGraph is idempotent for already migrated graphs", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-store-idempotent-"));
  try {
    const store = await loadStoreModule(dataDir);
    const legacyGraph = loadLegacyGraph();

    const first = store.normalizePersistedGraph(cloneGraph(legacyGraph));
    const second = store.normalizePersistedGraph(cloneGraph(first.graph));

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(
      second.graph.symbols.filter((symbol: { id: string }) => symbol.id.startsWith("proc:")).length,
      first.graph.symbols.filter((symbol: { id: string }) => symbol.id.startsWith("proc:")).length,
    );
    assert.equal(
      second.graph.symbols.filter((symbol: { id: string }) => symbol.id.startsWith("stub:")).length,
      first.graph.symbols.filter((symbol: { id: string }) => symbol.id.startsWith("stub:")).length,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("startup load re-normalizes and persists an old active graph", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-store-load-"));
  try {
    const legacyGraph = loadLegacyGraph();
    const { graphPath } = writePersistedProject(dataDir, legacyGraph);

    const store = await loadStoreModule(dataDir);
    const loadedGraph = store.getGraph() as ProjectGraph | null;

    assertMigratedGraph(loadedGraph);

    const persistedGraph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as ProjectGraph;
    assertMigratedGraph(persistedGraph);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("switchProject re-normalizes and persists an old graph on demand", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-store-switch-"));
  try {
    const legacyGraph = loadLegacyGraph();
    const { projectPath, graphPath } = writePersistedProject(dataDir, legacyGraph, { active: false });

    const store = await loadStoreModule(dataDir);
    const switchedGraph = store.switchProject(projectPath) as ProjectGraph | null;

    assertMigratedGraph(switchedGraph);

    const persistedGraph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as ProjectGraph;
    assertMigratedGraph(persistedGraph);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
