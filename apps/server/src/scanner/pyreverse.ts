import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Relation, RelationType, Symbol } from "@dmpg/shared";

const execFileAsync = promisify(execFile);

const PYREVERSE_RELATION_TYPES = new Set<RelationType>([
  "inherits",
  "realizes",
  "association",
  "aggregation",
  "composition",
  "dependency",
]);

const UML_MULTIPLICITY_PATTERN = /^(\*|\d+|\d+\.\.\*|\d+\.\.\d+|0\.\.\*|0\.\.1|1\.\.\*)$/;

export interface PyreverseMember {
  name: string;
  type?: string;
  raw?: string;
}

export interface PyreverseClass {
  name: string;
  alias?: string;
  stereotype?: "class" | "interface";
  attributes: PyreverseMember[];
  methods: PyreverseMember[];
}

export interface PyreverseRelation {
  sourceName: string;
  targetName: string;
  type: RelationType;
  label?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceRole?: string;
  targetRole?: string;
}

export interface PyreverseModel {
  classes: PyreverseClass[];
  relations: PyreverseRelation[];
  warnings: string[];
}

export interface PyreverseMergeTarget {
  symbols: Symbol[];
  relations: Relation[];
}

export interface PyreverseMergeStats {
  classesMatched: number;
  membersAdded: number;
  relationsAdded: number;
  relationsUpdated: number;
  unmatchedRelations: number;
}

interface EndpointRef {
  name: string;
  multiplicity?: string;
}

interface ResolvedRelation {
  source: EndpointRef;
  target: EndpointRef;
  type: RelationType;
  label?: string;
}

interface PyreverseCommandCandidate {
  command: string;
  args: string[];
}

let cachedUnavailablePyreverseWarning: string | null = null;
let returnedUnavailablePyreverseWarning = false;

function emptyModel(warnings: string[] = []): PyreverseModel {
  return { classes: [], relations: [], warnings };
}

