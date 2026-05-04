import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph } from "@dmpg/shared";
import { collectInputSourceTreeSymbols } from "./inputSources.js";

test("collectInputSourceTreeSymbols expands input source preview items for the sidebar tree", () => {
  const graph: ProjectGraph = {
    symbols: [
      {
        id: "proc:input:file-imports",
        label: "CSV / Files",
        kind: "external",
        umlType: "artifact",
        preview: {
          lines: [
            "@preview {\"mode\":\"cluster\",\"stageId\":\"inputs\",\"groupKind\":\"input\",\"category\":\"tabular\"}",
            "@item {\"label\":\"df_data.csv\",\"paths\":[\"input/df_data.csv\"],\"artifactIds\":[\"sym:file\"],\"category\":\"tabular\"}",
            "@item {\"label\":\"missing_source.csv\",\"paths\":[\"input/missing_source.csv\"],\"artifactIds\":[\"missing\"],\"category\":\"tabular\"}",
          ],
        },
      },
      {
        id: "sym:file",
        label: "raw.csv",
        kind: "external",
        umlType: "artifact",
      },
      {
        id: "sym:connector",
        label: "DruidConnector",
        kind: "class",
        umlType: "class",
      },
    ],
    relations: [],
    views: [
      {
        id: "view:process-overview",
        title: "Process Overview",
        scope: "root",
        nodeRefs: ["proc:input:file-imports"],
        edgeRefs: [],
      },
      {
        id: "view:process-stage:inputs",
        title: "Input Sources",
        parentViewId: "view:process-overview",
        scope: "group",
        diagramType: "class",
        nodeRefs: ["sym:connector"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:process-overview",
  };

  const entries = collectInputSourceTreeSymbols(graph);

  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.navigationSymbolId]),
    [
      ["df_data.csv", "sym:file"],
      ["missing_source.csv", null],
      ["DruidConnector", "sym:connector"],
    ],
  );
});
