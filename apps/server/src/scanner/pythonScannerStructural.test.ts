import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface RawEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  targetRole?: string;
  evidence?: { file?: string; startLine?: number; snippet?: string };
}

interface RawScan {
  edges: RawEdge[];
}

function findPython(): string | null {
  for (const command of ["python", "python3"]) {
    try {
      execFileSync(command, ["--version"], { stdio: "ignore" });
      return command;
    } catch {
      continue;
    }
  }
  return null;
}

test("python scanner derives structural class UML relations from attributes and signatures", (t) => {
  const python = findPython();
  if (!python) {
    t.skip("python is not available");
    return;
  }

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-python-structural-"));
  const scannerPath = path.resolve(import.meta.dirname, "python_scanner.py");

  try {
    fs.writeFileSync(
      path.join(projectDir, "sample.py"),
      [
        "import pandas as pd",
        "",
        "class BaseExtractor:",
        "    pass",
        "",
        "class DruidConnector:",
        "    pass",
        "",
        "class Worker:",
        "    pass",
        "",
        "class MaterialCluster:",
        "    pass",
        "",
        "class Report:",
        "    pass",
        "",
        "class Extractor(BaseExtractor):",
        "    def __init__(",
        "        self,",
        "        workers: list[Worker],",
        "        material_cluster: MaterialCluster | None = None,",
        "    ):",
        "        self.druid_connector = DruidConnector()",
        "        self.workers = workers",
        "        self.material_cluster = material_cluster",
        "        self.frame: pd.DataFrame = pd.DataFrame()",
        "",
        "    def export(self, report: Report) -> MaterialCluster:",
        "        return MaterialCluster()",
        "",
      ].join("\n"),
      "utf-8",
    );

    const raw = execFileSync(python, [scannerPath, projectDir], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const scan = JSON.parse(raw) as RawScan;

    const edge = (type: string, target: string, role?: string) =>
      scan.edges.find((candidate) =>
        candidate.source === "mod:sample:Extractor" &&
        candidate.target === target &&
        candidate.type === type &&
        (role ? candidate.targetRole === role : true),
      );

    const composition = edge("composition", "mod:sample:DruidConnector", "druid_connector");
    assert.equal(composition?.sourceMultiplicity, "1");
    assert.equal(composition?.targetMultiplicity, "1");
    assert.match(composition?.evidence?.snippet ?? "", /self\.druid_connector = DruidConnector/);

    const workers = edge("aggregation", "mod:sample:Worker", "workers");
    assert.equal(workers?.targetMultiplicity, "0..*");

    const materialCluster = edge("aggregation", "mod:sample:MaterialCluster", "material_cluster");
    assert.equal(materialCluster?.targetMultiplicity, "0..1");

    const signatureDependency = edge("dependency", "mod:sample:Report");
    assert.equal(signatureDependency?.label, "export");
    assert.equal(signatureDependency?.sourceMultiplicity, "1");

    assert.ok(!scan.edges.some((candidate) =>
      candidate.type === "association" &&
      candidate.source === "mod:sample:Extractor" &&
      /DataFrame|Series|pandas|numpy/.test(candidate.target),
    ));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
