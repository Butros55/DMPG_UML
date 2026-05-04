import type {
  DiagramView,
  Evidence,
  ProjectGraph,
  Relation,
  RelationType,
  SequenceFragment,
  SequenceMessage,
  SequenceMessageKind,
  SequenceParticipant,
  SequenceScenario,
  Symbol,
} from "@dmpg/shared";

export type SequenceTraceMode = "code" | "artifact" | "full";

export interface SequenceTraceOptions {
  entrySymbolId?: string;
  maxDepth?: number;
  maxMessages?: number;
  mode?: SequenceTraceMode;
}

type TraceContext = {
  graph: ProjectGraph;
  view: DiagramView | null;
  projectPath: string;
  mode: SequenceTraceMode;
  maxDepth: number;
  maxMessages: number;
  symbolById: Map<string, Symbol>;
  childrenByParent: Map<string, Symbol[]>;
  parentById: Map<string, string | undefined>;
  scopeIds: Set<string>;
  outgoingBySource: Map<string, Relation[]>;
};

type EntryPointCandidate = {
  symbolId: string;
  participantId: string;
  score: number;
  line: number;
};

type SequenceMessageDraft = Omit<SequenceMessage, "index"> & {
  evidence?: Evidence;
};

const TRACE_RELATION_TYPES = new Set<RelationType>([
  "calls",
  "instantiates",
  "reads",
  "writes",
  "uses_config",
]);

const PREFERRED_ENTRY_NAMES = new Set([
  "main",
  "run",
  "execute",
  "process",
  "start",
  "get_data",
  "extract_data",
  "generate",
  "generate_arrival_table",
  "simulate",
  "fit",
  "save",
  "load",
]);

export function buildSequenceScenarioForView(
  graph: ProjectGraph,
  projectPath: string,
  viewId: string,
  options: SequenceTraceOptions = {},
): SequenceScenario | null {
  const view = graph.views.find((candidate) => candidate.id === viewId);
  if (!view) return null;
  const context = buildTraceContext(graph, projectPath, view, options);
  const entry = resolveEntryPoint(context, options.entrySymbolId);
  if (!entry) return null;
  return buildScenarioFromEntry(context, entry);
}

export function buildSequenceScenarioForSymbol(
  graph: ProjectGraph,
  projectPath: string,
  entrySymbolId: string,
  options: SequenceTraceOptions = {},
): SequenceScenario | null {
  const context = buildTraceContext(graph, projectPath, null, {
    ...options,
    entrySymbolId,
  });
  const entry = resolveEntryPoint(context, entrySymbolId);
  if (!entry) return null;
  return buildScenarioFromEntry(context, entry);
}

function buildTraceContext(
  graph: ProjectGraph,
  projectPath: string,
  view: DiagramView | null,
  options: SequenceTraceOptions,
): TraceContext {
  const symbolById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const childrenByParent = buildChildrenByParent(graph.symbols);
  const parentById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol.parentId]));
  const scopeIds = view
    ? collectViewScopeIds(graph, view, childrenByParent)
    : new Set(graph.symbols.map((symbol) => symbol.id));
  const outgoingBySource = buildOutgoingRelationIndex(graph, symbolById);

  return {
    graph,
    view,
    projectPath,
    mode: options.mode ?? "code",
    maxDepth: options.maxDepth ?? 4,
    maxMessages: options.maxMessages ?? 30,
    symbolById,
    childrenByParent,
    parentById,
    scopeIds,
    outgoingBySource,
  };
}

