import fs from "node:fs";
import path from "node:path";
import type { CodingGuidelines, Symbol, SymbolKind } from "@dmpg/shared";

const MAX_RECOMMENDATIONS = 6;
const LINE_LENGTH_LIMIT = 120;
const FUNCTION_LENGTH_LIMIT = 60;
const MAX_PREFERRED_NESTING = 4;

type NamingStyle = CodingGuidelines["naming"]["detected"];

const EXPECTED_NAMING_BY_KIND: Partial<Record<SymbolKind, NamingStyle>> = {
  module: "snake_case",
  package: "snake_case",
  function: "snake_case",
  method: "snake_case",
  class: "PascalCase",
  interface: "PascalCase",
  constant: "UPPER_SNAKE_CASE",
  variable: "snake_case",
};

function normalizeSymbolName(label: string): string {
  const afterDot = label.includes(".") ? label.split(".").pop() ?? label : label;
  return afterDot.includes(":") ? (afterDot.split(":").pop() ?? afterDot) : afterDot;
}

export function detectNamingStyle(rawLabel: string): NamingStyle {
  const label = normalizeSymbolName(rawLabel);
  if (!label) return "unknown";
  if (/^[A-Z][A-Z0-9_]*$/.test(label)) return "UPPER_SNAKE_CASE";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(label)) return "PascalCase";
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(label)) return "snake_case";
  if (/^[a-z][a-zA-Z0-9]*$/.test(label)) return "camelCase";
  return "mixed";
}

function expectedNamingStyle(kind: SymbolKind): NamingStyle | "unknown" {
  return EXPECTED_NAMING_BY_KIND[kind] ?? "unknown";
}

function nestingDepthForLine(line: string): number {
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? "";
  if (!indent) return 0;
  const tabCount = (indent.match(/\t/g) ?? []).length;
  const spaceCount = (indent.match(/ /g) ?? []).length;
  const width = tabCount * 4 + spaceCount;
  return Math.max(0, Math.floor(width / 4));
}

export function evaluateCodingGuidelinesFromLines(
  kind: SymbolKind,
  label: string,
  lines: string[],
): CodingGuidelines {
  const normalizedLines = lines.map((line) => line.replace(/\r/g, ""));
  const lineCount = normalizedLines.length;

  const tabs = normalizedLines.filter((line) => /^\t+/.test(line)).length;
  const spaces = normalizedLines.filter((line) => /^ +/.test(line)).length;
  const indentationConsistent = tabs === 0;

  const contentLines = normalizedLines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  });
  const maxNestingDepth = contentLines.reduce((maxDepth, line) => {
    return Math.max(maxDepth, nestingDepthForLine(line));
  }, 0);

  const longLineCount = normalizedLines.filter((line) => line.length > LINE_LENGTH_LIMIT).length;
  const commentLineCount = normalizedLines.filter((line) => line.trim().startsWith("#")).length;
  const commentRatio = lineCount > 0 ? commentLineCount / lineCount : 0;

  const expected = expectedNamingStyle(kind);
  const detected = detectNamingStyle(label);
  const compliant = expected === "unknown" || detected === expected;
  const hasNamingExpectation = Object.prototype.hasOwnProperty.call(
    EXPECTED_NAMING_BY_KIND,
    kind,
  );

  const functionTooLong =
    (kind === "function" || kind === "method") && lineCount > FUNCTION_LENGTH_LIMIT;
  const deepNesting = maxNestingDepth > MAX_PREFERRED_NESTING;

  let score = 100;
  if (!compliant) score -= 15;
  if (!indentationConsistent) score -= Math.min(20, tabs * 2);
  if (functionTooLong) score -= Math.min(20, Math.ceil((lineCount - FUNCTION_LENGTH_LIMIT) / 8) * 2);
  if (deepNesting) score -= Math.min(20, (maxNestingDepth - MAX_PREFERRED_NESTING) * 4);
  if (longLineCount > 0) score -= Math.min(20, longLineCount * 2);
  if (lineCount >= 20 && commentRatio < 0.03) score -= 8;
  score = Math.max(0, Math.min(100, score));

  const recommendations: string[] = [];
  if (!indentationConsistent) {
    recommendations.push("Use spaces instead of tabs for consistent indentation.");
  }
  if (!compliant && hasNamingExpectation) {
    recommendations.push(`Rename symbol to follow ${expected}.`);
  }
  if (functionTooLong) {
    recommendations.push("Split long function into smaller focused units.");
  }
  if (deepNesting) {
    recommendations.push("Reduce nesting depth by extracting guard clauses/helpers.");
  }
  if (longLineCount > 0) {
    recommendations.push(`Wrap lines above ${LINE_LENGTH_LIMIT} characters.`);
  }
  if (lineCount >= 20 && commentRatio < 0.03) {
    recommendations.push("Add comments/docstrings for non-obvious logic.");
  }

  return {
    score,
    naming: {
      expected,
      detected,
      compliant,
    },
    indentation: {
      tabs,
      spaces,
      consistent: indentationConsistent,
    },
    complexity: {
      lineCount,
      maxNestingDepth,
      functionTooLong,
      deepNesting,
    },
    readability: {
      longLineCount,
      commentLineCount,
      commentRatio: Number(commentRatio.toFixed(3)),
    },
    recommendations: recommendations.slice(0, MAX_RECOMMENDATIONS),
  };
}

function loadFileLinesCached(
  projectPath: string,
  relativeFilePath: string,
  fileCache: Map<string, string[] | null>,
): string[] | null {
  const absolutePath = path.resolve(projectPath, relativeFilePath);
  if (fileCache.has(absolutePath)) {
    return fileCache.get(absolutePath) ?? null;
  }
  try {
    const raw = fs.readFileSync(absolutePath, "utf-8");
    const lines = raw.split(/\n/);
    fileCache.set(absolutePath, lines);
    return lines;
  } catch {
    fileCache.set(absolutePath, null);
    return null;
  }
}

export function buildCodingGuidelinesForSymbol(
  symbol: Symbol,
  projectPath: string,
  fileCache: Map<string, string[] | null>,
): CodingGuidelines | undefined {
  const location = symbol.location;
  if (!location?.file) return undefined;

  const fileLines = loadFileLinesCached(projectPath, location.file, fileCache);
  if (!fileLines || fileLines.length === 0) return undefined;

  const start = Math.max(1, location.startLine ?? 1);
  const end = Math.max(start, location.endLine ?? fileLines.length);
  const snippet = fileLines.slice(start - 1, end);
  if (snippet.length === 0) return undefined;

  return evaluateCodingGuidelinesFromLines(symbol.kind, symbol.label, snippet);
}
