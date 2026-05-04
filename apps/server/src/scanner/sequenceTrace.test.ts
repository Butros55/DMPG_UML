import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph } from "@dmpg/shared";
import { buildSequenceScenarioForSymbol, buildSequenceScenarioForView } from "./sequenceTrace.js";

function createTraceGraph(extraRelations: ProjectGraph["relations"] = []): ProjectGraph {
  return {
    symbols: [
      { id: "mod:data_extraction", label: "data_extraction", kind: "module" },
      { id: "mod:data_extraction:DataExtraction", label: "DataExtraction", kind: "class", parentId: "mod:data_extraction" },
      {
        id: "mod:data_extraction:DataExtraction.get_data",
        label: "DataExtraction.get_data",
        kind: "method",
        parentId: "mod:data_extraction:DataExtraction",
        location: { file: "data_extraction.py", startLine: 1 },
        doc: { outputs: [{ name: "return", type: "DataFrame" }] },
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
        doc: { outputs: [{ name: "return", type: "records" }] },
      },
      { id: "ext:Wegrezept.csv", label: "Wegrezept.csv", kind: "external", umlType: "artifact" },
      { id: "ext:df_data.csv", label: "df_data.csv", kind: "external", umlType: "artifact" },
      { id: "ext:pd.to_timedelta", label: "pd.to_timedelta", kind: "external" },
      { id: "ext:range", label: "range", kind: "external" },
    ],
    relations: [
      {
        id: "rel:query",
        type: "calls",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "mod:druid_connector:DruidConnector.query",
        evidence: [{ file: "data_extraction.py", startLine: 10, sequenceIndex: 1, callKind: "sync", calleeName: "query" }],
      },
      {
        id: "rel:read-recipe",
        type: "reads",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "ext:Wegrezept.csv",
        evidence: [{ file: "data_extraction.py", startLine: 20, sequenceIndex: 2, messageKind: "read" }],
      },
      {
        id: "rel:normalize",
        type: "calls",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "mod:data_extraction:DataExtraction._normalize_timestamps",
        evidence: [{ file: "data_extraction.py", startLine: 30, sequenceIndex: 3, callKind: "sync", calleeName: "_normalize_timestamps" }],
      },
      {
        id: "rel:write-df",
        type: "writes",
        source: "mod:data_extraction:DataExtraction.get_data",
        target: "ext:df_data.csv",
        evidence: [{ file: "data_extraction.py", startLine: 40, sequenceIndex: 4, messageKind: "write" }],
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
      },
    ],
    rootViewId: "view:process-stage:extract",
  };
}

test("buildSequenceScenarioForView builds real sequence from entrypoint", () => {
  const graph = createTraceGraph();
  const scenario = buildSequenceScenarioForView(graph, "project", "view:process-stage:extract");
  assert.ok(scenario);

  assert.deepEqual(scenario.messages.map((message) => message.label), [
    "get_data()",
    "query(...)",
    "read Wegrezept.csv",
    "_normalize_timestamps()",
    "write df_data.csv",
  ]);
  assert.deepEqual(scenario.messages.map((message) => message.kind), [
    "sync_call",
    "sync_call",
    "read",
    "self_call",
    "write",
  ]);

  const participants = new Set(scenario.participants.map((participant) => participant.label));
  assert.ok(participants.has("Extraction & Preprocessing Actor"));
  assert.ok(participants.has("DataExtraction"));
  assert.ok(participants.has("DruidConnector"));
  assert.ok(participants.has("Wegrezept.csv"));
  assert.ok(participants.has("df_data.csv"));
  assert.ok(!participants.has("pd.to_timedelta"));
  assert.ok(!participants.has("range"));
});

test("buildSequenceScenarioForSymbol renders create messages and filters low-level noise", () => {
  const graph = createTraceGraph([
    {
      id: "rel:create",
      type: "instantiates",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "mod:druid_connector:DruidConnector",
      evidence: [{ file: "data_extraction.py", startLine: 5, sequenceIndex: 0, messageKind: "create" }],
    },
    {
      id: "rel:noise",
      type: "calls",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "ext:pd.to_timedelta",
      evidence: [{ file: "data_extraction.py", startLine: 11, sequenceIndex: 1, callKind: "sync" }],
    },
    {
      id: "rel:range",
      type: "calls",
      source: "mod:data_extraction:DataExtraction.get_data",
      target: "ext:range",
      evidence: [{ file: "data_extraction.py", startLine: 12, sequenceIndex: 2, callKind: "sync" }],
    },
  ]);

  const scenario = buildSequenceScenarioForSymbol(
    graph,
    "project",
    "mod:data_extraction:DataExtraction.get_data",
  );
  assert.ok(scenario);
  const labels = scenario.messages.map((message) => message.label);
  assert.ok(labels.includes("create DruidConnector"));
  assert.ok(!labels.some((label) => /pd\.to_timedelta|range|Run df/i.test(label)));
  assert.equal(scenario.messages.find((message) => message.label === "create DruidConnector")?.kind, "create");
});

test("buildSequenceScenarioForSymbol supports loop and alt fragments from evidence", () => {
  const graph = createTraceGraph([
    {
      id: "rel:loop-read",
      type: "reads",
      source: "mod:data_extraction:DataExtraction._normalize_timestamps",
      target: "ext:Wegrezept.csv",
      evidence: [{
        file: "data_extraction.py",
        startLine: 55,
        sequenceIndex: 0,
        messageKind: "read",
        fragmentId: "frag:loop",
        fragmentType: "loop",
        fragmentLabel: "for",
        fragmentGuard: "files",
      }],
    },
    {
      id: "rel:alt-write",
      type: "writes",
      source: "mod:data_extraction:DataExtraction._normalize_timestamps",
      target: "ext:df_data.csv",
      evidence: [{
        file: "data_extraction.py",
        startLine: 60,
        sequenceIndex: 1,
        messageKind: "write",
        fragmentId: "frag:alt",
        fragmentType: "alt",
        fragmentLabel: "if",
        fragmentGuard: "valid",
      }],
    },
  ]);

  const scenario = buildSequenceScenarioForSymbol(
    graph,
    "project",
    "mod:data_extraction:DataExtraction._normalize_timestamps",
  );
  assert.ok(scenario);
  assert.deepEqual(scenario.fragments?.map((fragment) => [fragment.type, fragment.label, fragment.guard]), [
    ["loop", "for", "files"],
    ["alt", "if", "valid"],
  ]);
});
