import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import type {
  ProjectGraph,
  Symbol,
  Relation,
  DiagramView,
  SectionConfig,
  ProjectConfig,
} from "@dmpg/shared";

const execFileAsync = promisify(execFile);

/* ── Raw scanner output types ────────────────────── */

interface RawSymbol {
  id: string;
  label: string;
  kind: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  parentId?: string;
  doc?: Record<string, unknown>;
  tags?: string[];
}
interface RawEdge {
  source: string;
  target: string;
  type: string;
  confidence?: number;
  evidence?: Record<string, unknown>;
}
interface ScanResult {
  symbols: RawSymbol[];
  edges: RawEdge[];
  meta?: Record<string, unknown>;
}

/* ── Default section config (fallback) ──────────── */

const DEFAULT_SECTIONS: SectionConfig[] = [
  {
    id: "pipeline",
    title: "Pipeline / Orchestration",
    patterns: ["main", "pipeline", "orchestrat", "generate", "run", "app", "cli"],
  },
  {
    id: "connectors",
    title: "Connectors / Infrastructure",
    patterns: ["connect", "db", "database", "sql", "druid", "api", "client", "adapter", "http"],
  },
  {
    id: "analytics",
    title: "Analytics / Domain",
    patterns: ["model", "distribut", "stat", "analyt", "fit", "calc", "compute", "process", "domain"],
  },
  {
    id: "utilities",
    title: "Utilities / Shared",
    patterns: ["util", "helper", "const", "config", "common", "shared", "filter", "bath", "enum"],
  },
];

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
      timeout: 120_000,
    });
    result = JSON.parse(stdout);
  } catch (err: any) {
    // fallback: try python3
    try {
      const { stdout } = await execFileAsync("python3", [pyScript, absPath], {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 120_000,
      });
      result = JSON.parse(stdout);
    } catch {
      throw new Error(`Failed to run Python scanner: ${err.message}`);
    }
  }

  // Load project config if available
  const config = loadProjectConfig(absPath);

  return buildGraphFromScan(result, absPath, config);
}

/* ── Config loading ─────────────────────────────── */

function loadProjectConfig(projectPath: string): ProjectConfig {
  const configPath = path.join(projectPath, "dmpg-uml.config.json");
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.sections && Array.isArray(parsed.sections)) {
        return parsed as ProjectConfig;
      }
    } catch {
      // fall through to default
    }
  }
  return { sections: DEFAULT_SECTIONS, autoFallback: true };
}

/* ── Graph construction ─────────────────────────── */

