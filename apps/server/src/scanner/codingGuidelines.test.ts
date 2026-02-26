import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Symbol } from "@dmpg/shared";
import {
  buildCodingGuidelinesForSymbol,
  detectNamingStyle,
  evaluateCodingGuidelinesFromLines,
} from "./codingGuidelines.js";

test("detectNamingStyle classifies common naming styles", () => {
  assert.equal(detectNamingStyle("my_function"), "snake_case");
  assert.equal(detectNamingStyle("MyClass"), "PascalCase");
  assert.equal(detectNamingStyle("MAX_VALUE"), "UPPER_SNAKE_CASE");
  assert.equal(detectNamingStyle("doStuff"), "camelCase");
});

test("evaluateCodingGuidelinesFromLines penalizes tabs, long lines and deep nesting", () => {
  const lines = [
    "def do_bad():",
    "\tif True:",
    "\t\tif True:",
    "\t\t\tif True:",
    "\t\t\t\tif True:",
    "\t\t\t\t\tif True:",
    `\t\t\t\t\t\tvalue = "${"x".repeat(130)}"`,
    "\t\t\t\t\t\treturn value",
  ];

  const result = evaluateCodingGuidelinesFromLines("function", "do_bad", lines);
  assert.equal(result.indentation.consistent, false);
  assert.ok(result.readability.longLineCount > 0);
  assert.ok(result.complexity.maxNestingDepth > 4);
  assert.ok(result.score < 85);
  assert.ok(result.recommendations.length > 0);
});

test("buildCodingGuidelinesForSymbol reads location slice and returns metrics", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-guidelines-"));
  const relFile = "sample.py";
  const absFile = path.join(tmpDir, relFile);
  fs.writeFileSync(
    absFile,
    [
      "def helper():",
      "    # this is fine",
      "    value = 1",
      "    return value",
      "",
      "class MyType:",
      "    pass",
      "",
    ].join("\n"),
    "utf-8",
  );

  const symbol: Symbol = {
    id: "mod:sample:helper",
    label: "helper",
    kind: "function",
    location: { file: relFile, startLine: 1, endLine: 4 },
  };

  const result = buildCodingGuidelinesForSymbol(symbol, tmpDir, new Map());
  assert.ok(result);
  assert.equal(result?.complexity.lineCount, 4);
  assert.equal(result?.naming.compliant, true);
  assert.equal(result?.indentation.consistent, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
