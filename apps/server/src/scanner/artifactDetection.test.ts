import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectGraph, Symbol } from "@dmpg/shared";
import { scanProject } from "./index.js";

function writeProjectFile(projectDir: string, relativePath: string, content: string): void {
  const targetPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function symbolByLabel(graph: ProjectGraph, label: string): Symbol | undefined {
  return graph.symbols.find((symbol) => symbol.label === label);
}

function hasWriteEdge(graph: ProjectGraph, sourceId: string, targetLabel: string): boolean {
  const target = symbolByLabel(graph, targetLabel);
  if (!target) return false;
  return graph.relations.some((relation) =>
    relation.type === "writes" &&
    !relation.id.startsWith("process-edge:") &&
    !relation.id.startsWith("stub-edge:") &&
    relation.source === sourceId &&
    relation.target === target.id,
  );
}

function hasProcessWriteEdge(graph: ProjectGraph, sourceId: string, targetId: string): boolean {
  return graph.relations.some((relation) =>
    relation.type === "writes" &&
    relation.id.startsWith("process-edge:view-artifact:") &&
    relation.source === sourceId &&
    relation.target === targetId,
  );
}

function processReadEdgeId(graph: ProjectGraph, sourceId: string, targetId: string): string | undefined {
  return graph.relations.find((relation) =>
    relation.type === "reads" &&
    relation.id.startsWith("process-edge:view-artifact:") &&
    relation.source === sourceId &&
    relation.target === targetId,
  )?.id;
}

test("scanProject detects concrete written artifacts and surfaces them in process views", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-artifacts-"));
  try {
    writeProjectFile(projectDir, "data_extraction.py", `
class DataExtraction:
    def build(self):
        csv_path = "output/df_data.csv"
        ordered_path = "output/df_data_with_order.csv"
        cluster_path = f"output/df_data_with_order_cluster.csv"
        self.df.to_csv(csv_path, index=False)
        self.df.to_csv(ordered_path, index=False)
        self.df.to_csv(cluster_path, index=False)
`);

    writeProjectFile(projectDir, "distribution/fit_distribution.py", `
import json
import pickle

def save_to_file(path="output/distribution.json", path2="output/fallback.json"):
    with open(path, "w") as fh:
        json.dump({"ok": True}, fh)
    with open(path2, "w") as fh:
        json.dump({"ok": False}, fh)

def persist_model():
    pickle.dump({}, open("models/model.pickle", "wb"))
    with open("models/kde_min_max_values.json", "w") as fh:
        json.dump({}, fh)
`);

    writeProjectFile(projectDir, "arrival_table/generate_arrival_table.py", `
def generate_arrival_table(df_small, df_big):
    df_small.to_csv("outputs/Arrival_Klein.csv", index=False)
    df_big.to_csv("outputs/Arrival_Gross.csv", index=False)
`);

    writeProjectFile(projectDir, "simulation_data_generator.py", `
import pandas as pd

def export_results(df):
    report = "outputs/filter_stats.xlsx"
    outliers = "outputs/outliners.xlsx"
    df.to_excel(report)
    df.to_excel(outliers)
    with open("outputs/simulation.json", "w") as fh:
        fh.write("{}")

def load_extracted():
    return pd.read_csv("output/df_data.csv")
`);

    const graph = await scanProject(projectDir);

    for (const label of [
      "output/df_data.csv",
      "output/df_data_with_order.csv",
      "output/df_data_with_order_cluster.csv",
      "output/distribution.json",
      "output/fallback.json",
      "models/model.pickle",
      "models/kde_min_max_values.json",
      "outputs/Arrival_Klein.csv",
      "outputs/Arrival_Gross.csv",
      "outputs/filter_stats.xlsx",
      "outputs/outliners.xlsx",
      "outputs/simulation.json",
    ]) {
      assert.ok(symbolByLabel(graph, label), `${label} should be present as an artifact symbol`);
    }

    assert.ok(hasWriteEdge(graph, "mod:data_extraction:DataExtraction.build", "output/df_data.csv"));
    assert.ok(hasWriteEdge(graph, "mod:data_extraction:DataExtraction.build", "output/df_data_with_order.csv"));
    assert.ok(hasWriteEdge(graph, "mod:data_extraction:DataExtraction.build", "output/df_data_with_order_cluster.csv"));
    assert.ok(hasWriteEdge(graph, "mod:distribution.fit_distribution:save_to_file", "output/distribution.json"));
    assert.ok(hasWriteEdge(graph, "mod:distribution.fit_distribution:save_to_file", "output/fallback.json"));
    assert.ok(hasWriteEdge(graph, "mod:distribution.fit_distribution:persist_model", "models/model.pickle"));
    assert.ok(hasWriteEdge(graph, "mod:distribution.fit_distribution:persist_model", "models/kde_min_max_values.json"));
    assert.ok(hasWriteEdge(graph, "mod:arrival_table.generate_arrival_table:generate_arrival_table", "outputs/Arrival_Klein.csv"));
    assert.ok(hasWriteEdge(graph, "mod:arrival_table.generate_arrival_table:generate_arrival_table", "outputs/Arrival_Gross.csv"));
    assert.ok(hasWriteEdge(graph, "mod:simulation_data_generator:export_results", "outputs/filter_stats.xlsx"));
    assert.ok(hasWriteEdge(graph, "mod:simulation_data_generator:export_results", "outputs/outliners.xlsx"));
    assert.ok(hasWriteEdge(graph, "mod:simulation_data_generator:export_results", "outputs/simulation.json"));

    const processView = graph.views.find((view) => view.id === "view:process-overview");
    assert.ok(processView?.nodeRefs.includes("proc:output:arrival-table"));
    assert.ok(processView?.nodeRefs.includes("proc:output:generated-simulation-data"));
    assert.ok(processView?.nodeRefs.includes("proc:output:simulation-results"));
    assert.ok(processView?.nodeRefs.includes("proc:artifact:df_data_csv"));
    assert.ok(processView?.nodeRefs.some((nodeRef) => nodeRef.startsWith("proc:artifact-cluster:distribution_json")));
    assert.ok(processView?.nodeRefs.includes("proc:artifact:model_pickle"));
    assert.ok(processView?.edgeRefs.includes("process-edge:flow:proc_output_arrival_table:to-simulation-output"));
    assert.ok(processView?.edgeRefs.includes("process-edge:flow:proc_output_generated_simulation_data:to-simulation-output"));

    const extractStageView = graph.views.find((view) => view.id === "view:process-stage:extract");
    assert.ok(extractStageView?.nodeRefs.includes("mod:data_extraction:DataExtraction"));
    assert.ok(extractStageView?.nodeRefs.includes("proc:artifact:df_data_with_order_cluster_csv"));
    assert.ok(extractStageView?.nodeRefs.includes("proc:artifact:df_data_with_order_csv"));
    assert.ok(extractStageView?.nodeRefs.includes("proc:artifact:df_data_csv"));

    const distributionStageView = graph.views.find((view) => view.id === "view:process-stage:distribution");
    assert.ok(distributionStageView?.nodeRefs.includes("mod:distribution.fit_distribution"));
    assert.ok(distributionStageView?.nodeRefs.includes("proc:artifact:distribution_json"));
    assert.ok(distributionStageView?.nodeRefs.includes("proc:artifact:fallback_json"));
    assert.ok(distributionStageView?.nodeRefs.includes("proc:artifact:kde_min_max_values_json"));
    assert.ok(distributionStageView?.nodeRefs.includes("proc:artifact:model_pickle"));

    const simulationStageView = graph.views.find((view) => view.id === "view:process-stage:simulation");
    assert.ok(simulationStageView?.nodeRefs.includes("mod:simulation_data_generator"));
    assert.ok(simulationStageView?.nodeRefs.includes("mod:arrival_table.generate_arrival_table"));
    assert.ok(simulationStageView?.nodeRefs.includes("proc:artifact:arrival_gro_csv"));
    assert.ok(simulationStageView?.nodeRefs.includes("proc:artifact:arrival_klein_csv"));
    assert.ok(simulationStageView?.nodeRefs.includes("proc:artifact:filter_stats_xlsx"));
    assert.ok(simulationStageView?.nodeRefs.includes("proc:artifact:outliners_xlsx"));
    assert.equal(graph.views.find((view) => view.id === "view:process-stage:outputs"), undefined);

    const distributionModuleView = graph.views.find((view) => view.id === "view:mod:distribution.fit_distribution");
    assert.ok(distributionModuleView?.nodeRefs.includes("proc:artifact:distribution_json"));
    assert.ok(distributionModuleView?.nodeRefs.includes("proc:artifact:fallback_json"));
    assert.ok(distributionModuleView?.nodeRefs.includes("proc:artifact:model_pickle"));
    assert.ok(hasProcessWriteEdge(graph, "mod:distribution.fit_distribution:save_to_file", "proc:artifact:distribution_json"));
    assert.ok(hasProcessWriteEdge(graph, "mod:distribution.fit_distribution:save_to_file", "proc:artifact:fallback_json"));
    assert.ok(hasProcessWriteEdge(graph, "mod:distribution.fit_distribution:persist_model", "proc:artifact:model_pickle"));

    const extractionClassView = graph.views.find((view) => view.id === "view:mod:data_extraction:DataExtraction");
    assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_csv"));
    assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_with_order_csv"));
    assert.ok(extractionClassView?.nodeRefs.includes("proc:artifact:df_data_with_order_cluster_csv"));
    assert.ok(hasProcessWriteEdge(graph, "mod:data_extraction:DataExtraction.build", "proc:artifact:df_data_csv"));
    assert.ok(hasProcessWriteEdge(graph, "mod:data_extraction:DataExtraction.build", "proc:artifact:df_data_with_order_csv"));
    assert.ok(hasProcessWriteEdge(graph, "mod:data_extraction:DataExtraction.build", "proc:artifact:df_data_with_order_cluster_csv"));

    const simulationModuleView = graph.views.find((view) => view.id === "view:mod:simulation_data_generator");
    const simulationReadEdgeId = processReadEdgeId(
      graph,
      "proc:artifact:df_data_csv",
      "mod:simulation_data_generator:load_extracted",
    );
    assert.ok(simulationReadEdgeId);
    assert.ok(simulationModuleView?.nodeRefs.includes("proc:artifact:df_data_csv"));
    assert.ok(simulationModuleView?.edgeRefs.includes(simulationReadEdgeId));

    const stageWriteEdges = graph.relations.filter((relation) => relation.id.startsWith("process-edge:stage-flow:"));
    const stageWriteTargets = new Set(stageWriteEdges.map((relation) => relation.target));
    assert.ok(stageWriteTargets.has("proc:artifact:df_data_csv"));
    assert.ok(stageWriteTargets.has("proc:artifact:distribution_json"));
    assert.ok(stageWriteTargets.has("proc:artifact:model_pickle"));
    assert.ok(stageWriteTargets.has("proc:artifact:arrival_gro_csv"));
    assert.ok(stageWriteTargets.has("proc:artifact:arrival_klein_csv"));
    assert.ok(stageWriteTargets.has("proc:artifact:filter_stats_xlsx"));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("scanProject extracts instance attributes for class-diagram views", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-class-attrs-"));
  try {
    writeProjectFile(projectDir, "pipeline.py", `
class ScheduleBuilder:
    pass

class JobResult:
    pass

class Repository:
    pass

class PipelineController:
    def __init__(self, repository: Repository, retries: int = 3):
        self.repository = repository
        self.builder = ScheduleBuilder()
        self.retries = retries
        self.enabled = True
        self.mode = "batch"

    def run(self, payload: JobResult) -> JobResult:
        return JobResult()
`);

    const graph = await scanProject(projectDir);
    const controllerClassId = "mod:pipeline:PipelineController";
    const attributes = graph.symbols
      .filter((symbol) => symbol.parentId === controllerClassId)
      .filter((symbol) => symbol.kind === "variable" || symbol.kind === "constant");
    const attributeLabels = new Set(attributes.map((symbol) => symbol.label));

    assert.ok(attributeLabels.has("PipelineController.repository"));
    assert.ok(attributeLabels.has("PipelineController.builder"));
    assert.ok(attributeLabels.has("PipelineController.retries"));
    assert.ok(attributeLabels.has("PipelineController.enabled"));
    assert.ok(attributeLabels.has("PipelineController.mode"));

    const repositoryAttr = attributes.find((symbol) => symbol.label === "PipelineController.repository");
    assert.equal(repositoryAttr?.doc?.inputs?.[0]?.type, "Repository");
    const builderAttr = attributes.find((symbol) => symbol.label === "PipelineController.builder");
    assert.equal(builderAttr?.doc?.inputs?.[0]?.type, "ScheduleBuilder");
    const retriesAttr = attributes.find((symbol) => symbol.label === "PipelineController.retries");
    assert.equal(retriesAttr?.doc?.inputs?.[0]?.type, "int");
    const enabledAttr = attributes.find((symbol) => symbol.label === "PipelineController.enabled");
    assert.equal(enabledAttr?.doc?.inputs?.[0]?.type, "bool");
    const modeAttr = attributes.find((symbol) => symbol.label === "PipelineController.mode");
    assert.equal(modeAttr?.doc?.inputs?.[0]?.type, "str");

    assert.ok(graph.relations.some((relation) =>
      relation.type === "association" &&
      relation.source === "mod:pipeline:PipelineController" &&
      relation.target === "mod:pipeline:Repository",
    ));
    assert.ok(graph.relations.some((relation) =>
      relation.type === "composition" &&
      relation.source === "mod:pipeline:PipelineController" &&
      relation.target === "mod:pipeline:ScheduleBuilder",
    ));
    assert.ok(graph.relations.some((relation) =>
      relation.type === "association" &&
      relation.source === "mod:pipeline:PipelineController" &&
      relation.target === "mod:pipeline:JobResult",
    ));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("scanProject annotates sync and async call kinds for sequence diagrams", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-sequence-call-kinds-"));
  try {
    writeProjectFile(projectDir, "pipeline.py", `
import asyncio

async def fetch_data():
    return 1

def compute():
    return 2

async def pipeline():
    await fetch_data()
    asyncio.create_task(fetch_data())
    compute()

def run():
    compute()
`);

    const graph = await scanProject(projectDir);

    const fetchCalls = graph.relations.filter((relation) =>
      relation.type === "calls" &&
      relation.source === "mod:pipeline:pipeline" &&
      relation.target === "mod:pipeline:fetch_data",
    );
    assert.equal(fetchCalls.length, 2);
    assert.deepEqual(
      fetchCalls
        .map((relation) => relation.evidence?.[0]?.callKind)
        .sort(),
      ["async", "sync"],
    );

    const computeFromPipeline = graph.relations.find((relation) =>
      relation.type === "calls" &&
      relation.source === "mod:pipeline:pipeline" &&
      relation.target === "mod:pipeline:compute",
    );
    assert.equal(computeFromPipeline?.evidence?.[0]?.callKind, "sync");

    const computeFromRun = graph.relations.find((relation) =>
      relation.type === "calls" &&
      relation.source === "mod:pipeline:run" &&
      relation.target === "mod:pipeline:compute",
    );
    assert.equal(computeFromRun?.evidence?.[0]?.callKind, "sync");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