function stripQuotedIdentifier(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function shortName(name: string): string {
  const normalized = name.replace(/\\/g, ".").replace(/:+/g, ".");
  const parts = normalized.split(".").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function normalizeLookupName(name: string): string {
  return stripQuotedIdentifier(name)
    .replace(/^::/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isMultiplicity(value: string | undefined): value is string {
  return !!value && UML_MULTIPLICITY_PATTERN.test(value.trim());
}

function isRelationType(value: string): value is RelationType {
  return PYREVERSE_RELATION_TYPES.has(value as RelationType);
}

function parseMember(rawLine: string): PyreverseMember | null {
  const raw = rawLine.trim();
  if (!raw || raw === "--" || raw.startsWith("{")) return null;

  const cleaned = raw
    .replace(/^\s*[+\-#~]\s*/, "")
    .replace(/\{(?:field|method|static|abstract)\}/gi, "")
    .replace(/<<[^>]+>>/g, "")
    .trim();
  if (!cleaned) return null;

  const methodIndex = cleaned.indexOf("(");
  if (methodIndex >= 0) {
    const methodName = cleaned.slice(0, methodIndex).trim().split(/\s+/).pop();
    if (!methodName) return null;
    return { name: methodName, raw };
  }

  const [namePart, typePart] = cleaned.split(/:/, 2);
  const name = (namePart ?? "").trim().split(/\s+/).pop();
  if (!name) return null;
  const type = typePart?.trim() || undefined;
  return { name, type, raw };
}

function addClass(classes: Map<string, PyreverseClass>, next: PyreverseClass): void {
  const key = normalizeLookupName(next.alias ?? next.name);
  const existing = classes.get(key) ?? classes.get(normalizeLookupName(next.name));
  if (!existing) {
    classes.set(key, next);
    classes.set(normalizeLookupName(next.name), next);
    if (next.alias) classes.set(normalizeLookupName(next.alias), next);
    return;
  }

  const existingAttributes = new Set(existing.attributes.map((member) => member.name));
  const existingMethods = new Set(existing.methods.map((member) => member.name));
  for (const attribute of next.attributes) {
    if (!existingAttributes.has(attribute.name)) existing.attributes.push(attribute);
  }
  for (const method of next.methods) {
    if (!existingMethods.has(method.name)) existing.methods.push(method);
  }
  existing.stereotype = existing.stereotype ?? next.stereotype;
}

function parsePumlClassBlock(
  declaration: string,
  rawName: string,
  alias: string | undefined,
  body: string,
): PyreverseClass {
  const attributes: PyreverseMember[] = [];
  const methods: PyreverseMember[] = [];

  for (const line of body.split(/\r?\n/)) {
    const member = parseMember(line);
    if (!member) continue;
    if (member.raw?.includes("(")) methods.push(member);
    else attributes.push(member);
  }

  return {
    name: stripQuotedIdentifier(rawName),
    alias: alias ? stripQuotedIdentifier(alias) : undefined,
    stereotype: declaration.toLowerCase().includes("interface") ? "interface" : "class",
    attributes,
    methods,
  };
}

function splitPumlRelationLabel(line: string): { relation: string; label?: string } {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\"") quoted = !quoted;
    if (char === ":" && !quoted) {
      const label = line.slice(index + 1).trim();
      return {
        relation: line.slice(0, index).trim(),
        label: label || undefined,
      };
    }
  }
  return { relation: line.trim() };
}

function parseEndpoint(segment: string): EndpointRef | null {
  const quotedValues = [...segment.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim() ?? "");
  const multiplicity = quotedValues.find(isMultiplicity);
  const unquoted = segment.replace(/"[^"]*"/g, " ").trim();
  const token = unquoted.split(/\s+/).find(Boolean);
  const quotedName = quotedValues.find((value) => !isMultiplicity(value));
  const name = stripQuotedIdentifier(token ?? quotedName ?? "");
  if (!name) return null;
  return { name, multiplicity };
}

function resolvePumlRelation(left: EndpointRef, operator: string, right: EndpointRef): ResolvedRelation | null {
  const dashed = operator.includes("..");
  const normalized = operator.replace(/\s+/g, "");

  if (normalized.includes("<|") || normalized.includes("|>")) {
    const pointsLeft = normalized.startsWith("<|");
    return {
      source: pointsLeft ? right : left,
      target: pointsLeft ? left : right,
      type: dashed ? "realizes" : "inherits",
    };
  }

  if (normalized.includes("o")) {
    const diamondAtLeft = normalized.startsWith("o") || normalized.startsWith("<>") || normalized.includes("<o");
    return {
      source: diamondAtLeft ? left : right,
      target: diamondAtLeft ? right : left,
      type: "aggregation",
    };
  }

  if (normalized.includes("*")) {
    const diamondAtLeft = normalized.startsWith("*") || normalized.includes("<*");
    return {
      source: diamondAtLeft ? left : right,
      target: diamondAtLeft ? right : left,
      type: "composition",
    };
  }

  if (dashed) {
    const pointsLeft = normalized.startsWith("<") || normalized.includes("<..");
    return {
      source: pointsLeft ? right : left,
      target: pointsLeft ? left : right,
      type: "dependency",
    };
  }

  return {
    source: left,
    target: right,
    type: "association",
  };
}

function relationWithEndpointMetadata(resolved: ResolvedRelation, label?: string): PyreverseRelation {
  const simpleRole = label && /^[A-Za-z_][\w.]*$/.test(label) ? label : undefined;
  const roleBearingRelation = resolved.type === "association" ||
    resolved.type === "aggregation" ||
    resolved.type === "composition";
  return {
    sourceName: resolved.source.name,
    targetName: resolved.target.name,
    type: resolved.type,
    label,
    sourceMultiplicity: resolved.source.multiplicity,
    targetMultiplicity: resolved.target.multiplicity,
    targetRole: roleBearingRelation ? simpleRole : undefined,
  };
}

function parsePumlRelationLine(line: string): PyreverseRelation | null {
  const { relation, label } = splitPumlRelationLabel(line);
  const match = relation.match(/^\s*(.+?)\s+([<|o*]*[.-]+[|>o*]*|[<|o*]+[.-]+[|>o*]*)\s+(.+?)\s*$/);
  if (!match) return null;

  const left = parseEndpoint(match[1] ?? "");
  const operator = match[2] ?? "";
  const right = parseEndpoint(match[3] ?? "");
  if (!left || !right) return null;

  const resolved = resolvePumlRelation(left, operator, right);
  return resolved ? relationWithEndpointMetadata(resolved, label) : null;
}

export function parsePyreversePuml(source: string): PyreverseModel {
  const classMap = new Map<string, PyreverseClass>();
  const warnings: string[] = [];

  const classBlockPattern =
    /(?:^|\n)\s*((?:abstract\s+)?(?:class|interface))\s+("[^"]+"|[^\s{]+)(?:\s+as\s+("[^"]+"|[^\s{]+))?\s*\{([\s\S]*?)\}/g;

  const withoutBlocks = source.replace(
    classBlockPattern,
    (_full, declaration: string, rawName: string, alias: string | undefined, body: string) => {
      addClass(classMap, parsePumlClassBlock(declaration, rawName, alias, body));
      return "\n";
    },
  );

  const declarationPattern = /^\s*((?:abstract\s+)?(?:class|interface))\s+("[^"]+"|[^\s{]+)(?:\s+as\s+("[^"]+"|[^\s{]+))?/gm;
  for (const match of withoutBlocks.matchAll(declarationPattern)) {
    const rawName = match[2];
    if (!rawName) continue;
    addClass(classMap, {
      name: stripQuotedIdentifier(rawName),
      alias: match[3] ? stripQuotedIdentifier(match[3]) : undefined,
      stereotype: (match[1] ?? "").toLowerCase().includes("interface") ? "interface" : "class",
      attributes: [],
      methods: [],
    });
  }

  const aliasToName = new Map<string, string>();
  for (const cls of new Set(classMap.values())) {
    aliasToName.set(normalizeLookupName(cls.name), cls.name);
    if (cls.alias) aliasToName.set(normalizeLookupName(cls.alias), cls.name);
  }

  const relations: PyreverseRelation[] = [];
  for (const line of withoutBlocks.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("@") ||
      trimmed.startsWith("'") ||
      trimmed.startsWith("skinparam") ||
      /^(class|interface|abstract\s+class)\s+/i.test(trimmed)
    ) {
      continue;
    }

    const parsed = parsePumlRelationLine(trimmed);
    if (!parsed) continue;
    parsed.sourceName = aliasToName.get(normalizeLookupName(parsed.sourceName)) ?? parsed.sourceName;
    parsed.targetName = aliasToName.get(normalizeLookupName(parsed.targetName)) ?? parsed.targetName;
    relations.push(parsed);
  }

  return {
    classes: [...new Set(classMap.values())],
    relations,
    warnings,
  };
}

function parseDotAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /([A-Za-z_][\w]*)\s*=\s*(?:"([^"]*)"|([^,\]]+))/g;
  for (const match of raw.matchAll(attrPattern)) {
    const key = match[1];
    const value = (match[2] ?? match[3] ?? "").trim();
    if (key) attrs.set(key, value);
  }
  return attrs;
}

function dotLabelToClass(rawLabel: string, fallbackName: string): PyreverseClass {
  const normalized = rawLabel
    .replace(/\\l/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
  const withoutOuterBraces = normalized.replace(/^\{|\}$/g, "");
  const sections = withoutOuterBraces.split("|");
  const className = (sections[0] ?? fallbackName).split(/\r?\n/).find(Boolean)?.trim() || fallbackName;
  const attributes = (sections[1] ?? "")
    .split(/\r?\n/)
    .map(parseMember)
    .filter((member): member is PyreverseMember => Boolean(member));
  const methods = (sections[2] ?? "")
    .split(/\r?\n/)
    .map(parseMember)
    .filter((member): member is PyreverseMember => Boolean(member));

  return {
    name: stripQuotedIdentifier(className),
    alias: fallbackName,
    stereotype: "class",
    attributes,
    methods,
  };
}

function dotRelationFromEdge(sourceName: string, targetName: string, attrs: Map<string, string>): PyreverseRelation | null {
  const arrowhead = (attrs.get("arrowhead") ?? "").toLowerCase();
  const arrowtail = (attrs.get("arrowtail") ?? "").toLowerCase();
  const style = (attrs.get("style") ?? "").toLowerCase();
  const label = attrs.get("label")?.trim() || undefined;

  if (arrowhead.includes("empty") || arrowhead.includes("onormal")) {
    return {
      sourceName,
      targetName,
      type: style.includes("dashed") ? "realizes" : "inherits",
      label,
    };
  }
  if (arrowtail.includes("odiamond")) {
    return { sourceName, targetName, type: "aggregation", label, targetRole: label };
  }
  if (arrowtail.includes("diamond")) {
    return { sourceName, targetName, type: "composition", label, targetRole: label };
  }
  if (arrowhead.includes("odiamond")) {
    return { sourceName: targetName, targetName: sourceName, type: "aggregation", label, targetRole: label };
  }
  if (arrowhead.includes("diamond")) {
    return { sourceName: targetName, targetName: sourceName, type: "composition", label, targetRole: label };
  }
  if (style.includes("dashed")) {
    return { sourceName, targetName, type: "dependency", label };
  }
  return { sourceName, targetName, type: "association", label, targetRole: label };
}

export function parsePyreverseDot(source: string): PyreverseModel {
  const classes = new Map<string, PyreverseClass>();
  const relations: PyreverseRelation[] = [];
  const warnings: string[] = [];

  const nodePattern = /^\s*"?(?<name>[A-Za-z0-9_.$:]+)"?\s+\[(?<attrs>[^\]]*label\s*=[^\]]*)\]\s*;?/gm;
  for (const match of source.matchAll(nodePattern)) {
    const name = match.groups?.name;
    const attrsRaw = match.groups?.attrs;
    if (!name || !attrsRaw || attrsRaw.includes("->")) continue;
    const attrs = parseDotAttributes(attrsRaw);
    const label = attrs.get("label");
    if (!label) continue;
    addClass(classes, dotLabelToClass(label, name));
  }

  const edgePattern = /^\s*"?(?<source>[A-Za-z0-9_.$:]+)"?\s*->\s*"?(?<target>[A-Za-z0-9_.$:]+)"?\s*(?:\[(?<attrs>[^\]]*)\])?\s*;?/gm;
  for (const match of source.matchAll(edgePattern)) {
    const sourceName = match.groups?.source;
    const targetName = match.groups?.target;
    if (!sourceName || !targetName) continue;
    const relation = dotRelationFromEdge(sourceName, targetName, parseDotAttributes(match.groups?.attrs ?? ""));
    if (relation) relations.push(relation);
  }

  return { classes: [...new Set(classes.values())], relations, warnings };
}