function buildScenarioFromEntry(context: TraceContext, entry: EntryPointCandidate): SequenceScenario {
  const actor: SequenceParticipant = {
    id: "seq:actor:main",
    label: context.view?.id.startsWith("view:process-stage:")
      ? `${context.view.title} Actor`
      : "Main Script",
    role: "actor",
    laneKind: "internal",
  };
  const participants = new Map<string, SequenceParticipant>([[actor.id, actor]]);
  const entryParticipantId = entry.participantId;
  ensureParticipant(participants, entryParticipantId, context);

  const diagnostics: string[] = [];
  const drafts: SequenceMessageDraft[] = [];
  const entrySymbol = context.symbolById.get(entry.symbolId);
  drafts.push({
    id: `seq:entry:${entry.symbolId}`,
    sourceParticipantId: actor.id,
    targetParticipantId: entryParticipantId,
    targetSymbolId: entry.symbolId,
    kind: "sync_call",
    label: `${methodName(entrySymbol, entry.symbolId)}()`,
    file: entrySymbol?.location?.file,
    startLine: entrySymbol?.location?.startLine,
    endLine: entrySymbol?.location?.endLine,
    callDepth: 0,
    returnLabel: inferReturnLabel(entrySymbol),
    confidence: 0.95,
  });

  const visited = new Set<string>();
  visitSymbolOperations({
    context,
    sourceSymbolId: entry.symbolId,
    depth: 1,
    parentMessageId: drafts[0]!.id,
    stack: new Set([entry.symbolId]),
    participants,
    drafts,
    visited,
  });

  if (drafts.length > context.maxMessages) {
    diagnostics.push(`Sequence truncated to ${context.maxMessages} messages.`);
  }
  if (context.mode !== "code") {
    diagnostics.push(`Trace mode: ${context.mode}.`);
  }
  if (context.projectPath) {
    diagnostics.push("Static code path projection.");
  }

  const selectedDrafts = drafts.slice(0, context.maxMessages);
  const messages = selectedDrafts.map((draft, index): SequenceMessage => {
    const { evidence: _evidence, ...message } = draft;
    return {
      ...message,
      index: index + 1,
    };
  });
  const fragments = buildFragmentsFromMessages(selectedDrafts, messages);

  return {
    id: `sequence:${context.view?.id ?? "symbol"}:${entry.symbolId}`,
    title: `sd ${context.view?.title ?? "Code Flow"} :: ${methodName(entrySymbol, entry.symbolId)}()`,
    entrySymbolId: entry.symbolId,
    viewId: context.view?.id,
    participants: orderParticipants([...participants.values()]),
    messages,
    fragments: fragments.length > 0 ? fragments : undefined,
    diagnostics,
  };
}

function visitSymbolOperations(params: {
  context: TraceContext;
  sourceSymbolId: string;
  depth: number;
  parentMessageId: string;
  stack: Set<string>;
  participants: Map<string, SequenceParticipant>;
  drafts: SequenceMessageDraft[];
  visited: Set<string>;
}): void {
  const {
    context,
    sourceSymbolId,
    depth,
    parentMessageId,
    stack,
    participants,
    drafts,
    visited,
  } = params;
  if (depth > context.maxDepth || drafts.length >= context.maxMessages) return;

  const relations = context.outgoingBySource.get(sourceSymbolId) ?? [];
  for (const relation of relations) {
    if (drafts.length >= context.maxMessages) break;
    if (visited.has(relation.id)) continue;
    if (!relationTouchesTraceScope(relation, context, sourceSymbolId)) continue;
    if (isNoisyTraceRelation(relation, context)) continue;

    const draft = buildMessageDraftForRelation({
      relation,
      context,
      depth,
      parentMessageId,
      participants,
    });
    if (!draft) continue;

    visited.add(relation.id);
    drafts.push(draft);

    const targetSymbol = context.symbolById.get(relation.target);
    if (relation.type === "calls" && targetSymbol && isCallableSymbol(targetSymbol) && !stack.has(relation.target)) {
      stack.add(relation.target);
      visitSymbolOperations({
        context,
        sourceSymbolId: relation.target,
        depth: depth + 1,
        parentMessageId: draft.id,
        stack,
        participants,
        drafts,
        visited,
      });
      stack.delete(relation.target);
    }
  }
}

