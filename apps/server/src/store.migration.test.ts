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
  return {
    projectName: "legacy-project",
    projectPath: "C:\\temp\\legacy-project",
    rootViewId: "view:root",
    symbols: [
      {
        id: "grp:dir:__root__",
        label: "Data Pipeline",
        kind: "group",
        childViewId: "view:root",
      },
      {
        id: "grp:dir:connector",
        label: "connector",
        kind: "group",
        parentId: "grp:dir:__root__",
        childViewId: "view:grp:dir:connector",
      },
      {
        id: "mod:connector.druid_connector",
        label: "connector.druid_connector",
        kind: "module",
        parentId: "grp:dir:connector",
        childViewId: "view:mod:connector.druid_connector",
        location: { file: "connector/druid_connector.py", startLine: 1, endLine: 80 },
      },
      {
        id: "class:connector.druid_connector.DruidConnector",
        label: "DruidConnector",
        kind: "class",
        parentId: "mod:connector.druid_connector",
        childViewId: "view:class:connector.druid_connector.DruidConnector",
        location: { file: "connector/druid_connector.py", startLine: 10, endLine: 70 },
      },
      {
        id: "method:connector.druid_connector.DruidConnector.execute_query",
        label: "DruidConnector.execute_query",
        kind: "method",
        parentId: "class:connector.druid_connector.DruidConnector",
        location: { file: "connector/druid_connector.py", startLine: 42, endLine: 65 },
      },
      {
        id: "ext:input:auftrag",
        label: "20250608_Auftragsuebersicht.xlsx",
        kind: "external",
      },
      {
        id: "ext:output:distribution",
        label: "distribution.json",
        kind: "external",
      },
    ],
    relations: [
      {
        id: "rel:contains:root:connector",
        type: "contains",
        source: "grp:dir:__root__",
        target: "grp:dir:connector",
      },
      {
        id: "rel:contains:connector:module",
        type: "contains",
        source: "grp:dir:connector",
        target: "mod:connector.druid_connector",
      },
      {
        id: "rel:contains:module:class",
        type: "contains",
        source: "mod:connector.druid_connector",
        target: "class:connector.druid_connector.DruidConnector",
      },
      {
        id: "rel:contains:class:method",
        type: "contains",
        source: "class:connector.druid_connector.DruidConnector",
        target: "method:connector.druid_connector.DruidConnector.execute_query",
      },
      {
        id: "rel:reads:auftrag",
        type: "reads",
        source: "method:connector.druid_connector.DruidConnector.execute_query",
        target: "ext:input:auftrag",
        evidence: [{ file: "connector/druid_connector.py", startLine: 50 }],
      },
      {
        id: "rel:writes:distribution",
        type: "writes",
        source: "method:connector.druid_connector.DruidConnector.execute_query",
        target: "ext:output:distribution",
        evidence: [{ file: "connector/druid_connector.py", startLine: 58 }],
      },
    ],
    views: [
      {
        id: "view:root",
        title: "Data Pipeline - Overview",
        scope: "root",
        nodeRefs: ["grp:dir:connector", "ext:input:auftrag", "ext:output:distribution"],
        edgeRefs: ["rel:reads:auftrag", "rel:writes:distribution"],
      },
      {
        id: "view:grp:dir:connector",
        title: "connector",
        parentViewId: "view:root",
        scope: "group",
        nodeRefs: ["mod:connector.druid_connector"],
        edgeRefs: [],
      },
      {
        id: "view:mod:connector.druid_connector",
        title: "connector.druid_connector",
        parentViewId: "view:grp:dir:connector",
        scope: "module",
        nodeRefs: ["class:connector.druid_connector.DruidConnector"],
        edgeRefs: [],
      },
      {
        id: "view:class:connector.druid_connector.DruidConnector",
        title: "DruidConnector",
        parentViewId: "view:mod:connector.druid_connector",
        scope: "class",
        nodeRefs: ["method:connector.druid_connector.DruidConnector.execute_query"],
        edgeRefs: [],
      },
      {
        id: "view:artifacts:view:grp:dir:__root__",
        title: "Artifacts",
        parentViewId: "view:root",
        scope: "group",
        nodeRefs: ["ext:input:auftrag", "ext:output:distribution"],
        edgeRefs: [],
      },
      {
        id: "view:art-cat:misc:view:grp:dir:__root__",
        title: "Misc Artifacts",
        parentViewId: "view:artifacts:view:grp:dir:__root__",
        scope: "group",
        nodeRefs: ["ext:output:distribution"],
        edgeRefs: [],
      },
    ],
  };
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