function mergeModels(models: PyreverseModel[]): PyreverseModel {
  const classMap = new Map<string, PyreverseClass>();
  const relationKeys = new Set<string>();
  const relations: PyreverseRelation[] = [];
  const warnings: string[] = [];

  for (const model of models) {
    warnings.push(...model.warnings);
    for (const cls of model.classes) addClass(classMap, cls);
    for (const relation of model.relations) {
      const key = [
        normalizeLookupName(relation.sourceName),
        normalizeLookupName(relation.targetName),
        relation.type,
        relation.label ?? "",
      ].join("|");
      if (relationKeys.has(key)) continue;
      relationKeys.add(key);
      relations.push(relation);
    }
  }

  return { classes: [...new Set(classMap.values())], relations, warnings };
}

function readGeneratedPyreverseFiles(outputDir: string): PyreverseModel {
  const models: PyreverseModel[] = [];
  for (const entry of fs.readdirSync(outputDir)) {
    const fullPath = path.join(outputDir, entry);
    if (!fs.statSync(fullPath).isFile()) continue;
    if (entry.endsWith(".puml")) {
      models.push(parsePyreversePuml(fs.readFileSync(fullPath, "utf-8")));
    } else if (entry.endsWith(".dot")) {
      models.push(parsePyreverseDot(fs.readFileSync(fullPath, "utf-8")));
    }
  }
  return mergeModels(models);
}

