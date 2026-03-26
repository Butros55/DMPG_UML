type MockGraph = {
  symbols: Array<{
    id: string;
    label: string;
    kind: string;
    umlType?: string;
    parentId?: string;
    childViewId?: string;
    location?: { file: string; startLine?: number; endLine?: number };
    doc?: { summary?: string };
  }>;
  relations: Array<{
    id: string;
    type: "imports" | "contains" | "calls" | "reads" | "writes" | "inherits" | "uses_config" | "instantiates";
    source: string;
    target: string;
    label?: string;
    confidence?: number;
    evidence?: Array<{ file: string; startLine?: number; endLine?: number; snippet?: string }>;
  }>;
  views: Array<{
    id: string;
    title: string;
    parentViewId?: string | null;
    scope?: "root" | "group" | "module" | "class";
    nodeRefs: string[];
    edgeRefs: string[];
  }>;
  rootViewId: string;
  projectName: string;
  projectPath: string;
  sourceProjectPath: string;
};

export function createSequenceGraph(): MockGraph {
  const projectPath = "C:\\fixtures\\sequence-project";
  const rootViewId = "view:sequence";

  return {
    projectName: "Sequence Fixture",
    projectPath,
    sourceProjectPath: projectPath,
    rootViewId,
    symbols: [
      {
        id: "participant:digital-zwilling",
        label: "Digitaler Zwilling",
        kind: "external",
        umlType: "component",
        location: { file: "src/digital_zwilling.py", startLine: 12, endLine: 84 },
        doc: { summary: "Koordiniert den Start des Sequenzflusses." },
      },
      {
        id: "participant:apache-druid",
        label: "Apache Druid",
        kind: "external",
        umlType: "database",
        location: { file: "src/adapters/druid.py", startLine: 8, endLine: 77 },
        doc: { summary: "Speichert und liefert die geladenen Daten." },
      },
      {
        id: "participant:apache-kafka",
        label: "Apache Kafka",
        kind: "external",
        umlType: "component",
        location: { file: "src/adapters/kafka.py", startLine: 9, endLine: 71 },
        doc: { summary: "Verteilt Meldungen an die nachgelagerten Teilnehmer." },
      },
      {
        id: "participant:protocol-bridge",
        label: "Protocol Bridge",
        kind: "module",
        umlType: "package",
        location: { file: "src/protocol_bridge.py", startLine: 20, endLine: 113 },
        doc: { summary: "Transformiert eingehende Nachrichten in interne Ereignisse." },
      },
    ],
    relations: [
      {
        id: "rel:generate-sim-data",
        type: "calls",
        source: "participant:digital-zwilling",
        target: "participant:apache-druid",
        label: "generate sim data",
        confidence: 1,
        evidence: [{ file: "src/digital_zwilling.py", startLine: 21, endLine: 24, snippet: "generate_sim_data()" }],
      },
      {
        id: "rel:return-sim-data",
        type: "calls",
        source: "participant:apache-druid",
        target: "participant:digital-zwilling",
        label: "return",
        confidence: 1,
        evidence: [{ file: "src/adapters/druid.py", startLine: 44, endLine: 49, snippet: "return snapshot" }],
      },
      {
        id: "rel:subscribe",
        type: "calls",
        source: "participant:digital-zwilling",
        target: "participant:apache-kafka",
        label: "subscribe",
        confidence: 1,
        evidence: [{ file: "src/digital_zwilling.py", startLine: 30, endLine: 34, snippet: "subscribe(topic)" }],
      },
      {
        id: "rel:receive-snapshot",
        type: "reads",
        source: "participant:protocol-bridge",
        target: "participant:apache-kafka",
        label: "receive snapshot",
        confidence: 1,
        evidence: [{ file: "src/protocol_bridge.py", startLine: 52, endLine: 60, snippet: "receive_snapshot()" }],
      },
      {
        id: "rel:create-schedule",
        type: "calls",
        source: "participant:protocol-bridge",
        target: "participant:protocol-bridge",
        label: "create schedule",
        confidence: 1,
        evidence: [{ file: "src/protocol_bridge.py", startLine: 63, endLine: 68, snippet: "create_schedule()" }],
      },
      {
        id: "rel:publish-schedule",
        type: "writes",
        source: "participant:protocol-bridge",
        target: "participant:apache-kafka",
        label: "publish schedule",
        confidence: 1,
        evidence: [{ file: "src/protocol_bridge.py", startLine: 70, endLine: 80, snippet: "publish_schedule()" }],
      },
    ],
    views: [
      {
        id: rootViewId,
        title: "Transformation",
        parentViewId: "view:root",
        scope: "group",
        nodeRefs: [
          "participant:digital-zwilling",
          "participant:apache-druid",
          "participant:apache-kafka",
          "participant:protocol-bridge",
        ],
        edgeRefs: [
          "rel:generate-sim-data",
          "rel:return-sim-data",
          "rel:subscribe",
          "rel:receive-snapshot",
          "rel:create-schedule",
          "rel:publish-schedule",
        ],
      },
    ],
  };
}

export function installMockApiRoutes(
  page: import("@playwright/test").Page,
  graph: MockGraph,
): Promise<void> {
  return page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    if (method === "GET" && path === "/api/config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          scanProjectPath: graph.projectPath,
          aiProvider: "cloud",
          ollamaModel: "",
        },
      });
      return;
    }

    if (method === "GET" && path === "/api/projects") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          projects: [
            {
              projectPath: graph.projectPath,
              name: graph.projectName,
              symbolCount: graph.symbols.length,
              lastScanned: "2026-03-26T08:00:00.000Z",
              hash: "fixture-hash",
            },
          ],
          activeProject: graph.projectPath,
        },
      });
      return;
    }

    if (method === "POST" && path === "/api/projects/switch") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          ok: true,
          graph,
          projectPath: graph.projectPath,
        },
      });
      return;
    }

    if (method === "GET" && path === "/api/graph") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: graph,
      });
      return;
    }

    if (method === "PUT" && path === "/api/graph") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          graph,
        },
      });
      return;
    }

    if (method === "POST" && path === "/api/open-in-ide") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { ok: true },
      });
      return;
    }

    if (path.startsWith("/api/scan/browse")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          current: graph.projectPath,
          parent: null,
          folders: [],
        },
      });
      return;
    }

    if (path === "/api/scan" && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { graph },
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {},
    });
  });
}
