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
  evidence?: {
    file?: string;
    startLine?: number;
    snippet?: string;
    callKind?: "sync" | "async";
    receiverName?: string;
    calleeName?: string;
    enclosingSymbolId?: string;
    sequenceIndex?: number;
    messageKind?: "call" | "create" | "read" | "write";
    operationKind?: "call" | "create" | "read" | "write" | "branch" | "loop" | "try" | "return";
    nestingDepth?: number;
    fragmentId?: string;
    fragmentType?: "loop" | "alt" | "opt" | "try" | "parallel";
    fragmentLabel?: string;
    fragmentGuard?: string;
    fragmentStartLine?: number;
    fragmentEndLine?: number;
    artifactResolution?: "resolved" | "unresolved_dynamic_path";
  };
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

test("python scanner annotates sequence operations with loop and alt fragments", (t) => {
  const python = findPython();
  if (!python) {
    t.skip("python is not available");
    return;
  }

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-python-sequence-fragments-"));
  const scannerPath = path.resolve(import.meta.dirname, "python_scanner.py");

  try {
    fs.writeFileSync(
      path.join(projectDir, "sample.py"),
      [
        "import pandas as pd",
        "",
        "class DataExtraction:",
        "    def run(self):",
        "        for path in ['Wegrezept.csv']:",
        "            frame = pd.read_csv('Wegrezept.csv')",
        "        if frame is not None:",
        "            frame.to_csv('df_data.csv')",
        "",
      ].join("\n"),
      "utf-8",
    );

    const raw = execFileSync(python, [scannerPath, projectDir], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const scan = JSON.parse(raw) as RawScan;

    const loopRead = scan.edges.find((candidate) =>
      candidate.source === "mod:sample:DataExtraction.run" &&
      candidate.target === "ext:Wegrezept.csv" &&
      candidate.type === "reads",
    );
    assert.equal(loopRead?.evidence?.fragmentType, "loop");
    assert.equal(loopRead?.evidence?.fragmentLabel, "for");
    assert.equal(loopRead?.evidence?.nestingDepth, 1);
    assert.equal(loopRead?.evidence?.operationKind, "read");

    const altWrite = scan.edges.find((candidate) =>
      candidate.source === "mod:sample:DataExtraction.run" &&
      candidate.target === "ext:df_data.csv" &&
      candidate.type === "writes",
    );
    assert.equal(altWrite?.evidence?.fragmentType, "alt");
    assert.equal(altWrite?.evidence?.fragmentLabel, "if");
    assert.match(altWrite?.evidence?.fragmentGuard ?? "", /frame/);
    assert.equal(altWrite?.evidence?.operationKind, "write");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("python scanner resolves object receiver calls and sequence IO evidence", (t) => {
  const python = findPython();
  if (!python) {
    t.skip("python is not available");
    return;
  }

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-python-sequence-"));
  const scannerPath = path.resolve(import.meta.dirname, "python_scanner.py");

  try {
    fs.writeFileSync(
      path.join(projectDir, "sample.py"),
      [
        "import pandas as pd",
        "",
        "class DruidConnector:",
        "    def query(self):",
        "        return []",
        "",
        "class DataExtraction:",
        "    def __init__(self):",
        "        self.connector = DruidConnector()",
        "",
        "    def get_data(self):",
        "        connector = DruidConnector()",
        "        records = connector.query()",
        "        more = self.connector.query()",
        "        self._normalize_timestamps()",
        "        frame = pd.read_csv('Wegrezept.csv')",
        "        frame.to_csv('df_data.csv')",
        "        pd.to_timedelta(frame)",
        "        return records + more",
        "",
        "    def _normalize_timestamps(self):",
        "        return None",
        "",
      ].join("\n"),
      "utf-8",
    );

    const raw = execFileSync(python, [scannerPath, projectDir], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const scan = JSON.parse(raw) as RawScan;

    const queryCalls = scan.edges.filter((candidate) =>
      candidate.source === "mod:sample:DataExtraction.get_data" &&
      candidate.target === "mod:sample:DruidConnector.query" &&
      candidate.type === "calls",
    );
    assert.equal(queryCalls.length, 2);
    assert.ok(queryCalls.some((candidate) => candidate.evidence?.receiverName === "connector"));
    assert.ok(queryCalls.some((candidate) => candidate.evidence?.receiverName === "self.connector"));
    assert.ok(queryCalls.every((candidate) => candidate.evidence?.calleeName === "query"));
    assert.ok(queryCalls.every((candidate) => candidate.evidence?.messageKind === "call"));
    assert.ok(queryCalls.every((candidate) => candidate.evidence?.enclosingSymbolId === "mod:sample:DataExtraction.get_data"));

    assert.ok(scan.edges.some((candidate) =>
      candidate.source === "mod:sample:DataExtraction.get_data" &&
      candidate.target === "mod:sample:DataExtraction._normalize_timestamps" &&
      candidate.type === "calls" &&
      candidate.evidence?.receiverName === "self",
    ));

    assert.ok(scan.edges.some((candidate) =>
      candidate.source === "mod:sample:DataExtraction.get_data" &&
      candidate.target === "mod:sample:DruidConnector" &&
      candidate.type === "instantiates" &&
      candidate.evidence?.messageKind === "create" &&
      candidate.evidence?.callKind === "sync",
    ));

    const readEdge = scan.edges.find((candidate) =>
      candidate.source === "mod:sample:DataExtraction.get_data" &&
      candidate.target === "ext:Wegrezept.csv" &&
      candidate.type === "reads",
    );
    assert.equal(readEdge?.label, "read csv");
    assert.equal(readEdge?.evidence?.artifactResolution, "resolved");
    assert.equal(readEdge?.evidence?.messageKind, "read");

    const writeEdge = scan.edges.find((candidate) =>
      candidate.source === "mod:sample:DataExtraction.get_data" &&
      candidate.target === "ext:df_data.csv" &&
      candidate.type === "writes",
    );
    assert.equal(writeEdge?.label, "write csv");
    assert.equal(writeEdge?.evidence?.artifactResolution, "resolved");
    assert.equal(writeEdge?.evidence?.messageKind, "write");

    assert.ok(!scan.edges.some((candidate) =>
      candidate.source === "mod:sample:DataExtraction.get_data" &&
      candidate.type === "calls" &&
      /pd\.|to_timedelta|DataFrame|df/.test(candidate.target),
    ));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