function buildPyreverseCandidates(projectPath: string, outputDir: string): PyreverseCommandCandidate[] {
  const baseArgs = [
    "--output=puml",
    "--project=dmpg_pyreverse",
    "--output-directory",
    outputDir,
    "--all-ancestors",
    "--all-associated",
    "--module-names=y",
    projectPath,
  ];
  return [
    { command: "pyreverse", args: baseArgs },
    { command: "python", args: ["-m", "pylint.pyreverse.main", ...baseArgs] },
    { command: "python3", args: ["-m", "pylint.pyreverse.main", ...baseArgs] },
  ];
}

function summarizePyreverseCommandError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "unknown error");
  if (/ENOENT/i.test(rawMessage)) return "command not found";
  if (/ModuleNotFoundError:\s+No module named 'pylint'/i.test(rawMessage)) {
    return "Python pylint module is not installed";
  }

  const compactLine = rawMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("Command failed:"));
  const summary = (compactLine ?? rawMessage.trim()) || "unknown error";
  return summary.length > 220 ? `${summary.slice(0, 217)}...` : summary;
}

function buildPyreverseUnavailableWarning(failures: string[]): string {
  const joined = failures.join("; ");
  const commandMissing = failures.some((failure) => failure.includes("pyreverse: command not found"));
  const pylintMissing = failures.some((failure) => failure.includes("pylint module is not installed"));

  if (commandMissing && pylintMissing) {
    return "Pyreverse unavailable; AST fallback active (`pyreverse` is not on PATH and Python `pylint` is not installed). Install it with `python -m pip install -r apps/server/requirements.txt` or set PYREVERSE_ENABLED=false.";
  }

  return `Pyreverse unavailable; AST fallback active: ${joined || "no parseable UML output"}.`;
}