function buildGraphFromScan(
  raw: ScanResult,
  projectPath: string,
  config: ProjectConfig,
): ProjectGraph {
  // Convert raw symbols
  const symbols: Symbol[] = raw.symbols.map((s) => ({
    id: s.id,
    label: s.label,
    kind: (s.kind as any) ?? "module",
    location: s.file ? { file: s.file, startLine: s.startLine, endLine: s.endLine } : undefined,
    doc: s.doc as any,
    parentId: s.parentId,
    tags: s.tags ?? [],
  }));

  // Convert raw edges
  let edgeIdx = 0;
  const relations: Relation[] = raw.edges.map((e) => {
    const rel: Relation = {
      id: `scan-e${edgeIdx++}`,
      type: (e.type as any) ?? "imports",
      source: e.source,
      target: e.target,
    };
    if (e.confidence != null) rel.confidence = e.confidence;
    else if (e.type === "calls") rel.confidence = 0.8;
    else rel.confidence = 1;
    if (e.evidence) rel.evidence = [e.evidence as any];
    return rel;
  });

  // Build symbol lookup maps
  const symById = new Map(symbols.map((s) => [s.id, s]));

  // ── Auto-group top-level symbols into sections ──
  const sections = config.sections;
  const sectionGroups: Symbol[] = sections.map((sec) => ({
    id: `grp:${sec.id}`,
    label: sec.title,
    kind: "group",
    childViewId: `view:grp:${sec.id}`,
    tags: [`section:${sec.id}`],
  }));

  // Compile patterns
  const sectionPatterns = sections.map((sec) => ({
    id: `grp:${sec.id}`,
    regex: new RegExp(sec.patterns.join("|"), "i"),
  }));
  const defaultGroupId = sectionPatterns[sectionPatterns.length - 1]?.id ?? sectionGroups[0]?.id;

  // Assign top-level symbols (those without parentId) to groups
  for (const sym of symbols) {
    if (!sym.parentId) {
      const text = `${sym.label} ${sym.location?.file ?? ""}`.toLowerCase();
      let matched = false;
      for (const sp of sectionPatterns) {
        if (sp.regex.test(text)) {
          sym.parentId = sp.id;
          matched = true;
          break;
        }
      }
      if (!matched && config.autoFallback !== false) {
        sym.parentId = defaultGroupId;
      }
    }
  }

  // ── Build multi-level views ──

  const allViews: DiagramView[] = [];
  const containsEdges: Relation[] = [];
  let containsIdx = 0;

  // 1) Module-Level Views: for each module, create a child view with its classes/functions
  for (const sym of symbols) {
    if (sym.kind === "module") {
      const children = symbols.filter((s) => s.parentId === sym.id);
      if (children.length > 0) {
        const viewId = `view:${sym.id}`;
        sym.childViewId = viewId;

        const childIds = new Set(children.map((c) => c.id));
        const viewEdgeRefs = relations
          .filter((r) => r.type !== "contains" && (childIds.has(r.source) || childIds.has(r.target)))
          .map((r) => r.id);

        allViews.push({
          id: viewId,
          title: sym.label,
          parentViewId: null, // will be set when we know the group view
          scope: "module",
          nodeRefs: children.map((c) => c.id),
          edgeRefs: viewEdgeRefs,
        });
      }
    }
  }

  // 2) Class-Level Views: for each class, create a child view with its methods
  for (const sym of symbols) {
    if (sym.kind === "class") {
      const methods = symbols.filter((s) => s.parentId === sym.id);
      if (methods.length > 0) {
        const viewId = `view:${sym.id}`;
        sym.childViewId = viewId;

        const methodIds = new Set(methods.map((m) => m.id));
        const viewEdgeRefs = relations
          .filter((r) => r.type !== "contains" && (methodIds.has(r.source) || methodIds.has(r.target)))
          .map((r) => r.id);

        // Find parent module's view
        const parentMod = sym.parentId ? symById.get(sym.parentId) : null;
        const parentViewId = parentMod?.childViewId ?? null;

        allViews.push({
          id: viewId,
          title: sym.label,
          parentViewId: parentViewId,
          scope: "class",
          nodeRefs: methods.map((m) => m.id),
          edgeRefs: viewEdgeRefs,
        });
      }
    }
  }

  // 3) Group Views: each section group gets a view of its modules
  const groupViews: DiagramView[] = sectionGroups.map((g) => {
    const groupModules = symbols.filter((s) => s.parentId === g.id);
    const moduleIds = new Set(groupModules.map((m) => m.id));

    const viewEdgeRefs = relations
      .filter((r) => r.type !== "contains" && (moduleIds.has(r.source) || moduleIds.has(r.target)))
      .map((r) => r.id);

    return {
      id: `view:${g.id}`,
      title: g.label,
      parentViewId: "view:root",
      scope: "group" as const,
      nodeRefs: groupModules.map((m) => m.id),
      edgeRefs: viewEdgeRefs,
    };
  });

  // Set parentViewId for module views to their group view
  for (const mv of allViews) {
    if (mv.scope === "module" && !mv.parentViewId) {
      const modId = mv.id.replace("view:", "");
      const modSym = symById.get(modId);
      if (modSym?.parentId) {
        mv.parentViewId = `view:${modSym.parentId}`;
      }
    }
  }

  // 4) Root view
  const rootNodeRefs = sectionGroups.map((g) => g.id);
  const rootEdgeRefs: string[] = []; // Edge projection handles cross-edges

  const rootView: DiagramView = {
    id: "view:root",
    title: "Level 0 — Overview",
    parentViewId: null,
    scope: "root",
    nodeRefs: rootNodeRefs,
    edgeRefs: rootEdgeRefs,
  };

  // Add contains edges for group → module
  for (const sym of symbols) {
    if (sym.parentId && sectionGroups.some((g) => g.id === sym.parentId)) {
      containsEdges.push({
        id: `contains-${containsIdx++}`,
        type: "contains",
        source: sym.parentId,
        target: sym.id,
      });
    }
  }

  // ── Artifact clustering: collapse external nodes into categorized sub-groups ──
  // Categories for artifact classification
  const ARTIFACT_CATEGORIES: Array<{ id: string; title: string; icon: string; patterns: RegExp }> = [
    { id: "data-files", title: "📊 Data Files", icon: "📊", patterns: /\.(csv|xlsx?|xls|tsv|parquet|feather|h5|hdf5?|arrow|dat|sas7bdat)$/i },
    { id: "config", title: "⚙️ Configuration", icon: "⚙️", patterns: /\.(json|ya?ml|toml|ini|cfg|conf|env|properties|xml)$|config|settings|\.env/i },
    { id: "database", title: "🗄️ Database / Storage", icon: "🗄️", patterns: /\.(db|sqlite|sql|pkl|pickle|joblib|shelve)$|database|druid|mongo|redis|sql|table|schema/i },
    { id: "network", title: "🌐 Network / API", icon: "🌐", patterns: /https?:|api|endpoint|url|request|response|http|socket|grpc|rest/i },
    { id: "code-libs", title: "📦 Libraries / Imports", icon: "📦", patterns: /^(pd|np|os|sys|re|json|csv|math|datetime|logging|pathlib|typing|collections|functools|itertools|subprocess|shutil|argparse|unittest|pytest|scipy|sklearn|matplotlib|seaborn|plotly|bokeh|pandas|numpy|torch|tensorflow|keras|flask|django|fastapi|requests|httpx|aiohttp|sqlalchemy|pydantic|dataclass)/i },
    { id: "io-ops", title: "💾 I/O Operations", icon: "💾", patterns: /read|write|load|save|dump|open|close|stream|buffer|file|path|directory|folder|makedirs|mkdir|copy|move|rename|delete|remove|glob|listdir|walk|scandir/i },
    { id: "visualization", title: "📈 Visualization", icon: "📈", patterns: /plot|chart|graph|figure|axes?|subplot|hist|bar|scatter|line|heatmap|pie|legend|title|xlabel|ylabel|show|savefig|imshow|canvas|widget|display|render|draw/i },
    { id: "transform", title: "🔄 Transformations", icon: "🔄", patterns: /transform|convert|parse|format|encode|decode|serialize|deserialize|map|filter|reduce|sort|merge|concat|join|split|strip|replace|regex|match|search|sub|groupby|aggregate|pivot|melt|stack|unstack|apply|lambda|comprehension/i },
    { id: "types-models", title: "🏗️ Types / Models", icon: "🏗️", patterns: /^(int|float|str|bool|list|dict|tuple|set|object|Enum|dataclass|namedtuple|TypedDict|Union|Optional|Any|Literal|Protocol|ABC|Abstract|Base|Mixin|Interface|Schema|Model|Form|Serializer|Validator)/i },
    { id: "misc", title: "📄 Other Artifacts", icon: "📄", patterns: /.*/ }, // catch-all
  ];

  function classifyArtifact(label: string, symId: string, rels: Relation[]): string {
    // Check relation types first for better classification
    const relTypes = new Set(rels.filter((r) => r.source === symId || r.target === symId).map((r) => r.type));
    if (relTypes.has("reads") || relTypes.has("writes")) {
      // Check if it looks like a data file
      if (ARTIFACT_CATEGORIES[0].patterns.test(label)) return "data-files";
      if (ARTIFACT_CATEGORIES[2].patterns.test(label)) return "database";
      if (ARTIFACT_CATEGORIES[5].patterns.test(label)) return "io-ops";
    }
    // Pattern-based classification (skip catch-all, check explicitly)
    for (const cat of ARTIFACT_CATEGORIES.slice(0, -1)) {
      if (cat.patterns.test(label)) return cat.id;
    }
    return "misc";
  }

  const allSymbols = [...sectionGroups, ...symbols];
  const allRelations = [...relations, ...containsEdges];
  const artifactGroups: Symbol[] = [];
  const artifactContains: Relation[] = [];
  const artifactViews: DiagramView[] = [];

  const allViewsList = [rootView, ...groupViews, ...allViews];
  for (const view of allViewsList) {
    const externalsInView = view.nodeRefs.filter((id) => {
      const sym = allSymbols.find((s) => s.id === id);
      return sym?.kind === "external";
    });

    if (externalsInView.length <= 3) continue; // keep individual nodes if few

    // Create the top-level artifact cluster
    const clusterId = `grp:artifacts:${view.id}`;
    const clusterViewId = `view:artifacts:${view.id}`;

    // Classify each artifact into categories
    const catMap = new Map<string, string[]>(); // categoryId → [symbolIds]
    for (const extId of externalsInView) {
      const extSym = allSymbols.find((s) => s.id === extId);
      const label = extSym?.label ?? extId;
      const catId = classifyArtifact(label, extId, allRelations);
      const arr = catMap.get(catId) ?? [];
      arr.push(extId);
      catMap.set(catId, arr);
    }

    // Determine if we need sub-grouping (total > 10)
    const needsSubGroups = externalsInView.length > 10;
    const subGroupNodes: string[] = []; // IDs for the artifact cluster view's nodeRefs
    const directArtifacts: string[] = []; // artifacts that go directly into cluster view (small categories)

    if (needsSubGroups) {
      // Create sub-group for each category that has items
      for (const [catId, extIds] of catMap) {
        if (extIds.length === 0) continue;
        const catDef = ARTIFACT_CATEGORIES.find((c) => c.id === catId) ?? ARTIFACT_CATEGORIES[ARTIFACT_CATEGORIES.length - 1];

        if (extIds.length <= 3) {
          // Small category: put artifacts directly in cluster view (sorted)
          const sorted = [...extIds].sort((a, b) => {
            const la = allSymbols.find((s) => s.id === a)?.label ?? a;
            const lb = allSymbols.find((s) => s.id === b)?.label ?? b;
            return la.localeCompare(lb);
          });
          directArtifacts.push(...sorted);
          for (const eid of sorted) {
            const extSym = allSymbols.find((s) => s.id === eid);
            if (extSym) extSym.parentId = clusterId;
            artifactContains.push({
              id: `contains-${containsIdx++}`,
              type: "contains",
              source: clusterId,
              target: eid,
            });
          }
        } else {
          // Larger category: create a sub-group node with its own view
          const subGroupId = `grp:art-cat:${catId}:${view.id}`;
          const subGroupViewId = `view:art-cat:${catId}:${view.id}`;

          artifactGroups.push({
            id: subGroupId,
            label: `${catDef.title} (${extIds.length})`,
            kind: "group",
            childViewId: subGroupViewId,
            tags: ["artifact-category", `art-cat:${catId}`],
          });

          subGroupNodes.push(subGroupId);

          // Sort artifacts alphabetically within category
          const sorted = [...extIds].sort((a, b) => {
            const la = allSymbols.find((s) => s.id === a)?.label ?? a;
            const lb = allSymbols.find((s) => s.id === b)?.label ?? b;
            return la.localeCompare(lb);
          });

          for (const eid of sorted) {
            const extSym = allSymbols.find((s) => s.id === eid);
            if (extSym) extSym.parentId = subGroupId;
            artifactContains.push({
              id: `contains-${containsIdx++}`,
              type: "contains",
              source: subGroupId,
              target: eid,
            });
          }

          // Contains edge: cluster → sub-group
          artifactContains.push({
            id: `contains-${containsIdx++}`,
            type: "contains",
            source: clusterId,
            target: subGroupId,
          });

          // Create the sub-category view
          const catExtSet = new Set(sorted);
          const catEdgeRefs = allRelations
            .filter((r) => r.type !== "contains" && (catExtSet.has(r.source) || catExtSet.has(r.target)))
            .map((r) => r.id);

          artifactViews.push({
            id: subGroupViewId,
            title: `${catDef.title} — ${view.title}`,
            parentViewId: clusterViewId,
            scope: "group",
            nodeRefs: sorted,
            edgeRefs: catEdgeRefs,
          });
        }
      }
    } else {
      // ≤10 artifacts: put all directly in cluster view (sorted)
      const sorted = [...externalsInView].sort((a, b) => {
        const la = allSymbols.find((s) => s.id === a)?.label ?? a;
        const lb = allSymbols.find((s) => s.id === b)?.label ?? b;
        return la.localeCompare(lb);
      });
      directArtifacts.push(...sorted);
      for (const eid of sorted) {
        const extSym = allSymbols.find((s) => s.id === eid);
        if (extSym) extSym.parentId = clusterId;
        artifactContains.push({
          id: `contains-${containsIdx++}`,
          type: "contains",
          source: clusterId,
          target: eid,
        });
      }
    }

    // Create the main artifact cluster symbol
    artifactGroups.push({
      id: clusterId,
      label: `📁 Artifacts (${externalsInView.length})`,
      kind: "group",
      childViewId: clusterViewId,
      tags: ["artifact-cluster"],
    });

    // Create the artifact cluster view (contains sub-groups + any direct artifacts)
    const clusterNodeRefs = [...subGroupNodes, ...directArtifacts];
    const extSet = new Set(externalsInView);
    const clusterEdgeRefs = allRelations
      .filter((r) => r.type !== "contains" && (extSet.has(r.source) || extSet.has(r.target)))
      .map((r) => r.id);

    artifactViews.push({
      id: clusterViewId,
      title: `Artifacts — ${view.title}`,
      parentViewId: view.id,
      scope: "group",
      nodeRefs: clusterNodeRefs,
      edgeRefs: clusterEdgeRefs,
    });

    // Replace individual external IDs with cluster ID in the parent view
    view.nodeRefs = [
      ...view.nodeRefs.filter((id) => !extSet.has(id)),
      clusterId,
    ];
  }

  return {
    symbols: [...allSymbols, ...artifactGroups],
    relations: [...allRelations, ...artifactContains],
    views: [...allViewsList, ...artifactViews],
    rootViewId: "view:root",
    projectPath,
  };
}
