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

/** Title-case a directory/project name: "data_pipeline" → "Data Pipeline" */
function toTitleCase(s: string): string {
  return s
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
    const { stdout, stderr } = await execFileAsync("python", [pyScript, absPath], {
      maxBuffer: 100 * 1024 * 1024,
      timeout: 300_000,
    });
    if (stderr) console.warn("[scanner] Python stderr:", stderr);
    result = JSON.parse(stdout);
    if (result && (result as any).error) {
      throw new Error(`Scanner error: ${(result as any).error}`);
    }
  } catch (err: any) {
    // If the first attempt failed, try python3
    if (err.code === "ENOENT" || (err.message && err.message.includes("ENOENT"))) {
      try {
        const { stdout, stderr } = await execFileAsync("python3", [pyScript, absPath], {
          maxBuffer: 100 * 1024 * 1024,
          timeout: 300_000,
        });
        if (stderr) console.warn("[scanner] Python3 stderr:", stderr);
        result = JSON.parse(stdout);
        if (result && (result as any).error) {
          throw new Error(`Scanner error: ${(result as any).error}`);
        }
      } catch (err2: any) {
        const stderr2 = err2.stderr ? `\nstderr: ${err2.stderr}` : "";
        throw new Error(`Failed to run Python scanner: ${err2.message}${stderr2}`);
      }
    } else {
      // Extract stderr from the execFile error for better diagnostics
      const stderrMsg = err.stderr ? `\nstderr: ${err.stderr}` : "";
      // Try to parse partial stdout (scanner may have written error JSON before exiting)
      if (err.stdout) {
        try {
          const partial = JSON.parse(err.stdout);
          if (partial.error) {
            throw new Error(`Scanner error: ${partial.error}\n${partial.traceback || ""}${stderrMsg}`);
          }
        } catch {
          // stdout was not valid JSON, ignore
        }
      }
      throw new Error(`Failed to run Python scanner: ${err.message}${stderrMsg}`);
    }
  }

  // Load project config if available
  const config = loadProjectConfig(absPath);

  return buildGraphFromScan(result, absPath, config);
}

/* ── Config loading ─────────────────────────────── */

function loadProjectConfig(projectPath: string): ProjectConfig | null {
  const configPath = path.join(projectPath, "dmpg-uml.config.json");
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.sections && Array.isArray(parsed.sections)) {
        return parsed as ProjectConfig;
      }
    } catch {
      // fall through
    }
  }
  return null; // No config → dynamic directory-based grouping
}

/* ── Graph construction ─────────────────────────── */