function buildMessageDraftForRelation(params: {
  relation: Relation;
  context: TraceContext;
  depth: number;
  parentMessageId: string;
  participants: Map<string, SequenceParticipant>;
}): SequenceMessageDraft | null {
  const { relation, context, depth, parentMessageId, participants } = params;
  const sourceParticipantId = participantIdForSymbol(relation.source, context);
  const targetParticipantId = participantIdForSymbol(relation.target, context);
  if (!sourceParticipantId || !targetParticipantId) return null;

  ensureParticipant(participants, sourceParticipantId, context);
  ensureParticipant(participants, targetParticipantId, context);

  const evidence = relation.evidence?.[0];
  const kind = messageKindForRelation(relation, sourceParticipantId, targetParticipantId, context);
  const sourceSymbol = context.symbolById.get(relation.source);
  const targetSymbol = context.symbolById.get(relation.target);

  return {
    id: relation.id,
    sourceParticipantId,
    targetParticipantId,
    sourceSymbolId: relation.source,
    targetSymbolId: relation.target,
    relationId: relation.id,
    kind,
    label: labelForRelation(relation, sourceSymbol, targetSymbol, kind),
    file: evidence?.file ?? sourceSymbol?.location?.file ?? targetSymbol?.location?.file,
    startLine: evidence?.startLine,
    endLine: evidence?.endLine,
    snippet: evidence?.snippet,
    callDepth: depth,
    parentMessageId,
    returnLabel: kind === "sync_call" || kind === "self_call" ? inferReturnLabel(targetSymbol) : undefined,
    confidence: relation.confidence ?? 0.8,
    evidence,
  };
}

function resolveEntryPoint(context: TraceContext, explicitEntrySymbolId?: string): EntryPointCandidate | null {
  if (explicitEntrySymbolId) {
    const participantId = participantIdForSymbol(explicitEntrySymbolId, context);
    if (!participantId) return null;
    return {
      symbolId: explicitEntrySymbolId,
      participantId,
      score: Number.MAX_SAFE_INTEGER,
      line: context.symbolById.get(explicitEntrySymbolId)?.location?.startLine ?? Number.MAX_SAFE_INTEGER,
    };
  }

  const outgoingCounts = new Map<string, number>();
  for (const relation of context.graph.relations) {
    if (!TRACE_RELATION_TYPES.has(relation.type)) continue;
    if (isNoisyTraceRelation(relation, context)) continue;
    outgoingCounts.set(relation.source, (outgoingCounts.get(relation.source) ?? 0) + 1);
  }

  const candidates: EntryPointCandidate[] = [];
  for (const symbolId of context.scopeIds) {
    const symbol = context.symbolById.get(symbolId);
    if (!symbol || !isCallableSymbol(symbol)) continue;
    const participantId = participantIdForSymbol(symbolId, context);
    if (!participantId) continue;
    const name = methodName(symbol, symbolId);
    let score = outgoingCounts.get(symbolId) ?? 0;
    if (PREFERRED_ENTRY_NAMES.has(name.toLowerCase())) score += 120;
    if (symbol.kind === "method") score += 16;
    if (!name.startsWith("_")) score += 10;
    if (participantId !== symbolId) score += 8;
    candidates.push({
      symbolId,
      participantId,
      score,
      line: symbol.location?.startLine ?? Number.MAX_SAFE_INTEGER,
    });
  }

  candidates.sort((left, right) =>
    right.score - left.score ||
    left.line - right.line ||
    left.symbolId.localeCompare(right.symbolId),
  );
  return candidates[0] ?? null;
}

function buildOutgoingRelationIndex(
  graph: ProjectGraph,
  symbolById: Map<string, Symbol>,
): Map<string, Relation[]> {
  const outgoing = new Map<string, Relation[]>();
  for (const relation of graph.relations) {
    if (!TRACE_RELATION_TYPES.has(relation.type)) continue;
    if (relation.type === "uses_config" && !isArtifactLike(symbolById.get(relation.target))) continue;
    const bucket = outgoing.get(relation.source) ?? [];
    bucket.push(relation);
    outgoing.set(relation.source, bucket);
  }
  for (const bucket of outgoing.values()) {
    bucket.sort(compareRelationsBySequenceEvidence(symbolById));
  }
  return outgoing;
}

