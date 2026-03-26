import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectGraph } from "@dmpg/shared";
import { detectCommentedOutCodeFindings, detectUnreachableCodeFindings } from "./codeHygiene.js";

function buildGraph(): ProjectGraph {
  return {
    rootViewId: "view:root",
    projectPath: "C:/tmp/project",
    sourceProjectPath: "C:/tmp/project",
    symbols: [
      {
        id: "mod:sample",
        label: "sample",
        kind: "module",
        location: { file: "sample.py", startLine: 1, endLine: 12 },
      },
      {
        id: "mod:sample:foo",
        label: "foo",
        kind: "function",
        parentId: "mod:sample",
        location: { file: "sample.py", startLine: 1, endLine: 8 },
      },
    ],
    relations: [],
    views: [
      {
        id: "view:root",
        title: "Overview",
        scope: "root",
        nodeRefs: ["mod:sample", "mod:sample:foo"],
        edgeRefs: [],
      },
    ],
  };
}

test("detectUnreachableCodeFindings reports code after return", () => {
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-code-hygiene-"));
  fs.writeFileSync(path.join(scanRoot, "sample.py"), [
    "def foo():",
    "    value = 1",
    "    return value",
    "    never_used = 2",
    "    print(never_used)",
    "",
  ].join("\n"));

  const graph = buildGraph();
  const findings = detectUnreachableCodeFindings({
    graph,
    targetSymbolIds: new Set(["mod:sample:foo"]),
    scanRoot,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.type, "dead_code");
  assert.equal(findings[0]?.deadCodeKind, "unreachable_code");
  assert.equal(findings[0]?.startLine, 4);
  assert.match(findings[0]?.summary ?? "", /nicht mehr erreichbar/i);
});

test("detectCommentedOutCodeFindings separates commented code blocks", () => {
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-commented-code-"));
  fs.writeFileSync(path.join(scanRoot, "sample.py"), [
    "def foo():",
    "    return 1",
    "",
    "# old_value = calculate()",
    "# print(old_value)",
    "# if old_value:",
    "#     return old_value",
    "",
  ].join("\n"));

  const graph = buildGraph();
  const findings = detectCommentedOutCodeFindings({
    graph,
    targetSymbolIds: new Set(["mod:sample:foo"]),
    targetFiles: new Set(["sample.py"]),
    scanRoot,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.type, "commented_out_code");
  assert.equal(findings[0]?.startLine, 4);
  assert.equal(findings[0]?.symbolId, "mod:sample:foo");
  assert.match(findings[0]?.summary ?? "", /deaktivierter code/i);
});
