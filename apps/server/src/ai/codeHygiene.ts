import {
  bestNavigableViewForSymbol,
  type ProjectAnalysisFinding,
  type ProjectGraph,
  type Symbol as GraphSymbol,
} from "@dmpg/shared";
import * as fs from "node:fs";
import * as path from "node:path";

interface LoadedSourceFile {
  file: string;
  absPath: string;
  content: string;
  lines: string[];
}

interface FindingMatchContext {
  graph: ProjectGraph;
  symbolIds: Set<string>;
}

interface UnreachableBlock {
  startLine: number;
  endLine: number;
  triggerLine: number;
  triggerText: string;
  reason: string;
  codePreview: string;
}

interface CommentBlock {
  startLine: number;
  endLine: number;
  codePreview: string;
  lineCount: number;
}

type CachedFile = LoadedSourceFile | null;

function normalizeFilePath(file: string): string {
  return file.replace(/\\/g, "/");
}

function createFindingId(prefix: string, file: string, startLine: number, suffix?: string): string {
  const normalizedFile = normalizeFilePath(file).replace(/[^a-zA-Z0-9/_-]+/g, "-");
  return `${prefix}:${normalizedFile}:${startLine}${suffix ? `:${suffix}` : ""}`;
}

function countIndent(rawLine: string): number {
  let indent = 0;
  for (const char of rawLine) {
    if (char === " ") indent += 1;
    else if (char === "\t") indent += 4;
    else break;
  }
  return indent;
}

function stripCommentPrefix(line: string): { isComment: boolean; text: string } {
  const trimmed = line.trim();
  if (!trimmed) return { isComment: false, text: "" };

  if (trimmed.startsWith("#")) {
    return { isComment: true, text: trimmed.replace(/^#+\s?/, "") };
  }
  if (trimmed.startsWith("//")) {
    return { isComment: true, text: trimmed.replace(/^\/\/+\s?/, "") };
  }
  if (trimmed.startsWith("/*")) {
    return { isComment: true, text: trimmed.replace(/^\/\*+\s?/, "").replace(/\*\/\s*$/, "") };
  }
  if (trimmed.startsWith("*")) {
    return { isComment: true, text: trimmed.replace(/^\*+\s?/, "").replace(/\*\/\s*$/, "") };
  }
  if (trimmed.startsWith("*/")) {
    return { isComment: true, text: "" };
  }

  return { isComment: false, text: trimmed };
}

function isLikelyCommentedCodeLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(todo|fixme|note|warning|why|because)\b/i.test(trimmed)) return false;
  if (/^[A-Z][A-Za-z ]+[.!?]?$/.test(trimmed) && !/[(){}\[\]=:;,.]/.test(trimmed)) return false;

  return (
    /\b(def|class|return|yield|raise|import|from|if|elif|else|for|while|try|except|finally|with|lambda)\b/.test(trimmed) ||
    /\b(function|const|let|var|return|throw|import|export|if|else|for|while|switch|case|await|async)\b/.test(trimmed) ||
    /^[A-Za-z_][\w.]*\s*=\s*.+$/.test(trimmed) ||
    /^[A-Za-z_][\w.]*\([^)]*\)\s*$/.test(trimmed) ||
    /[{}\[\];]/.test(trimmed) ||
    /=>/.test(trimmed) ||
    /self\.[A-Za-z_][\w]*/.test(trimmed) ||
    /\.[A-Za-z_][\w]*\(/.test(trimmed) ||
    /:\s*$/.test(trimmed)
  );
}

function buildCodePreview(lines: string[], startLine: number, endLine: number, limit = 6): string {
  return lines
    .slice(startLine - 1, Math.min(endLine, startLine - 1 + limit))
    .map((line) => line.trimEnd())
    .join("\n");
}

function resolveSourceFile(
  scanRoot: string,
  file: string,
  cache: Map<string, CachedFile>,
): LoadedSourceFile | null {
  const cacheKey = normalizeFilePath(file);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  const absPath = path.isAbsolute(file) ? file : path.join(scanRoot, file);
  try {
    const content = fs.readFileSync(absPath, "utf-8");
    const loaded = {
      file,
      absPath,
      content,
      lines: content.split(/\r?\n/),
    } satisfies LoadedSourceFile;
    cache.set(cacheKey, loaded);
    return loaded;
  } catch {
    cache.set(cacheKey, null);
    return null;
  }
}

