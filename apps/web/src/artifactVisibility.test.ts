import test from "node:test";
import assert from "node:assert/strict";
import type { DiagramView, ProjectGraph, Relation, Symbol } from "@dmpg/shared";
import { resolveArtifactView } from "./artifactVisibility.js";

function buildBaseGraph(params: {
  symbols: Symbol[];
  relations: Relation[];
  viewNodeRefs: string[];
}): { graph: ProjectGraph; view: DiagramView } {
  const view: DiagramView = {
    id: "view:process-overview",
    title: "Process Overview",
    scope: "group",
    nodeRefs: params.viewNodeRefs,
    edgeRefs: [],
  };

  const graph: ProjectGraph = {
    symbols: params.symbols,
    relations: params.relations,
    views: [view],
    rootViewId: view.id,
  };

  return { graph, view };
}

test("resolveArtifactView hides the input stage package when grouped inputs are visible", () => {
  const inputPackage: Symbol = {
    id: "proc:pkg:inputs",
    label: "Input Sources",
    kind: "group",
    umlType: "package",
  };
  const extractPackage: Symbol = {
    id: "proc:pkg:extract",
    label: "Extraction & Preprocessing",
    kind: "group",
    umlType: "package",
  };
  const inputNode: Symbol = {
    id: "proc:input:external-sources",
    label: "MES / External Sources",
    kind: "external",
    umlType: "component",
  };
  const relations: Relation[] = [
    {
      id: "rel:input-to-package",
      type: "reads",
      source: inputNode.id,
      target: inputPackage.id,
      label: "external feeds",
      confidence: 1,
    },
    {
      id: "rel:package-to-extract",
      type: "reads",
      source: inputPackage.id,
      target: extractPackage.id,
      label: "source records",
      confidence: 1,
    },
  ];
  const { graph, view } = buildBaseGraph({
    symbols: [inputPackage, extractPackage, inputNode],
    relations,
    viewNodeRefs: [inputNode.id, inputPackage.id, extractPackage.id],
  });

  const resolved = resolveArtifactView(graph, view, {
    input: "grouped",
    generated: "grouped",
  });

  assert.deepEqual(resolved.nodeRefs, [inputNode.id, extractPackage.id]);
  assert.ok(resolved.hiddenSymbolIds.has(inputPackage.id));
  assert.equal(
    resolved.relations.some(
      (relation) =>
        relation.source === inputNode.id &&
        relation.target === extractPackage.id &&
        relation.type === "reads" &&
        relation.label === "external feeds",
    ),
    true,
  );
  assert.equal(
    resolved.relations.some(
      (relation) => relation.source === inputNode.id && relation.target === inputPackage.id,
    ),
    false,
  );
});

test("resolveArtifactView hides the input stage package when inputs are off", () => {
  const inputPackage: Symbol = {
    id: "proc:pkg:inputs",
    label: "Input Sources",
    kind: "group",
    umlType: "package",
  };
  const extractPackage: Symbol = {
    id: "proc:pkg:extract",
    label: "Extraction & Preprocessing",
    kind: "group",
    umlType: "package",
  };
  const { graph, view } = buildBaseGraph({
    symbols: [inputPackage, extractPackage],
    relations: [],
    viewNodeRefs: [inputPackage.id, extractPackage.id],
  });

  const resolved = resolveArtifactView(graph, view, {
    input: "hidden",
    generated: "grouped",
  });

  assert.deepEqual(resolved.nodeRefs, [extractPackage.id]);
  assert.ok(resolved.hiddenSymbolIds.has(inputPackage.id));
});

test("resolveArtifactView bypasses the input stage package for individual input members", () => {
  const inputPackage: Symbol = {
    id: "proc:pkg:inputs",
    label: "Input Sources",
    kind: "group",
    umlType: "package",
  };
  const extractPackage: Symbol = {
    id: "proc:pkg:extract",
    label: "Extraction & Preprocessing",
    kind: "group",
    umlType: "package",
  };
  const groupedInputNode: Symbol = {
    id: "proc:input:database-import",
    label: "Database Import",
    kind: "external",
    umlType: "database",
    preview: {
      lines: [
        "@preview {\"mode\":\"cluster\",\"stageId\":\"inputs\",\"groupKind\":\"input\",\"category\":\"source\"}",
        "@item {\"label\":\"DruidConnector\",\"paths\":[\"druid_connector.py\"],\"artifactIds\":[\"sym:druid\"],\"writeCount\":0,\"readCount\":1,\"producerIds\":[],\"consumerIds\":[],\"producers\":[],\"consumers\":[\"Input Sources\"],\"producerStages\":[],\"consumerStages\":[\"inputs\"],\"category\":\"source\",\"groupKind\":\"input\"}",
      ],
    },
  };
  const druidConnector: Symbol = {
    id: "sym:druid",
    label: "DruidConnector",
    kind: "class",
    umlType: "class",
  };
  const relations: Relation[] = [
    {
      id: "rel:grouped-input-to-package",
      type: "reads",
      source: groupedInputNode.id,
      target: inputPackage.id,
      label: "database import",
      confidence: 1,
    },
    {
      id: "rel:package-to-extract",
      type: "reads",
      source: inputPackage.id,
      target: extractPackage.id,
      label: "source records",
      confidence: 1,
    },
  ];
  const { graph, view } = buildBaseGraph({
    symbols: [inputPackage, extractPackage, groupedInputNode, druidConnector],
    relations,
    viewNodeRefs: [groupedInputNode.id, inputPackage.id, extractPackage.id],
  });

  const resolved = resolveArtifactView(graph, view, {
    input: "individual",
    generated: "grouped",
  });

  assert.deepEqual(resolved.nodeRefs, [druidConnector.id, extractPackage.id]);
  assert.ok(resolved.hiddenSymbolIds.has(groupedInputNode.id));
  assert.ok(resolved.hiddenSymbolIds.has(inputPackage.id));
  assert.equal(
    resolved.relations.some(
      (relation) =>
        relation.source === druidConnector.id &&
        relation.target === extractPackage.id &&
        relation.type === "reads",
    ),
    true,
  );
});
