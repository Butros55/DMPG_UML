import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph, Relation, Symbol } from "@dmpg/shared";
import { buildProcessDiagramConfigFromGraph } from "./processOverview.js";

type FlowRelationSpec = {
  type: "reads" | "writes";
  source: string;
  artifactId: string;
  artifactLabel: string;
};

function baseSymbols(): Symbol[] {
  return [
    { id: "mod:data_extraction", label: "data_extraction", kind: "module", umlType: "module" },
    {
      id: "mod:data_extraction:DataExtraction",
      label: "DataExtraction",
      kind: "class",
      umlType: "class",
      parentId: "mod:data_extraction",
    },
    {
      id: "mod:data_extraction:DataExtraction.get_data",
      label: "DataExtraction.get_data",
      kind: "method",
      umlType: "method",
      parentId: "mod:data_extraction:DataExtraction",
    },
    { id: "mod:data_analyzer", label: "data_analyzer", kind: "module", umlType: "module" },
    {
      id: "mod:data_analyzer:DataAnalyzer",
      label: "DataAnalyzer",
      kind: "class",
      umlType: "class",
      parentId: "mod:data_analyzer",
    },
    {
      id: "mod:data_analyzer:DataAnalyzer.process",
      label: "DataAnalyzer.process",
      kind: "method",
      umlType: "method",
      parentId: "mod:data_analyzer:DataAnalyzer",
    },
  ];
}

function buildGraph(specs: FlowRelationSpec[]): ProjectGraph {
  const artifactSymbols = new Map<string, Symbol>();
  const relations: Relation[] = [];
  specs.forEach((spec, index) => {
    artifactSymbols.set(spec.artifactId, {
      id: spec.artifactId,
      label: spec.artifactLabel,
      kind: "external",
      umlType: "artifact",
    });
    relations.push({
      id: `rel:${index}`,
      type: spec.type,
      source: spec.source,
      target: spec.artifactId,
      evidence: [{ file: "pipeline.py", startLine: index + 1, endLine: index + 1 }],
    });
  });

  return {
    symbols: [...baseSymbols(), ...artifactSymbols.values()],
    relations,
    views: [],
    rootViewId: "view:root",
  };
}

function previewJsonLines(node: { preview?: string[] } | undefined, kind: "preview" | "item"): Array<Record<string, unknown>> {
  const prefix = `@${kind} `;
  return (node?.preview ?? [])
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)) as Record<string, unknown>);
}

function previewContains(node: { preview?: string[] } | undefined, text: string): boolean {
  return (node?.preview ?? []).some((line) => line.includes(text));
}

function nodeById(config: ReturnType<typeof buildProcessDiagramConfigFromGraph>, id: string) {
  return [...config.nodes, ...(config.supportNodes ?? [])].find((node) => node.id === id);
}

function layerNodeById(config: ReturnType<typeof buildProcessDiagramConfigFromGraph>, id: string) {
  return config.nodes.find((node) => node.id === id);
}

test("classifies and renders cross-stage handoffs as Stage -> Artifact -> Stage", () => {
  const config = buildProcessDiagramConfigFromGraph(buildGraph([
    {
      type: "writes",
      source: "mod:data_extraction:DataExtraction.get_data",
      artifactId: "ext:df_data.csv",
      artifactLabel: "df_data.csv",
    },
    {
      type: "reads",
      source: "mod:data_analyzer:DataAnalyzer.process",
      artifactId: "ext:df_data.csv",
      artifactLabel: "df_data.csv",
    },
  ]));

  const artifactNode = nodeById(config, "proc:artifact:df_data_csv");
  assert.equal(artifactNode?.label, "df_data.csv");
  assert.equal(previewJsonLines(artifactNode, "preview")[0]?.groupKind, "handoff");
  assert.ok(config.edges.some((edge) =>
    edge.source === "proc:pkg:extract" &&
    edge.target === "proc:artifact:df_data_csv" &&
    edge.type === "writes",
  ));
  assert.ok(config.edges.some((edge) =>
    edge.source === "proc:artifact:df_data_csv" &&
    edge.target === "proc:pkg:transform" &&
    edge.type === "reads",
  ));
});

