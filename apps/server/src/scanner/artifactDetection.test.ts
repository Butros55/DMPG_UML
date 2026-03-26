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
def export_results(df):
    report = "outputs/filter_stats.xlsx"
    outliers = "outputs/outliners.xlsx"
    df.to_excel(report)
    df.to_excel(outliers)
    with open("outputs/simulation.json", "w") as fh:
        fh.write("{}")
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
    assert.deepEqual(extractStageView?.nodeRefs, [
      "mod:data_extraction",
      "proc:artifact:df_data_with_order_cluster_csv",
      "proc:artifact:df_data_with_order_csv",
      "proc:artifact:df_data_csv",
    ]);

    const distributionStageView = graph.views.find((view) => view.id === "view:process-stage:distribution");
    assert.deepEqual(distributionStageView?.nodeRefs, [
      "mod:distribution.fit_distribution",
      "proc:artifact:distribution_json",
      "proc:artifact:fallback_json",
      "proc:artifact:kde_min_max_values_json",
      "proc:artifact:model_pickle",
    ]);

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