function collectViewScopeIds(
  graph: ProjectGraph,
  view: DiagramView,
  childrenByParent: Map<string, Symbol[]>,
): Set<string> {
  const rootIds = new Set(view.nodeRefs ?? []);
  const isArtifactView = view.id.startsWith("view:artifacts:") ||
    view.id.startsWith("view:art-cat:") ||
    /\bartifacts?\b|\btabular\b|\boutputs?\b|\binputs?\b/i.test(view.title);
  if (isArtifactView && view.parentViewId) {
    const parentView = graph.views.find((candidate) => candidate.id === view.parentViewId);
    if (parentView?.id.startsWith("view:process-stage:")) {
      for (const nodeId of parentView.nodeRefs) rootIds.add(nodeId);
    }
  }

  const scopeIds = new Set<string>();
  for (const rootId of rootIds) {
    scopeIds.add(rootId);
    const stack = [...(childrenByParent.get(rootId) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next || scopeIds.has(next.id)) continue;
      scopeIds.add(next.id);
      stack.push(...(childrenByParent.get(next.id) ?? []));
    }
  }
  return scopeIds;
}

function buildChildrenByParent(symbols: Symbol[]): Map<string, Symbol[]> {
  const childrenByParent = new Map<string, Symbol[]>();
  for (const symbol of symbols) {
    if (!symbol.parentId) continue;
    const children = childrenByParent.get(symbol.parentId) ?? [];
    children.push(symbol);
    childrenByParent.set(symbol.parentId, children);
  }
  return childrenByParent;
}

function relationTouchesTraceScope(relation: Relation, context: TraceContext, activeSourceId: string): boolean {
  if (relation.source === activeSourceId) return true;
  if (context.scopeIds.has(relation.source) || context.scopeIds.has(relation.target)) return true;
  const sourceParticipantId = participantIdForSymbol(relation.source, context);
  const targetParticipantId = participantIdForSymbol(relation.target, context);
  return (!!sourceParticipantId && context.scopeIds.has(sourceParticipantId)) ||
    (!!targetParticipantId && context.scopeIds.has(targetParticipantId));
}

function participantIdForSymbol(symbolId: string, context: TraceContext): string | null {
  const symbol = context.symbolById.get(symbolId);
  if (!symbol) return null;
  if (isNoisySymbol(symbol)) return null;
  if (isArtifactLike(symbol) || symbol.umlType === "database" || symbol.umlType === "component") return symbol.id;
  if (symbol.kind === "class" || symbol.kind === "interface") return symbol.id;
  if (symbol.kind === "module") return preferredModuleParticipant(symbol.id, context);
  if (symbol.kind === "function" || symbol.kind === "method") {
    const classifierId = nearestClassifierAncestor(symbol.id, context);
    return classifierId ?? symbol.id;
  }
  if (symbol.kind === "group" || symbol.kind === "package" || symbol.kind === "script") return symbol.id;
  if (symbol.kind === "external") return symbol.id;
  return null;
}

function preferredModuleParticipant(moduleId: string, context: TraceContext): string {
  const classifierChildren = (context.childrenByParent.get(moduleId) ?? [])
    .filter((child) => child.kind === "class" || child.kind === "interface")
    .filter((child) => !isNoisySymbol(child));
  return classifierChildren.length === 1 ? classifierChildren[0]!.id : moduleId;
}

function nearestClassifierAncestor(symbolId: string, context: TraceContext): string | null {
  let current = context.parentById.get(symbolId);
  let depth = 0;
  while (current && depth < 16) {
    const symbol = context.symbolById.get(current);
    if (!symbol) break;
    if (symbol.kind === "class" || symbol.kind === "interface") return symbol.id;
    if (symbol.kind === "module") return preferredModuleParticipant(symbol.id, context);
    current = context.parentById.get(current);
    depth += 1;
  }
  return null;
}

function ensureParticipant(
  participants: Map<string, SequenceParticipant>,
  participantId: string,
  context: TraceContext,
): void {
  if (participants.has(participantId)) return;
  const symbol = context.symbolById.get(participantId);
  if (!symbol) {
    participants.set(participantId, {
      id: participantId,
      label: participantId.replace(/^ext:/, ""),
      role: "external",
      laneKind: "external",
    });
    return;
  }

  const role = participantRole(symbol);
  participants.set(participantId, {
    id: participantId,
    symbolId: symbol.id,
    label: participantLabel(symbol),
    role,
    laneKind: participantLaneKind(symbol, role),
    className: symbol.kind === "class" || symbol.kind === "interface" ? symbol.label : undefined,
    objectName: symbol.kind === "method" || symbol.kind === "function" ? methodName(symbol, symbol.id) : undefined,
    location: symbol.location,
  });
}