test("renders output-only non-simulation artifacts as stage output sinks", () => {
  const config = buildProcessDiagramConfigFromGraph(buildGraph([
    {
      type: "writes",
      source: "mod:data_extraction:DataExtraction.get_data",
      artifactId: "ext:debug_extract.csv",
      artifactLabel: "debug_extract.csv",
    },
  ]));

  assert.equal(layerNodeById(config, "proc:artifact:debug_extract_csv"), undefined);
  const outputNode = layerNodeById(config, "proc:output:extract-outputs");
  assert.equal(outputNode?.label, "Extraction Outputs");
  assert.equal(previewJsonLines(outputNode, "preview")[0]?.groupKind, "orphan_write");
  assert.ok(previewContains(outputNode, "written but not read"));
  assert.ok(config.edges.some((edge) =>
    edge.source === "proc:pkg:extract" &&
    edge.target === "proc:output:extract-outputs" &&
    edge.type === "writes" &&
    edge.label === "not read in scanned project",
  ));

  const extractPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:extract");
  assert.ok(extractPackage?.preview?.some((line) => line.includes("Written but not read: debug_extract.csv")));
});

test("keeps internal stage artifacts out of Layer 1 and lists them in stage preview", () => {
  const config = buildProcessDiagramConfigFromGraph(buildGraph([
    {
      type: "writes",
      source: "mod:data_extraction:DataExtraction.get_data",
      artifactId: "ext:tmp.csv",
      artifactLabel: "tmp.csv",
    },
    {
      type: "reads",
      source: "mod:data_extraction:DataExtraction.get_data",
      artifactId: "ext:tmp.csv",
      artifactLabel: "tmp.csv",
    },
  ]));

  assert.equal(layerNodeById(config, "proc:artifact:tmp_csv"), undefined);
  assert.equal(layerNodeById(config, "proc:output:extract-outputs"), undefined);
  const extractPackage = config.packages.find((pkg) => pkg.id === "proc:pkg:extract");
  assert.ok(extractPackage?.preview?.some((line) => line.includes("Internal artifacts: tmp.csv")));
});

test("renders read-only artifacts as input file imports", () => {
  const config = buildProcessDiagramConfigFromGraph(buildGraph([
    {
      type: "reads",
      source: "mod:data_extraction:DataExtraction.get_data",
      artifactId: "ext:material-map",
      artifactLabel: "Material_Cluster_Zuordnung.xlsx",
    },
  ]));

  const fileInputs = nodeById(config, "proc:input:file-imports");
  assert.equal(fileInputs?.label, "CSV / Files");
  assert.equal(previewJsonLines(fileInputs, "preview")[0]?.groupKind, "input");
  assert.ok(previewContains(fileInputs, "Material_Cluster_Zuordnung.xlsx"));
  assert.ok(config.edges.some((edge) =>
    edge.source === "proc:input:file-imports" &&
    edge.target === "proc:pkg:inputs" &&
    edge.type === "reads",
  ));
  assert.ok(config.edges.some((edge) =>
    edge.source === "proc:pkg:inputs" &&
    edge.target === "proc:pkg:extract" &&
    edge.label === "source records",
  ));
});

test("matches known artifact aliases without duplicate Layer-1 nodes", () => {
  const config = buildProcessDiagramConfigFromGraph(buildGraph([
    {
      type: "writes",
      source: "mod:data_extraction:DataExtraction.get_data",
      artifactId: "ext:writer-df-data",
      artifactLabel: "df_data.csv",
    },
    {
      type: "reads",
      source: "mod:data_analyzer:DataAnalyzer.process",
      artifactId: "ext:reader-df-data",
      artifactLabel: "folder/df data",
    },
  ]));

  const handoffNodes = config.nodes.filter((node) =>
    node.id === "proc:artifact:df_data_csv" || node.label.toLowerCase().includes("df data"),
  );
  assert.equal(handoffNodes.length, 1);
  assert.equal(handoffNodes[0]?.id, "proc:artifact:df_data_csv");
  assert.equal(previewJsonLines(handoffNodes[0], "preview")[0]?.groupKind, "handoff");
});

test("reports fuzzy unmatched candidates without auto-merging", () => {
  const config = buildProcessDiagramConfigFromGraph(buildGraph([
    {
      type: "writes",
      source: "mod:data_extraction:DataExtraction.get_data",
      artifactId: "ext:order.csv",
      artifactLabel: "order.csv",
    },
    {
      type: "reads",
      source: "mod:data_analyzer:DataAnalyzer.process",
      artifactId: "ext:orders.csv",
      artifactLabel: "orders.csv",
    },
  ]));

  assert.equal(layerNodeById(config, "proc:artifact:order_csv"), undefined);
  assert.equal(layerNodeById(config, "proc:artifact:orders_csv"), undefined);
  const outputNode = layerNodeById(config, "proc:output:extract-outputs");
  const inputNode = layerNodeById(config, "proc:input:file-imports");
  assert.ok(previewContains(outputNode, "possible unmatched candidate: order.csv vs orders.csv"));
  assert.ok(previewContains(inputNode, "possible unmatched candidate: orders.csv vs order.csv"));
});
