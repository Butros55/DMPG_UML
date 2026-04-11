type MockGraph = {
  symbols: Array<{
    id: string;
    label: string;
    kind: string;
    umlType?: string;
    parentId?: string;
    childViewId?: string;
    location?: { file: string; startLine?: number; endLine?: number };
    doc?: {
      summary?: string;
      inputs?: Array<{ name: string; type?: string }>;
      outputs?: Array<{ name: string; type?: string }>;
    };
  }>;
  relations: Array<{
    id: string;
    type:
      | "imports"
      | "contains"
      | "calls"
      | "reads"
      | "writes"
      | "inherits"
      | "uses_config"
      | "instantiates"
      | "association"
      | "aggregation"
      | "composition";
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
    diagramType?: "overview" | "class" | "sequence";
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
  const rootViewId = "view:process-overview";

  return {
    projectName: "Sequence Fixture",
    projectPath,
    sourceProjectPath: projectPath,
    rootViewId,
    symbols: [
      {
        id: "proc:pkg:transform",
        label: "Transformation",
        kind: "group",
        umlType: "package",
        childViewId: "view:process-stage:transform",
        doc: { summary: "Fachlicher Prozessschritt." },
      },
      {
        id: "class:pipeline-controller",
        label: "PipelineController",
        kind: "class",
        location: { file: "src/pipeline_controller.py", startLine: 4, endLine: 98 },
        doc: { summary: "Koordiniert die Teilnehmer im Sequenzfluss." },
      },
      {
        id: "class:pipeline-controller.repository",
        label: "PipelineController.repository",
        kind: "variable",
        parentId: "class:pipeline-controller",
        location: { file: "src/pipeline_controller.py", startLine: 8, endLine: 8 },
        doc: { summary: "Repository-Referenz.", inputs: [{ name: "repository", type: "Repository" }] },
      },
      {
        id: "class:pipeline-controller.builder",
        label: "PipelineController.builder",
        kind: "variable",
        parentId: "class:pipeline-controller",
        location: { file: "src/pipeline_controller.py", startLine: 9, endLine: 9 },
        doc: { summary: "Erzeugt Ablaufpläne.", inputs: [{ name: "builder", type: "ScheduleBuilder" }] },
      },
      {
        id: "class:pipeline-controller.run",
        label: "PipelineController.run",
        kind: "method",
        parentId: "class:pipeline-controller",
        location: { file: "src/pipeline_controller.py", startLine: 21, endLine: 34 },
        doc: {
          summary: "Startet den Verarbeitungslauf.",
          inputs: [{ name: "payload", type: "Payload" }],
          outputs: [{ name: "return", type: "JobResult" }],
        },
      },
      {
        id: "class:base-controller",
        label: "BaseController",
        kind: "class",
        location: { file: "src/base_controller.py", startLine: 2, endLine: 16 },
        doc: { summary: "Gemeinsame Basis für Controller." },
      },
      {
        id: "class:base-controller.execute",
        label: "BaseController.execute",
        kind: "method",
        parentId: "class:base-controller",
        location: { file: "src/base_controller.py", startLine: 7, endLine: 12 },
        doc: { summary: "Basisschnittstelle.", outputs: [{ name: "return", type: "JobResult" }] },
      },
      {
        id: "class:repository",
        label: "Repository",
        kind: "class",
        location: { file: "src/repository.py", startLine: 3, endLine: 27 },
        doc: { summary: "Lädt und speichert Prozesszustand." },
      },
      {
        id: "class:repository.fetch",
        label: "Repository.fetch",
        kind: "method",
        parentId: "class:repository",
        location: { file: "src/repository.py", startLine: 10, endLine: 16 },
        doc: { summary: "Lädt ein Ergebnis.", outputs: [{ name: "return", type: "JobResult" }] },
      },
      {
        id: "class:schedule-builder",
        label: "ScheduleBuilder",
        kind: "class",
        location: { file: "src/schedule_builder.py", startLine: 5, endLine: 30 },
        doc: { summary: "Erstellt Ablaufpläne für die Verarbeitung." },
      },
      {
        id: "class:schedule-builder.build",
        label: "ScheduleBuilder.build",
        kind: "method",
        parentId: "class:schedule-builder",
        location: { file: "src/schedule_builder.py", startLine: 12, endLine: 19 },
        doc: { summary: "Baut einen Plan.", outputs: [{ name: "return", type: "JobResult" }] },
      },
      {
        id: "class:job-result",
        label: "JobResult",
        kind: "class",
        location: { file: "src/job_result.py", startLine: 4, endLine: 18 },
        doc: { summary: "Domänenobjekt für ein Verarbeitungsergebnis." },
      },
      {
        id: "proc:stage-sequence-nav:transform",
        label: "Sequence Diagram",
        kind: "external",
        umlType: "note",
        childViewId: "view:sequence",
        doc: { summary: "Static interaction projection" },
      },
      {
        id: "participant:digital-zwilling",
        label: "Digitaler Zwilling",
        kind: "module",
        location: { file: "src/digital_zwilling.py", startLine: 12, endLine: 84 },
        doc: { summary: "Koordiniert den Start des Sequenzflusses." },
      },
      {
        id: "participant:apache-druid",
        label: "Apache Druid",
        kind: "module",
        umlType: "database",
        location: { file: "src/adapters/druid.py", startLine: 8, endLine: 77 },
        doc: { summary: "Speichert und liefert die geladenen Daten." },
      },
      {
        id: "participant:apache-kafka",
        label: "Apache Kafka",
        kind: "module",
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
        id: "rel:controller-inherits",
        type: "inherits",
        source: "class:pipeline-controller",
        target: "class:base-controller",
        label: "extends",
        confidence: 1,
      },
      {
        id: "rel:controller-repository",
        type: "association",
        source: "class:pipeline-controller",
        target: "class:repository",
        label: "repository",
        confidence: 1,
      },
      {
        id: "rel:controller-builder",
        type: "composition",
        source: "class:pipeline-controller",
        target: "class:schedule-builder",
        label: "builder",
        confidence: 1,
      },
      {
        id: "rel:controller-result",
        type: "association",
        source: "class:pipeline-controller",
        target: "class:job-result",
        label: "run",
        confidence: 1,
      },
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
        title: "Process Overview",
        parentViewId: null,
        scope: "root",
        diagramType: "overview",
        nodeRefs: ["proc:pkg:transform"],
        edgeRefs: [],
      },
      {
        id: "view:process-stage:transform",
        title: "Transformation",
        parentViewId: rootViewId,
        scope: "group",
        diagramType: "class",
        nodeRefs: [
          "proc:stage-sequence-nav:transform",
          "class:pipeline-controller",
          "class:base-controller",
          "class:repository",
          "class:schedule-builder",
          "class:job-result",
        ],
        edgeRefs: [
          "rel:controller-inherits",
          "rel:controller-repository",
          "rel:controller-builder",
          "rel:controller-result",
        ],
      },
      {
        id: "view:sequence",
        title: "PipelineController",
        parentViewId: "view:process-stage:transform",
        scope: "group",
        diagramType: "sequence",
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