function buildGraphFromScan(
  raw: ScanResult,
  projectPath: string,
  config: ProjectConfig | null,
): ProjectGraph {
  const DOMAIN_DEFS = [
    { id: "data-sources", title: "Datenquellen" },
    { id: "orchestration", title: "Datenpipeline & Orchestrierung" },
    { id: "analytics", title: "Analytik & Modellierung" },
    { id: "simulation", title: "Simulation" },
    { id: "utilities", title: "Utilities / Shared" },
    { id: "artifacts", title: "Externe Artefakte" },
  ] as const;

  function classifyDomain(text: string): string {
    const normalized = text.toLowerCase();
    if (/(connector|extract|source|sql|db|database|druid|mes|input|loader|ingest)/i.test(normalized)) return "data-sources";
    if (/(distribution|fit|analy|stat|model|kde|forecast|ml|train|predict|visual)/i.test(normalized)) return "analytics";
    if (/(simulat|arrival|scheduler|event|process|engine)/i.test(normalized)) return "simulation";
    if (/(util|helper|common|shared|const|enum|config|types|core)/i.test(normalized)) return "utilities";
    if (/(artifact|output|export|json|csv|xlsx|excel|parquet|pkl|file)/i.test(normalized)) return "artifacts";
    return "orchestration";
  }
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

  // ── Group top-level symbols ──
  let sectionGroups: Symbol[];

  if (config) {
    // ── Pattern-based grouping (from dmpg-uml.config.json) ──
    const sections = config.sections;
    sectionGroups = sections.map((sec) => ({
      id: `grp:${sec.id}`,
      label: sec.title,
      kind: "group" as const,
      childViewId: `view:grp:${sec.id}`,
      tags: [`section:${sec.id}`],
    }));

    const sectionPatterns = sections.map((sec) => ({
      id: `grp:${sec.id}`,
      regex: new RegExp(sec.patterns.join("|"), "i"),
    }));
    const defaultGroupId = sectionPatterns[sectionPatterns.length - 1]?.id ?? sectionGroups[0]?.id;

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
  } else {
    // ── Dynamic directory-based grouping (recursive) ──
    // Derive groups from the actual folder structure of scanned modules.
    // If a directory has more than MAX_GROUP_SIZE modules, create nested
    // sub-groups from deeper directory levels automatically.
    const MAX_GROUP_SIZE = 10;
    const MIN_GROUP_SIZE = 2;

    /**
     * Extract the directory path at a given depth from a file path.
     * Only considers directory segments (filename is excluded).
     * Returns "__root__" for files at the project root.
     */
    function getDirAtDepth(file: string, depth: number): string {
      const normalized = file.replace(/\\/g, "/");
      const segments = normalized.split("/").filter(Boolean);
      // Last segment is the filename — remove it
      const dirSegments = segments.slice(0, -1);
      if (dirSegments.length === 0) return "__root__";
      // If requested depth exceeds available dirs, return full dir path
      if (depth > dirSegments.length) return dirSegments.join("/");
      return dirSegments.slice(0, depth).join("/");
    }

    /**
     * Recursively build groups from directory tree. Returns the created group symbols.
     * - Modules sitting directly in the parent directory (no deeper sub-dir) get
     *   assigned to the parent group instead of creating a duplicate.
     * - Groups with fewer than MIN_GROUP_SIZE members get dissolved into the parent.
     */
    function buildDirGroups(
      mods: Symbol[],
      depth: number,
      parentGroupId: string | null,
      parentPath: string,
    ): Symbol[] {
      // Partition modules by their directory at the given depth
      const dirMap = new Map<string, Symbol[]>();
      const directChildren: Symbol[] = []; // files that sit in parentPath, not in a sub-dir

      for (const sym of mods) {
        const file = sym.location?.file ?? "";
        const dir = getDirAtDepth(file, depth);
        // If dir === parentPath, this module is a direct child of the parent dir
        // (no deeper directory structure). Assign to parent, don't create a sub-group.
        if (parentGroupId && dir === parentPath) {
          directChildren.push(sym);
        } else {
          if (!dirMap.has(dir)) dirMap.set(dir, []);
          dirMap.get(dir)!.push(sym);
        }
      }

      // Assign direct children to the parent group (they stay in the parent, not a sub-group)
      for (const m of directChildren) {
        m.parentId = parentGroupId!;
      }

      // Sort directories alphabetically, __root__ last
      const sortedDirs = [...dirMap.keys()].sort((a, b) => {
        if (a === "__root__") return 1;
        if (b === "__root__") return -1;
        return a.localeCompare(b);
      });

      const groups: Symbol[] = [];

      for (const dir of sortedDirs) {
        const modules = dirMap.get(dir)!;
        const groupId = `grp:dir:${dir}`;
        const dirName = dir === "__root__"
          ? path.basename(projectPath)
          : dir.split("/").pop() ?? dir;
        const label = toTitleCase(dirName);

        const grp: Symbol = {
          id: groupId,
          label,
          kind: "group",
          childViewId: `view:${groupId}`,
          tags: [`dir:${dir}`],
        };
        if (parentGroupId) grp.parentId = parentGroupId;
        groups.push(grp);

        // Check if this group is too large and can be split further
        if (modules.length > MAX_GROUP_SIZE && depth < 5) {
          // Check if there are actual sub-directories at the next level
          const subDirs = new Set<string>();
          for (const m of modules) {
            const file = m.location?.file ?? "";
            const sub = getDirAtDepth(file, depth + 1);
            // Only count dirs that are deeper than the current dir
            if (sub !== dir) subDirs.add(sub);
          }

          if (subDirs.size > 1) {
            // Multiple sub-directories — recurse
            const subGroups = buildDirGroups(modules, depth + 1, groupId, dir);
            groups.push(...subGroups);
          } else {
            // No further directory nesting — assign flat
            // (AI split phase will handle thematic splitting later)
            for (const mod of modules) {
              mod.parentId = groupId;
            }
          }
        } else {
          // Small enough or max depth reached — assign modules to this group
          for (const mod of modules) {
            mod.parentId = groupId;
          }
        }
      }

      // ── Post-process: collapse tiny sub-groups into parent ──
      // If a sub-group has fewer than MIN_GROUP_SIZE members and has a parent,
      // dissolve it and move its members back to the parent.
      if (parentGroupId) {
        const tinyGroups = groups.filter(
          (g) =>
            g.parentId === parentGroupId &&
            !groups.some((sg) => sg.parentId === g.id), // no child-groups of its own
        );
        for (const tiny of tinyGroups) {
          const members = mods.filter((m) => m.parentId === tiny.id);
          if (members.length < MIN_GROUP_SIZE) {
            // Dissolve: move members back to parent
            for (const m of members) {
              m.parentId = parentGroupId;
            }
            // Remove the tiny group from the list
            const idx = groups.indexOf(tiny);
            if (idx >= 0) groups.splice(idx, 1);
            console.log(`[Scanner] Dissolved tiny group "${tiny.label}" (${members.length} members) into parent`);
          }
        }
      }

      return groups;
    }

    // Collect top-level (unassigned) symbols
    const unassigned = symbols.filter((s) => !s.parentId);
    const allGroups = buildDirGroups(unassigned, 1, null, "");

    // All groups go into sectionGroups (needed for view/edge creation).
    // Tag top-level groups for root view identification.
    const topLevelGroupIds = new Set(allGroups.filter((g) => !g.parentId).map((g) => g.id));
    sectionGroups = allGroups.map((g) => {
      if (topLevelGroupIds.has(g.id)) {
        g.tags = [...(g.tags ?? []), "top-level"];
      }
      return g;
    });
  }

  // ── Add explicit top-level domain layers above generated groups ──
  const domainGroups: Symbol[] = DOMAIN_DEFS.map((d) => ({
    id: `grp:domain:${d.id}`,
    label: d.title,
    kind: "group",
    childViewId: `view:grp:domain:${d.id}`,
    tags: ["domain-layer", `domain:${d.id}`],
  }));
  const domainById = new Map(domainGroups.map((d) => [d.id.replace("grp:domain:", ""), d.id]));

  // Only classify top-level groups; keep nested groups as-is.
  for (const group of sectionGroups) {
    if (group.parentId) continue;
    const descendants = symbols.filter((s) => s.parentId === group.id);
    const descendantText = descendants
      .map((s) => `${s.label} ${s.location?.file ?? ""}`)
      .join(" ");
    const signal = `${group.label} ${(group.tags ?? []).join(" ")} ${descendantText}`;
    const domain = classifyDomain(signal);
    group.parentId = domainById.get(domain);
  }

  // Add all domain groups so they are visible in root and get their own views.
  sectionGroups = [...domainGroups, ...sectionGroups];

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

  // 3) Group Views: each group gets a view showing its direct children (modules + sub-groups)
  const groupViews: DiagramView[] = sectionGroups.map((g) => {
    // Direct child modules (symbols whose parentId is this group)
    const groupModules = symbols.filter((s) => s.parentId === g.id);
    // Direct child sub-groups (groups whose parentId is this group)
    const childGroups = sectionGroups.filter((sg) => sg.parentId === g.id);
    const childIds = [...groupModules.map((m) => m.id), ...childGroups.map((sg) => sg.id)];
    const childIdSet = new Set(childIds);

    const viewEdgeRefs = relations
      .filter((r) => r.type !== "contains" && (childIdSet.has(r.source) || childIdSet.has(r.target)))
      .map((r) => r.id);

    // Determine parentViewId: if this group has a parent group, point to that group's view; else root
    const parentViewId = g.parentId ? `view:${g.parentId}` : "view:root";

    return {
      id: `view:${g.id}`,
      title: g.label,
      parentViewId,
      scope: "group" as const,
      nodeRefs: childIds,
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

  // 4) Root view — only top-level groups (no parentId) as nodeRefs
  const topLevelGroups = sectionGroups.filter((g) => !g.parentId);
  const rootNodeRefs = topLevelGroups.map((g) => g.id);
  const rootEdgeRefs: string[] = []; // Edge projection handles cross-edges

  const rootView: DiagramView = {
    id: "view:root",
    title: `${toTitleCase(path.basename(projectPath))} — Overview`,
    parentViewId: null,
    scope: "root",
    nodeRefs: rootNodeRefs,
    edgeRefs: rootEdgeRefs,
  };

  // Add contains edges for group → module AND group → sub-group
  const groupIdSet = new Set(sectionGroups.map((g) => g.id));
  for (const sym of symbols) {
    if (sym.parentId && groupIdSet.has(sym.parentId)) {
      containsEdges.push({
        id: `contains-${containsIdx++}`,
        type: "contains",
        source: sym.parentId,
        target: sym.id,
      });
    }
  }
  // Sub-group containment
  for (const g of sectionGroups) {
    if (g.parentId && groupIdSet.has(g.parentId)) {
      containsEdges.push({
        id: `contains-${containsIdx++}`,
        type: "contains",
        source: g.parentId,
        target: g.id,
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