function participantRole(symbol: Symbol): SequenceParticipant["role"] {
  if (isArtifactLike(symbol)) return "artifact";
  if (symbol.umlType === "database") return "database";
  if (symbol.kind === "class" || symbol.kind === "interface") {
    return /connector|client|service|api|repository|gateway|druid|mes/i.test(symbol.label) ? "service" : "class";
  }
  if (symbol.kind === "module" || symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "script") {
    return "script";
  }
  if (symbol.kind === "external") return "external";
  return "object";
}

function participantLaneKind(symbol: Symbol, role: SequenceParticipant["role"]): SequenceParticipant["laneKind"] {
  if (role === "artifact") return "artifact";
  if (role === "external" || role === "database") return "external";
  return "internal";
}

function participantLabel(symbol: Symbol): string {
  if (isArtifactLike(symbol)) return shortBasename(symbol.label.replace(/^ext:/, ""));
  if (symbol.kind === "function" || symbol.kind === "method") return methodName(symbol, symbol.id);
  return shortDisplayName(symbol.label);
}

function messageKindForRelation(
  relation: Relation,
  sourceParticipantId: string,
  targetParticipantId: string,
  context: TraceContext,
): SequenceMessageKind {
  if (relation.type === "instantiates") return "create";
  if (relation.type === "reads" || relation.type === "uses_config") return "read";
  if (relation.type === "writes") return "write";
  if (sourceParticipantId === targetParticipantId) return "self_call";
  const evidence = relation.evidence?.[0];
  const targetSymbol = context.symbolById.get(relation.target);
  if (evidence?.callKind === "async" || targetSymbol?.tags?.includes("async")) return "async_call";
  return "sync_call";
}

function labelForRelation(
  relation: Relation,
  sourceSymbol: Symbol | undefined,
  targetSymbol: Symbol | undefined,
  kind: SequenceMessageKind,
): string {
  if (kind === "create") return `create ${shortDisplayName(targetSymbol?.label ?? relation.target)}`;
  if (kind === "read") return `read ${shortBasename(targetSymbol?.label ?? relation.target.replace(/^ext:/, ""))}`;
  if (kind === "write") return `write ${shortBasename(targetSymbol?.label ?? relation.target.replace(/^ext:/, ""))}`;

  const evidence = relation.evidence?.[0];
  const explicit = relation.label?.trim();
  if (explicit && !/^run\b/i.test(explicit) && !isGenericName(explicit)) return explicit;
  const rawName = evidence?.calleeName ?? targetSymbol?.label ?? relation.target;
  const name = methodName(targetSymbol, rawName);
  if (!name || isGenericName(name)) return `${methodName(sourceSymbol, relation.source)}()`;
  if (name.includes("(")) return name;
  return kind === "self_call" ? `${name}()` : `${name}(...)`;
}

function inferReturnLabel(symbol: Symbol | undefined): string {
  const outputType = symbol?.doc?.outputs?.[0]?.type?.trim();
  if (!outputType) return "result";
  if (/^none$/i.test(outputType)) return "void";
  if (/dataframe|frame/i.test(outputType)) return "dataframe";
  if (/record|row|list|dict/i.test(outputType)) return "records";
  return outputType;
}

function buildFragmentsFromMessages(
  drafts: SequenceMessageDraft[],
  messages: SequenceMessage[],
): SequenceFragment[] {
  const byFragment = new Map<string, SequenceFragment>();
  drafts.forEach((draft, index) => {
    const evidence = draft.evidence;
    if (!evidence?.fragmentId || !evidence.fragmentType) return;
    const existing = byFragment.get(evidence.fragmentId);
    if (existing) {
      existing.startMessageIndex = Math.min(existing.startMessageIndex, messages[index]!.index);
      existing.endMessageIndex = Math.max(existing.endMessageIndex, messages[index]!.index);
      return;
    }
    byFragment.set(evidence.fragmentId, {
      id: evidence.fragmentId,
      type: evidence.fragmentType,
      label: evidence.fragmentLabel ?? evidence.fragmentType,
      guard: evidence.fragmentGuard,
      startMessageIndex: messages[index]!.index,
      endMessageIndex: messages[index]!.index,
    });
  });
  return [...byFragment.values()].sort((left, right) =>
    left.startMessageIndex - right.startMessageIndex ||
    left.id.localeCompare(right.id),
  );
}

