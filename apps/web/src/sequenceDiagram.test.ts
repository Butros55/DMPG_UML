import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph, RelationType } from "@dmpg/shared";

import { buildPackageSequenceDiagramDetails } from "./sequenceDiagram.js";

function createRelationFilters(): Record<RelationType, boolean> {
  return {
    imports: true,
    contains: true,
    calls: true,
    reads: true,
    writes: true,
    inherits: true,
    realizes: true,
    dependency: true,
    uses_config: true,
    instantiates: true,
    association: true,
    aggregation: true,
    composition: true,
  };
}

test("buildPackageSequenceDiagramDetails keeps sync and async calls separate and only adds responses for sync", () => {
  const graph: ProjectGraph = {
    symbols: [
      { id: "sym:controller", label: "Controller", kind: "function" },
      { id: "sym:worker", label: "Worker", kind: "function", tags: ["async"] },
    ],
    relations: [
      {
        id: "rel:sync",
        type: "calls",
        source: "sym:controller",
        target: "sym:worker",
        evidence: [{ file: "pipeline.py", startLine: 10, callKind: "sync" }],
      },
      {
        id: "rel:async",
        type: "calls",
        source: "sym:controller",
        target: "sym:worker",
        evidence: [{ file: "pipeline.py", startLine: 20, callKind: "async" }],
      },
    ],
    views: [
      {
        id: "view:process-overview",
        title: "Overview",
        scope: "root",
        diagramType: "class",
        nodeRefs: ["sym:controller", "sym:worker"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:process-overview",
  };

  const details = buildPackageSequenceDiagramDetails({
    graph,
    view: graph.views[0]!,
    visibleViewNodeRefs: ["sym:controller", "sym:worker"],
    hiddenSymbolIds: new Set<string>(),
    symbolOverrides: new Map(),
    relationFilters: createRelationFilters(),
    labelsMode: "compact",
    selectedSymbolId: null,
    selectedEdgeId: null,
  });

  const edgeIds = new Set(details.edges.map((edge) => edge.id));
  assert.ok(edgeIds.has("rel:sync"));
  assert.ok(edgeIds.has("rel:sync:response"));
  assert.ok(edgeIds.has("rel:async"));
  assert.ok(!edgeIds.has("rel:async:response"));

  const syncEdge = details.edges.find((edge) => edge.id === "rel:sync");
  const asyncEdge = details.edges.find((edge) => edge.id === "rel:async");
  assert.equal(syncEdge?.data?.sequenceKind, "sync");
  assert.equal(asyncEdge?.data?.sequenceKind, "async");
  assert.equal(details.projection.usedMessages, 2);
});

function buildDetails(graph: ProjectGraph, view = graph.views[0]!, sequenceMode: "code" | "artifact" | "full" = "code") {
  return buildPackageSequenceDiagramDetails({
    graph,
    view,
    visibleViewNodeRefs: view.nodeRefs,
    hiddenSymbolIds: new Set<string>(),
    symbolOverrides: new Map(),
    relationFilters: createRelationFilters(),
    labelsMode: "compact",
    sequenceMode,
    selectedSymbolId: null,
    selectedEdgeId: null,
  });
}

function createStageSequenceGraph(extraRelations: ProjectGraph["relations"] = []): ProjectGraph {
  return {
    symbols: [
      {
        id: "proc:pkg:extract",
        label: "Extraction & Preprocessing",
        kind: "group",
        umlType: "package",
        childViewId: "view:process-stage:extract",
      },
      { id: "mod:data_extraction", label: "data_extraction", kind: "module" },
      { id: "mod:data_extraction:DataExtraction", label: "DataExtraction", kind: "class", parentId: "mod:data_extraction" },
      {
        id: "mod:data_extraction:DataExtraction.get_data",
        label: "DataExtraction.get_data",
        kind: "method",
        parentId: "mod:data_extraction:DataExtraction",
        location: { file: "data_extraction.py", startLine: 1 },
      },
      {
        id: "mod:data_extraction:DataExtraction._normalize_timestamps",
        label: "DataExtraction._normalize_timestamps",
        kind: "method",
        parentId: "mod:data_extraction:DataExtraction",
        location: { file: "data_extraction.py", startLine: 50 },
      },
      { id: "mod:druid_connector", label: "druid_connector", kind: "module" },
      { id: "mod:druid_connector:DruidConnector", label: "DruidConnector", kind: "class", parentId: "mod:druid_connector" },
      {
        id: "mod:druid_connector:DruidConnector.query",
        label: "DruidConnector.query",
        kind: "method",
        parentId: "mod:druid_connector:DruidConnector",
        location: { file: "druid_connector.py", startLine: 12 },
      },
      { id: "ext:Wegrezept.csv", label: "Wegrezept.csv", kind: "external", umlType: "artifact" },
      { id: "ext:df_data.csv", label: "df_data.csv", kind: "external", umlType: "artifact" },
      { id: "ext:pd.to_timedelta", label: "pd.to_timedelta", kind: "external" },
      { id: "ext:df", label: "df", kind: "external" },
      { id: "ext:range", label: "range", kind: "external" },
      { id: "ext:datetime", label: "datetime", kind: "external" },
    ],
    relations: [
      {
        id: "rel:query",
        type: "calls",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "mod:druid_connector:DruidConnector.query",
        evidence: [{ file: "data_extraction.py", startLine: 10, callKind: "sync" }],
      },
      {
        id: "rel:read-recipe",
        type: "reads",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "ext:Wegrezept.csv",
        evidence: [{ file: "data_extraction.py", startLine: 20, messageKind: "read" }],
      },
      {
        id: "rel:normalize",
        type: "calls",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "mod:data_extraction:DataExtraction._normalize_timestamps",
        evidence: [{ file: "data_extraction.py", startLine: 30, callKind: "sync" }],
      },
      {
        id: "rel:write-df",
        type: "writes",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "ext:df_data.csv",
        evidence: [{ file: "data_extraction.py", startLine: 40, messageKind: "write" }],
      },
      ...extraRelations,
    ],
    views: [
      {
        id: "view:process-stage:extract",
        title: "Extraction & Preprocessing",
        scope: "group",
        diagramType: "class",
        nodeRefs: ["mod:data_extraction:DataExtraction"],
        edgeRefs: [],
        parentViewId: "view:process-overview",
      },
    ],
    rootViewId: "view:process-stage:extract",
  };
}

test("buildPackageSequenceDiagramDetails builds focused stage sequence from entrypoint", () => {
  const graph = createStageSequenceGraph();
  const details = buildDetails(graph);
  const participantLabels = new Set([...details.participants.values()].map((participant) => participant.label));

  assert.ok(participantLabels.has("Extraction & Preprocessing Actor"));
  assert.ok(participantLabels.has("DataExtraction"));
  assert.ok(participantLabels.has("DruidConnector"));
  assert.ok(participantLabels.has("Wegrezept.csv"));
  assert.ok(participantLabels.has("df_data.csv"));
  assert.ok(!participantLabels.has("pd"));
  assert.ok(!participantLabels.has("df"));
  assert.ok(!participantLabels.has("range"));

  const labels = [...details.messages.values()].map((message) => message.label);
  assert.deepEqual(labels, [
    "get_data()",
    "query(...)",
    "read Wegrezept.csv",
    "_normalize_timestamps()",
    "write df_data.csv",
  ]);

  const normalizeMessage = [...details.messages.values()].find((message) => message.label === "_normalize_timestamps()");
  assert.equal(normalizeMessage?.kind, "self");
  assert.equal(details.projection.sequenceMode, "code");
});

test("buildPackageSequenceDiagramDetails filters generic library noise", () => {
  const graph = createStageSequenceGraph([
    {
      id: "rel:pd-timedelta",
      type: "calls",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "ext:pd.to_timedelta",
      evidence: [{ file: "data_extraction.py", startLine: 11, callKind: "sync" }],
    },
    {
      id: "rel:df",
      type: "calls",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "ext:df",
      evidence: [{ file: "data_extraction.py", startLine: 12, callKind: "sync" }],
    },
    {
      id: "rel:range",
      type: "calls",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "ext:range",
      evidence: [{ file: "data_extraction.py", startLine: 13, callKind: "sync" }],
    },
    {
      id: "rel:datetime",
      type: "calls",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "ext:datetime",
      evidence: [{ file: "data_extraction.py", startLine: 14, callKind: "sync" }],
    },
  ]);

  const details = buildDetails(graph);
  const labels = [...details.messages.values()].map((message) => message.label ?? "").join(" ");
  const participantLabels = [...details.participants.values()].map((participant) => participant.label);

  assert.doesNotMatch(labels, /pd\.to_timedelta|Run df|Run range|datetime/);
  assert.ok(!participantLabels.includes("pd.to_timedelta"));
  assert.ok(!participantLabels.includes("df"));
  assert.ok(!participantLabels.includes("range"));
  assert.ok(!participantLabels.includes("datetime"));
});

test("buildPackageSequenceDiagramDetails renders create messages", () => {
  const graph = createStageSequenceGraph([
    {
      id: "rel:create-druid",
      type: "instantiates",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "mod:druid_connector:DruidConnector",
      evidence: [{ file: "data_extraction.py", startLine: 5, sequenceIndex: 0, messageKind: "create", callKind: "sync" }],
    },
  ]);

  const details = buildDetails(graph);
  const createMessage = [...details.messages.values()].find((message) => message.label === "create DruidConnector");
  assert.equal(createMessage?.kind, "create");
});

test("buildPackageSequenceDiagramDetails keeps artifact flow separate from default code flow", () => {
  const graph: ProjectGraph = {
    symbols: [
      {
        id: "proc:pkg:extract",
        label: "Extraction & Preprocessing",
        kind: "group",
        umlType: "package",
        childViewId: "view:process-stage:extract",
      },
      { id: "sym:producer", label: "Producer.generate", kind: "function" },
      { id: "sym:consumer", label: "Consumer.load", kind: "function" },
      { id: "ext:df_data.csv", label: "df_data.csv", kind: "external", umlType: "artifact" },
      { id: "ext:pd.to_timedelta", label: "pd.to_timedelta", kind: "external" },
    ],
    relations: [
      {
        id: "rel:write-artifact",
        type: "writes",
        source: "sym:producer",
        target: "ext:df_data.csv",
        evidence: [{ file: "producer.py", startLine: 10, messageKind: "write" }],
      },
      {
        id: "rel:read-artifact",
        type: "reads",
        source: "sym:consumer",
        target: "ext:df_data.csv",
        evidence: [{ file: "consumer.py", startLine: 20, messageKind: "read" }],
      },
      {
        id: "rel:noise",
        type: "calls",
        source: "sym:producer",
        target: "ext:pd.to_timedelta",
        evidence: [{ file: "producer.py", startLine: 11, callKind: "sync" }],
      },
    ],
    views: [
      {
        id: "view:art-cat:extract-tabular",
        title: "Tabular Artifacts (Extraction)",
        scope: "group",
        diagramType: "class",
        parentViewId: "view:process-stage:extract",
        nodeRefs: ["ext:df_data.csv"],
        edgeRefs: [],
      },
      {
        id: "view:process-stage:extract",
        title: "Extraction & Preprocessing",
        scope: "group",
        diagramType: "class",
        nodeRefs: ["sym:producer", "sym:consumer"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:art-cat:extract-tabular",
  };

  const codeDetails = buildDetails(graph, graph.views[0]!);
  const codeLabels = [...codeDetails.messages.values()].map((message) => message.label);
  assert.equal(codeDetails.projection.sequenceMode, "code");
  assert.ok(codeLabels.some((label) => label === "generate()" || label === "load()"));
  assert.notDeepEqual(codeLabels, ["write df_data.csv", "read df_data.csv"]);

  const details = buildDetails(graph, graph.views[0]!, "artifact");
  const labels = [...details.messages.values()].map((message) => message.label);
  const participantLabels = [...details.participants.values()].map((participant) => participant.label);

  assert.deepEqual(labels, ["write df_data.csv", "read df_data.csv"]);
  assert.equal(details.projection.sequenceMode, "artifact");
  assert.ok(participantLabels.includes("df_data.csv"));
  assert.ok(participantLabels.includes("generate"));
  assert.ok(participantLabels.includes("load"));
  assert.ok(!participantLabels.includes("Supporting Artifacts"));
  assert.ok(!participantLabels.includes("pd.to_timedelta"));
});