function resolveOwningSymbol(
  context: FindingMatchContext,
  file: string,
  startLine: number,
  endLine: number,
): GraphSymbol | null {
  const candidates = context.graph.symbols
    .filter((symbol) => context.symbolIds.has(symbol.id))
    .filter((symbol) => normalizeFilePath(symbol.location?.file ?? "") === normalizeFilePath(file))
    .filter((symbol) => {
      const symbolStart = symbol.location?.startLine ?? 0;
      const symbolEnd = symbol.location?.endLine ?? Number.MAX_SAFE_INTEGER;
      return symbolStart <= startLine && symbolEnd >= endLine;
    })
    .sort((left, right) => {
      const leftSize = (left.location?.endLine ?? Number.MAX_SAFE_INTEGER) - (left.location?.startLine ?? 0);
      const rightSize = (right.location?.endLine ?? Number.MAX_SAFE_INTEGER) - (right.location?.startLine ?? 0);
      return leftSize - rightSize || left.id.localeCompare(right.id);
    });

  return candidates[0] ?? null;
}

function finalizeFinding(
  finding: Omit<ProjectAnalysisFinding, "viewId" | "symbolId" | "symbolLabel">,
  context: FindingMatchContext,
): ProjectAnalysisFinding {
  const owningSymbol = resolveOwningSymbol(context, finding.file, finding.startLine, finding.endLine ?? finding.startLine);
  return {
    ...finding,
    symbolId: owningSymbol?.id,
    symbolLabel: owningSymbol?.label,
    viewId: owningSymbol ? bestNavigableViewForSymbol(context.graph, owningSymbol.id) ?? undefined : undefined,
  };
}

function detectStaticFalseCondition(trimmed: string): string | null {
  if (/^(if|elif|while)\s+(False|0)\s*:/.test(trimmed)) {
    return `Bedingung "${trimmed}" ist statisch falsch; der Block wird nie erreicht.`;
  }
  if (/^(if|while)\s*\(\s*false\s*\)/i.test(trimmed)) {
    return `Bedingung "${trimmed}" ist statisch falsch; der Block wird nie erreicht.`;
  }
  return null;
}

function detectUnreachableBlocks(symbol: GraphSymbol, source: LoadedSourceFile): UnreachableBlock[] {
  if (!symbol.location?.startLine || !symbol.location?.endLine) return [];

  const startLine = symbol.location.startLine;
  const endLine = Math.min(symbol.location.endLine, source.lines.length);
  const symbolLines = source.lines.slice(startLine - 1, endLine);
  const blockers: Array<{ indent: number; triggerLine: number; triggerText: string; reason: string; mode: "terminal" | "false_condition" }> = [];
  const findings: UnreachableBlock[] = [];
  let active: UnreachableBlock | null = null;

  for (let index = 0; index < symbolLines.length; index += 1) {
    const absoluteLine = startLine + index;
    const rawLine = symbolLines[index] ?? "";
    const trimmed = rawLine.trim();
    const indent = countIndent(rawLine);

    while (blockers.length > 0) {
      const lastBlocker = blockers[blockers.length - 1]!;
      const shouldPop = indent < lastBlocker.indent
        || (lastBlocker.mode === "false_condition" && indent <= lastBlocker.indent);
      if (!shouldPop) break;
      blockers.pop();
    }

    const blocker = [...blockers].reverse().find((entry) =>
      entry.mode === "terminal"
        ? indent >= entry.indent && absoluteLine > entry.triggerLine
        : indent > entry.indent && absoluteLine > entry.triggerLine,
    );

    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }

    if (blocker) {
      if (!active) {
        active = {
          startLine: absoluteLine,
          endLine: absoluteLine,
          triggerLine: blocker.triggerLine,
          triggerText: blocker.triggerText,
          reason: blocker.reason,
          codePreview: rawLine.trimEnd(),
        };
      } else {
        active.endLine = absoluteLine;
        active.codePreview = `${active.codePreview}\n${rawLine.trimEnd()}`;
      }
      continue;
    }

    if (active) {
      findings.push({
        ...active,
        codePreview: active.codePreview.split("\n").slice(0, 6).join("\n"),
      });
      active = null;
    }

    const staticFalseReason = detectStaticFalseCondition(trimmed);
    if (staticFalseReason) {
      blockers.push({
        indent,
        triggerLine: absoluteLine,
        triggerText: trimmed,
        reason: staticFalseReason,
        mode: "false_condition",
      });
      continue;
    }

    const terminalMatch = trimmed.match(/^(return|raise|break|continue|throw)\b/);
    if (terminalMatch) {
      const keyword = terminalMatch[1];
      blockers.push({
        indent,
        triggerLine: absoluteLine,
        triggerText: keyword,
        reason: `Code nach "${keyword}" ist in diesem Block nicht mehr erreichbar.`,
        mode: "terminal",
      });
    }
  }

  if (active) {
    findings.push({
      ...active,
      codePreview: active.codePreview.split("\n").slice(0, 6).join("\n"),
    });
  }

  return findings;
}