function compareRelationsBySequenceEvidence(symbolById: Map<string, Symbol>) {
  return (left: Relation, right: Relation): number => {
    const leftEvidence = left.evidence?.[0];
    const rightEvidence = right.evidence?.[0];
    const leftOrder = leftEvidence?.sequenceIndex ??
      leftEvidence?.startLine ??
      symbolById.get(left.source)?.location?.startLine ??
      Number.MAX_SAFE_INTEGER;
    const rightOrder = rightEvidence?.sequenceIndex ??
      rightEvidence?.startLine ??
      symbolById.get(right.source)?.location?.startLine ??
      Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  };
}

function orderParticipants(participants: SequenceParticipant[]): SequenceParticipant[] {
  const roleRank: Record<SequenceParticipant["role"], number> = {
    actor: 0,
    script: 1,
    class: 2,
    object: 3,
    service: 4,
    database: 5,
    artifact: 6,
    external: 7,
  };
  return [...participants].sort((left, right) =>
    roleRank[left.role] - roleRank[right.role] ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id),
  );
}

function isCallableSymbol(symbol: Symbol): boolean {
  return symbol.kind === "method" || symbol.kind === "function";
}

function isArtifactLike(symbol: Symbol | undefined): boolean {
  if (!symbol) return false;
  const text = `${symbol.id} ${symbol.label}`.toLowerCase();
  return symbol.umlType === "artifact" ||
    symbol.id.startsWith("proc:artifact:") ||
    /\.(csv|tsv|json|xlsx|xls|pkl|pickle|parquet|joblib|txt|yaml|yml|xml)\b/.test(text);
}

function isNoisyTraceRelation(relation: Relation, context: TraceContext): boolean {
  const source = context.symbolById.get(relation.source);
  const target = context.symbolById.get(relation.target);
  if (relation.type === "reads" || relation.type === "writes" || relation.type === "uses_config") {
    return !isArtifactLike(target) && !isArtifactLike(source);
  }
  return isNoisySymbol(source) || isNoisySymbol(target);
}

function isNoisySymbol(symbol: Symbol | undefined): boolean {
  if (!symbol || isArtifactLike(symbol)) return false;
  const text = `${symbol.id} ${symbol.label}`.toLowerCase();
  if (symbol.id.startsWith("ext:") && isLibraryNoise(text)) return true;
  return isLibraryNoise(text);
}

function isLibraryNoise(value: string): boolean {
  if (/\b(pandas|numpy|sklearn|scipy|matplotlib|seaborn|pathlib|os\.|sys\.|re\.|math\.|json\.|yaml\.|datetime)\b/.test(value)) {
    return true;
  }
  return value.split(/[^a-z0-9_]+/).filter(Boolean).some((token) =>
    [
      "pd",
      "np",
      "df",
      "row",
      "dataframe",
      "series",
      "range",
      "len",
      "str",
      "bool",
      "dict",
      "list",
      "int",
      "float",
      "path",
      "datetime",
      "timedelta",
      "to_timedelta",
    ].includes(token),
  );
}

function isGenericName(value: string): boolean {
  return /^(run|df|pd|np|range|len|str|bool|dict|list|int|float|series|dataframe|datetime|timedelta|none)$/i.test(value.trim());
}

function methodName(symbol: Symbol | undefined, fallbackId: string): string {
  const raw = symbol?.label ?? fallbackId;
  return (raw.split(/[.:]/).pop() ?? raw).trim();
}

function shortDisplayName(value: string): string {
  const normalized = value.replace(/^ext:/, "");
  return normalized.split(/[.:/\\]/).filter(Boolean).pop() ?? normalized;
}

function shortBasename(value: string): string {
  return value.replace(/^ext:/, "").split(/[\\/]/).filter(Boolean).pop() ?? value.replace(/^ext:/, "");
}
