import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import type { ProjectGraph, Symbol, Relation, DiagramView } from "@dmpg/shared";

const execFileAsync = promisify(execFile);

interface RawSymbol {
  id: string;
  label: string;
  kind: string;
  file: string;
  startLine?: number;
  endLine?: number;
  parentId?: string;
}
interface RawEdge {
  source: string;
  target: string;
  type: string;
}
interface ScanResult {
  symbols: RawSymbol[];
  edges: RawEdge[];
}

/**
 * Scan a project directory. Currently supports Python projects.
 */
export async function scanProject(projectPath: string): Promise<ProjectGraph> {
  const absPath = path.resolve(projectPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Path does not exist: ${absPath}`);
  }

  // Try Python scanner
  const pyScript = path.join(import.meta.dirname ?? __dirname, "python_scanner.py");
  let result: ScanResult;
  try {
    const { stdout } = await execFileAsync("python", [pyScript, absPath], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60_000,
    });
    result = JSON.parse(stdout);
  } catch (err: any) {
    // fallback: try python3
    try {
      const { stdout } = await execFileAsync("python3", [pyScript, absPath], {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60_000,
      });
      result = JSON.parse(stdout);
    } catch {
      throw new Error(`Failed to run Python scanner: ${err.message}`);
    }
  }

  return buildGraphFromScan(result, absPath);
}

function buildGraphFromScan(raw: ScanResult, projectPath: string): ProjectGraph {
  const symbols: Symbol[] = raw.symbols.map((s) => ({
    id: s.id,
    label: s.label,
    kind: (s.kind as any) ?? "module",
    location: { file: s.file, startLine: s.startLine, endLine: s.endLine },
    parentId: s.parentId,
    tags: [],
  }));

  let edgeIdx = 0;
  const relations: Relation[] = raw.edges.map((e) => ({
    id: `scan-e${edgeIdx++}`,
    type: (e.type as any) ?? "imports",
    source: e.source,
    target: e.target,
    confidence: e.type === "calls" ? 0.8 : 1,
  }));

  // Auto-group into 4 sections heuristically
  const groups = autoGroup(symbols);
  const groupSymbols: Symbol[] = groups.map((g) => ({
    id: g.id,
    label: g.label,
    kind: "group",
    childViewId: `view:${g.id}`,
    tags: [`layer:${g.label.toLowerCase()}`],
  }));

  // Assign parentIds
  for (const sym of symbols) {
    if (!sym.parentId) {
      const grp = findGroup(sym, groups);
      if (grp) sym.parentId = grp.id;
    }
  }

  // Build views
  const rootNodeRefs = groupSymbols.map((g) => g.id);
  const rootEdgeRefs = relations
    .filter((r) => {
      const srcGrp = symbols.find((s) => s.id === r.source)?.parentId;
      const tgtGrp = symbols.find((s) => s.id === r.target)?.parentId;
      return srcGrp && tgtGrp && srcGrp !== tgtGrp;
    })
    .map((r) => r.id);

  const rootView: DiagramView = {
    id: "view:root",
    title: "Level 0 — Overview",
    parentViewId: null,
    nodeRefs: rootNodeRefs,
    edgeRefs: rootEdgeRefs,
  };

  const childViews: DiagramView[] = groups.map((g) => ({
    id: `view:${g.id}`,
    title: g.label,
    parentViewId: "view:root",
    nodeRefs: symbols.filter((s) => s.parentId === g.id).map((s) => s.id),
    edgeRefs: relations
      .filter((r) => {
        const src = symbols.find((s) => s.id === r.source);
        const tgt = symbols.find((s) => s.id === r.target);
        return src?.parentId === g.id || tgt?.parentId === g.id;
      })
      .map((r) => r.id),
  }));

  // Add contains edges for groups
  const containsEdges: Relation[] = [];
  for (const sym of symbols) {
    if (sym.parentId && groupSymbols.find((g) => g.id === sym.parentId)) {
      containsEdges.push({
        id: `contains-${sym.id}`,
        type: "contains",
        source: sym.parentId,
        target: sym.id,
      });
    }
  }

  return {
    symbols: [...groupSymbols, ...symbols],
    relations: [...relations, ...containsEdges],
    views: [rootView, ...childViews],
    rootViewId: "view:root",
    projectPath,
  };
}

interface GroupDef {
  id: string;
  label: string;
  patterns: RegExp[];
}

function autoGroup(symbols: Symbol[]): GroupDef[] {
  const groups: GroupDef[] = [
    { id: "grp:pipeline", label: "Pipeline / Orchestration", patterns: [/main|pipeline|orchestrat|generate|run|app|cli/i] },
    { id: "grp:connectors", label: "Connectors / Infrastructure", patterns: [/connect|db|database|sql|druid|api|client|adapter|http/i] },
    { id: "grp:analytics", label: "Analytics / Domain", patterns: [/model|distribut|stat|analyt|fit|calc|compute|process|domain/i] },
    { id: "grp:utilities", label: "Utilities / Shared", patterns: [/util|helper|const|config|common|shared|filter|bath|enum/i] },
  ];
  return groups;
}

function findGroup(sym: Symbol, groups: GroupDef[]): GroupDef | undefined {
  const text = `${sym.label} ${sym.location?.file ?? ""}`.toLowerCase();
  for (const g of groups) {
    if (g.patterns.some((p) => p.test(text))) return g;
  }
  // default to utilities
  return groups[groups.length - 1];
}