function detectCommentBlocks(source: LoadedSourceFile): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  let startLine = 0;
  const lines: Array<{ lineNumber: number; text: string }> = [];

  const flush = () => {
    if (lines.length === 0 || startLine <= 0) return;
    const codeLikeLines = lines.filter((entry) => isLikelyCommentedCodeLine(entry.text));
    const hasStrongSignal = codeLikeLines.length >= 2
      || (codeLikeLines.length >= 1 && codeLikeLines.some((entry) => /[=(){}\[\];:]/.test(entry.text)));

    if (hasStrongSignal) {
      const endLine = lines[lines.length - 1]!.lineNumber;
      blocks.push({
        startLine,
        endLine,
        lineCount: lines.length,
        codePreview: lines.map((entry) => entry.text).slice(0, 6).join("\n"),
      });
    }

    startLine = 0;
    lines.length = 0;
  };

  source.lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const parsed = stripCommentPrefix(rawLine);
    if (!parsed.isComment) {
      flush();
      return;
    }

    if (startLine === 0) {
      startLine = lineNumber;
    }
    lines.push({ lineNumber, text: parsed.text.trimEnd() });
  });

  flush();
  return blocks;
}

export function detectCommentedOutCodeFindings(params: {
  graph: ProjectGraph;
  targetSymbolIds: Set<string>;
  targetFiles: Iterable<string>;
  scanRoot: string;
  cache?: Map<string, CachedFile>;
}): ProjectAnalysisFinding[] {
  const cache = params.cache ?? new Map<string, CachedFile>();
  const context: FindingMatchContext = {
    graph: params.graph,
    symbolIds: params.targetSymbolIds,
  };
  const findings: ProjectAnalysisFinding[] = [];

  for (const file of params.targetFiles) {
    const source = resolveSourceFile(params.scanRoot, file, cache);
    if (!source) continue;

    for (const block of detectCommentBlocks(source)) {
      findings.push(finalizeFinding({
        id: createFindingId("commented", file, block.startLine),
        type: "commented_out_code",
        title: "Auskommentierter Code",
        summary: `${block.lineCount} Kommentarzeilen wirken wie deaktivierter Code und nicht wie normale Dokumentation.`,
        file,
        startLine: block.startLine,
        endLine: block.endLine,
        codePreview: block.codePreview,
      }, context));
    }
  }

  return findings;
}

export function detectUnreachableCodeFindings(params: {
  graph: ProjectGraph;
  targetSymbolIds: Set<string>;
  scanRoot: string;
  cache?: Map<string, CachedFile>;
}): ProjectAnalysisFinding[] {
  const cache = params.cache ?? new Map<string, CachedFile>();
  const context: FindingMatchContext = {
    graph: params.graph,
    symbolIds: params.targetSymbolIds,
  };
  const findings: ProjectAnalysisFinding[] = [];

  for (const symbol of params.graph.symbols) {
    if (!params.targetSymbolIds.has(symbol.id)) continue;
    if (symbol.kind !== "function" && symbol.kind !== "method") continue;
    if (!symbol.location?.file) continue;

    const source = resolveSourceFile(params.scanRoot, symbol.location.file, cache);
    if (!source) continue;

    for (const block of detectUnreachableBlocks(symbol, source)) {
      findings.push(finalizeFinding({
        id: createFindingId("dead", symbol.location.file, block.startLine, symbol.id),
        type: "dead_code",
        deadCodeKind: "unreachable_code",
        title: "Unerreichbarer Code",
        summary: block.reason,
        file: symbol.location.file,
        startLine: block.startLine,
        endLine: block.endLine,
        codePreview: block.codePreview || buildCodePreview(source.lines, block.startLine, block.endLine),
      }, context));
    }
  }

  return findings;
}

export function sortProjectAnalysisFindings(findings: ProjectAnalysisFinding[]): ProjectAnalysisFinding[] {
  return [...findings].sort((left, right) =>
    left.type.localeCompare(right.type) ||
    normalizeFilePath(left.file).localeCompare(normalizeFilePath(right.file)) ||
    left.startLine - right.startLine ||
    left.id.localeCompare(right.id),
  );
}