function unavailablePyreverseModel(warning: string): PyreverseModel {
  cachedUnavailablePyreverseWarning = warning;
  if (returnedUnavailablePyreverseWarning) return emptyModel();
  returnedUnavailablePyreverseWarning = true;
  return emptyModel([warning]);
}

export async function scanPyreverse(
  projectPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<PyreverseModel> {
  if (cachedUnavailablePyreverseWarning) {
    return unavailablePyreverseModel(cachedUnavailablePyreverseWarning);
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-pyreverse-"));
  const warnings: string[] = [];
  const failures: string[] = [];

  try {
    for (const candidate of buildPyreverseCandidates(projectPath, outputDir)) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Scan aborted");
      try {
        const { stderr } = await execFileAsync(candidate.command, candidate.args, {
          cwd: projectPath,
          encoding: "utf-8",
          maxBuffer: 16 * 1024 * 1024,
          timeout: 120_000,
          windowsHide: true,
          signal: options.signal,
        });
        if (stderr) warnings.push(`[pyreverse] ${stderr.trim()}`);
        const parsed = readGeneratedPyreverseFiles(outputDir);
        parsed.warnings.unshift(...warnings);
        if (parsed.classes.length > 0 || parsed.relations.length > 0) return parsed;
        failures.push(`${candidate.command}: no parseable UML output`);
      } catch (error) {
        if (options.signal?.aborted || (error as { name?: string })?.name === "AbortError") {
          throw error;
        }
        failures.push(`${candidate.command}: ${summarizePyreverseCommandError(error)}`);
      }
    }
  } finally {
    try {
      fs.rmSync(outputDir, { recursive: true, force: true });
    } catch {
      // Temporary output cleanup is best-effort.
    }
  }

  return unavailablePyreverseModel(buildPyreverseUnavailableWarning(failures));
}

function classFullName(symbol: Symbol, symbolsById: Map<string, Symbol>): string {
  if (symbol.id.startsWith("mod:")) return symbol.id.slice(4).replace(/:/g, ".");
  if (symbol.parentId) {
    const parent = symbolsById.get(symbol.parentId);
    if (parent?.id.startsWith("mod:")) return `${parent.id.slice(4)}.${symbol.label}`;
  }
  const idMatch = symbol.id.match(/^mod:(.+):([^:.]+)$/);
  if (idMatch) return `${idMatch[1]}.${idMatch[2]}`;
  return symbol.label;
}

function buildClassResolver(symbols: Symbol[]): (name: string) => Symbol | null {
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const exact = new Map<string, Symbol>();
  const byShortName = new Map<string, Symbol[]>();

  for (const symbol of symbols) {
    if (!(symbol.kind === "class" || symbol.kind === "interface" || symbol.kind === "external")) continue;
    const fullName = classFullName(symbol, symbolsById);
    for (const candidate of [symbol.id, fullName]) {
      const key = normalizeLookupName(candidate);
      exact.set(key, symbol);
    }
    for (const candidate of new Set([symbol.label, shortName(fullName)])) {
      const key = normalizeLookupName(candidate);
      byShortName.set(key, [...(byShortName.get(key) ?? []), symbol]);
    }
  }

  return (name: string) => {
    const normalized = normalizeLookupName(name);
    const exactMatch = exact.get(normalized);
    if (exactMatch) return exactMatch;
    const short = byShortName.get(normalizeLookupName(shortName(name)));
    return short?.length === 1 ? short[0] ?? null : null;
  };
}

function nextPyreverseId(prefix: string, existingIds: Set<string>, seed: string): string {
  const hash = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10);
  let id = `${prefix}-${hash}`;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${prefix}-${hash}-${suffix++}`;
  }
  existingIds.add(id);
  return id;
}

function mergeMember(
  target: PyreverseMergeTarget,
  classSymbol: Symbol,
  member: PyreverseMember,
  kind: "method" | "variable",
  existingIds: Set<string>,
): boolean {
  const memberId = `${classSymbol.id}.${member.name}`;
  if (existingIds.has(memberId)) return false;

  const label = `${classSymbol.label}.${member.name}`;
  target.symbols.push({
    id: memberId,
    label,
    kind,
    parentId: classSymbol.id,
    doc: member.type ? { inputs: [{ name: member.name, type: member.type }] } : member.raw ? { raw: member.raw } : undefined,
    tags: ["pyreverse"],
  });
  existingIds.add(memberId);

  const containsId = nextPyreverseId("pyreverse-contains", existingIds, `${classSymbol.id}|${memberId}|contains`);
  target.relations.push({
    id: containsId,
    type: "contains",
    source: classSymbol.id,
    target: memberId,
    confidence: 1,
  });
  return true;
}

function relationConfidence(type: RelationType): number {
  if (type === "inherits" || type === "realizes") return 0.95;
  if (type === "aggregation" || type === "composition") return 0.88;
  return 0.82;
}

function findDuplicateRelation(relations: Relation[], candidate: Relation): Relation | undefined {
  return relations.find((relation) =>
    relation.source === candidate.source &&
    relation.target === candidate.target &&
    relation.type === candidate.type &&
    (
      relation.label === candidate.label ||
      relation.label == null ||
      candidate.label == null ||
      relation.sourceRole === candidate.sourceRole ||
      relation.targetRole === candidate.targetRole
    ),
  );
}

function mergeRelationMetadata(existing: Relation, candidate: Relation): boolean {
  let changed = false;
  for (const key of ["label", "sourceMultiplicity", "targetMultiplicity", "sourceRole", "targetRole"] as const) {
    if (existing[key] == null && candidate[key] != null) {
      existing[key] = candidate[key];
      changed = true;
    }
  }
  if (candidate.confidence != null && (existing.confidence == null || candidate.confidence > existing.confidence)) {
    existing.confidence = candidate.confidence;
    changed = true;
  }
  return changed;
}

export function mergePyreverseModelIntoGraph(
  target: PyreverseMergeTarget,
  model: PyreverseModel,
): PyreverseMergeStats {
  const existingIds = new Set([
    ...target.symbols.map((symbol) => symbol.id),
    ...target.relations.map((relation) => relation.id),
  ]);
  const resolveClass = buildClassResolver(target.symbols);
  const stats: PyreverseMergeStats = {
    classesMatched: 0,
    membersAdded: 0,
    relationsAdded: 0,
    relationsUpdated: 0,
    unmatchedRelations: 0,
  };

  for (const cls of model.classes) {
    const symbol = resolveClass(cls.name) ?? (cls.alias ? resolveClass(cls.alias) : null);
    if (!symbol) continue;
    stats.classesMatched++;
    for (const attribute of cls.attributes) {
      if (mergeMember(target, symbol, attribute, "variable", existingIds)) stats.membersAdded++;
    }
    for (const method of cls.methods) {
      if (mergeMember(target, symbol, method, "method", existingIds)) stats.membersAdded++;
    }
  }

  for (const relation of model.relations) {
    if (!isRelationType(relation.type)) continue;
    const source = resolveClass(relation.sourceName);
    const targetSymbol = resolveClass(relation.targetName);
    if (!source || !targetSymbol || source.id === targetSymbol.id) {
      stats.unmatchedRelations++;
      continue;
    }

    const candidate: Relation = {
      id: nextPyreverseId(
        "pyreverse-rel",
        existingIds,
        `${source.id}|${targetSymbol.id}|${relation.type}|${relation.label ?? ""}`,
      ),
      type: relation.type,
      source: source.id,
      target: targetSymbol.id,
      confidence: relationConfidence(relation.type),
      label: relation.label,
      sourceMultiplicity: relation.sourceMultiplicity,
      targetMultiplicity: relation.targetMultiplicity,
      sourceRole: relation.sourceRole,
      targetRole: relation.targetRole,
    };

    const duplicate = findDuplicateRelation(target.relations, candidate);
    if (duplicate) {
      if (mergeRelationMetadata(duplicate, candidate)) stats.relationsUpdated++;
      continue;
    }
    target.relations.push(candidate);
    stats.relationsAdded++;
  }

  return stats;
}