test("switchProject persists an unscanned project selection", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-store-unscanned-"));
  try {
    const projectPath = path.join(dataDir, "NewProject");
    fs.mkdirSync(projectPath, { recursive: true });

    const store = await loadStoreModule(dataDir);
    const graph = store.switchProject(projectPath) as ProjectGraph | null;

    assert.equal(graph, null);
    assert.equal(store.getActiveProjectPath(), projectPath);
    assert.equal(store.getCurrentProjectPath(), projectPath);
    assert.deepEqual(store.listProjects(), [
      {
        projectPath,
        name: "NewProject",
        symbolCount: 0,
        lastScanned: "",
        hash: hashPath(projectPath),
      },
    ]);

    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "projects-meta.json"), "utf8")) as {
      activeProject: string;
      projects: Array<{ projectPath: string; symbolCount: number; lastScanned: string }>;
    };
    assert.equal(meta.activeProject, projectPath);
    assert.equal(meta.projects[0]?.projectPath, projectPath);
    assert.equal(meta.projects[0]?.symbolCount, 0);
    assert.equal(meta.projects[0]?.lastScanned, "");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("active project metadata is repaired when older metadata only stored activeProject", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-store-active-only-"));
  try {
    const projectPath = path.join(dataDir, "ActiveOnly");
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "projects-meta.json"),
      JSON.stringify({ activeProject: projectPath, projects: [] }),
      "utf8",
    );

    const store = await loadStoreModule(dataDir);

    assert.equal(store.getActiveProjectPath(), projectPath);
    assert.deepEqual(store.listProjects(), [
      {
        projectPath,
        name: "ActiveOnly",
        symbolCount: 0,
        lastScanned: "",
        hash: hashPath(projectPath),
      },
    ]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("deleteProject removes persisted data and activates the next project", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-store-delete-"));
  try {
    const projectAPath = path.join(dataDir, "ProjectA");
    const projectBPath = path.join(dataDir, "ProjectB");
    const graphA = { ...loadLegacyGraph(), projectName: "ProjectA", projectPath: projectAPath };
    const graphB = { ...loadLegacyGraph(), projectName: "ProjectB", projectPath: projectBPath };
    const hashA = hashPath(projectAPath);
    const hashB = hashPath(projectBPath);
    const projectADir = path.join(dataDir, "projects", hashA);
    const projectBDir = path.join(dataDir, "projects", hashB);
    fs.mkdirSync(projectADir, { recursive: true });
    fs.mkdirSync(projectBDir, { recursive: true });
    fs.writeFileSync(path.join(projectADir, "graph.json"), JSON.stringify(graphA), "utf8");
    fs.writeFileSync(path.join(projectBDir, "graph.json"), JSON.stringify(graphB), "utf8");
    fs.writeFileSync(
      path.join(dataDir, "projects-meta.json"),
      JSON.stringify({
        activeProject: projectAPath,
        projects: [
          {
            projectPath: projectAPath,
            name: "ProjectA",
            symbolCount: graphA.symbols.length,
            lastScanned: "2026-03-01T12:00:00.000Z",
            hash: hashA,
          },
          {
            projectPath: projectBPath,
            name: "ProjectB",
            symbolCount: graphB.symbols.length,
            lastScanned: "2026-03-02T12:00:00.000Z",
            hash: hashB,
          },
        ],
      }),
      "utf8",
    );

    const store = await loadStoreModule(dataDir);
    const deleted = store.deleteProject(projectAPath.replace(/\\/g, "/"));

    assert.equal(deleted, true);
    assert.equal(fs.existsSync(projectADir), false);
    assert.equal(store.getActiveProjectPath(), projectBPath);
    assert.equal((store.getGraph() as ProjectGraph | null)?.projectName, "ProjectB");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
