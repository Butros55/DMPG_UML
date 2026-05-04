import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store";
import { openInIde, summarizeSymbol } from "../api";
import { scheduleShowHover, scheduleHideHover } from "./hoverCardController";
import { DiagramSettingsPanel } from "./DiagramSettingsPanel";
import type { ProjectGraph, Relation, RelationType, Symbol as GraphSymbol } from "@dmpg/shared";
import type { NavigableRelationItem } from "../relationNavigation";
import { buildNavigableRelationItems } from "../relationNavigation";
import { resolveNavigableSymbolId } from "../viewNavigation";
import {
  buildArtifactPreview,
  buildArtifactPreviewMetaChips,
  translateArtifactPreviewLabel,
  type ArtifactPreviewData,
  type ArtifactPreviewItem,
  PROCESS_STAGE_PACKAGE_IDS,
} from "../artifactPreview";
import { resolveArtifactView } from "../artifactVisibility";
import {
  buildEdgeContextSequenceDiagramDetails,
  buildPackageSequenceDiagramDetails,
  isPackageSequenceView,
  type SequenceMessagePanelData,
  type SequenceParticipantPanelData,
  type SequenceProjectionMeta,
} from "../sequenceDiagram";

const RELATION_TYPES: RelationType[] = [
  "imports",
  "contains",
  "calls",
  "reads",
  "writes",
  "inherits",
  "uses_config",
  "instantiates",
  "association",
  "aggregation",
  "composition",
];
const SYMBOL_KINDS = ["module", "class", "function", "method", "group", "package", "interface", "variable"] as const;

/* ── Known external names — Python builtins, stdlib modules, common 3rd-party aliases ── */
const KNOWN_EXTERNAL: ReadonlySet<string> = new Set([
  // Python builtins
  'abs','all','any','ascii','bin','bool','breakpoint','bytearray','bytes',
  'callable','chr','classmethod','compile','complex','delattr','dict','dir',
  'divmod','enumerate','eval','exec','filter','float','format','frozenset',
  'getattr','globals','hasattr','hash','help','hex','id','input','int',
  'isinstance','issubclass','iter','len','list','locals','map','max',
  'memoryview','min','next','object','oct','open','ord','pow','print',
  'property','range','repr','reversed','round','set','setattr','slice',
  'sorted','staticmethod','str','sum','super','tuple','type','vars','zip',
  // Python exceptions
  'Exception','BaseException','TypeError','ValueError','KeyError','IndexError',
  'AttributeError','ImportError','RuntimeError','StopIteration','FileNotFoundError',
  'OSError','IOError','NotImplementedError','ZeroDivisionError','OverflowError',
  'AssertionError','SyntaxError','NameError','RecursionError','PermissionError',
  // Python stdlib modules (first-segment)
  'abc','argparse','array','ast','asyncio','atexit','base64','bisect','builtins',
  'calendar','cmath','cmd','codecs','collections','concurrent','configparser',
  'contextlib','copy','csv','ctypes','dataclasses','datetime','decimal','difflib',
  'dis','email','enum','errno','fnmatch','fractions','ftplib','functools','gc',
  'getpass','glob','gzip','hashlib','heapq','hmac','html','http','importlib',
  'inspect','io','ipaddress','itertools','json','keyword','linecache','locale',
  'logging','lzma','math','mimetypes','mmap','multiprocessing','numbers',
  'operator','optparse','os','pathlib','pdb','pickle','pkgutil','platform',
  'pprint','profile','pstats','queue','random','re','readline','reprlib',
  'resource','runpy','sched','secrets','select','shelve','shlex','shutil',
  'signal','site','smtplib','socket','socketserver','sqlite3','ssl','stat',
  'statistics','string','struct','subprocess','sys','sysconfig','tarfile',
  'tempfile','textwrap','threading','time','timeit','tkinter','token',
  'tokenize','tomllib','trace','traceback','tracemalloc','types','typing',
  'unicodedata','unittest','urllib','uuid','venv','warnings','wave','weakref',
  'webbrowser','xml','xmlrpc','zipfile','zipimport','zlib',
  // Common 3rd-party packages & aliases
  'np','numpy','pd','pandas','plt','matplotlib','mpl','sns','seaborn',
  'scipy','sklearn','sk','tf','tensorflow','torch','cv2','PIL','requests',
  'flask','django','fastapi','sqlalchemy','sa','boto3','bs4','lxml','yaml',
  'pyyaml','dotenv','click','typer','pydantic','uvicorn','celery','redis',
  'pymongo','psycopg2','openpyxl','xlrd','xlsxwriter','pytest','mock','tqdm',
  'rich','colorama','networkx','nx','sympy','statsmodels','sm','wandb','mlflow',
  'optuna','dask','polars','pl','pyarrow','pa','h5py','shapely','geopandas',
  'gpd','kafka','aiohttp','httpx','grpc','docker','airflow','pyspark',
  'transformers','tokenizers','langchain','openai','streamlit','st','gradio',
  'plotly','dash','setuptools','pip','pkg_resources','simpy','pydruid',
]);

/* ── Badge metadata mapping (same IDs as UmlNode REL_BADGE_META) ── */
const REL_BADGE_META: Record<string, { iconCls: string; label: string; cls: string }> = {
  "out:calls":        { iconCls: "bi-telephone-outbound", label: "ruft auf",         cls: "calls" },
  "in:calls":         { iconCls: "bi-telephone-inbound",  label: "aufgerufen von",   cls: "calls-in" },
  "out:reads":        { iconCls: "bi-book",               label: "liest",            cls: "reads" },
  "in:reads":         { iconCls: "bi-book",               label: "gelesen von",      cls: "reads-in" },
  "out:writes":       { iconCls: "bi-pencil-square",      label: "schreibt",         cls: "writes" },
  "in:writes":        { iconCls: "bi-pencil-square",      label: "geschrieben von",  cls: "writes-in" },
  "out:imports":      { iconCls: "bi-box-arrow-in-down",  label: "importiert",       cls: "imports" },
  "in:imports":       { iconCls: "bi-box-arrow-in-down",  label: "importiert von",   cls: "imports-in" },
  "out:inherits":     { iconCls: "bi-diagram-3",          label: "erbt von",         cls: "inherits" },
  "in:inherits":      { iconCls: "bi-diagram-3",          label: "vererbt an",       cls: "inherits-in" },
  "out:instantiates": { iconCls: "bi-lightning",          label: "erstellt",         cls: "instantiates" },
  "in:instantiates":  { iconCls: "bi-lightning",          label: "erstellt von",     cls: "instantiates-in" },
  "out:uses_config":  { iconCls: "bi-gear",               label: "konfiguriert",     cls: "uses_config" },
  "in:uses_config":   { iconCls: "bi-gear",               label: "konfiguriert von", cls: "uses_config-in" },
  "out:association":  { iconCls: "bi-diagram-2",          label: "assoziiert",       cls: "association" },
  "in:association":   { iconCls: "bi-diagram-2",          label: "assoziiert mit",   cls: "association-in" },
  "out:aggregation":  { iconCls: "bi-diagram-2",          label: "hat",              cls: "aggregation" },
  "in:aggregation":   { iconCls: "bi-diagram-2",          label: "Teil von",         cls: "aggregation-in" },
  "out:composition":  { iconCls: "bi-diagram-2-fill",     label: "enthält",          cls: "composition" },
  "in:composition":   { iconCls: "bi-diagram-2-fill",     label: "gehört zu",        cls: "composition-in" },
};

/** Small inline badge matching the node relation badges for visual correlation */
function RelBadgeTag({ badgeKey }: { badgeKey: string }) {
  const meta = REL_BADGE_META[badgeKey];
  if (!meta) return null;
  return (
    <span className={`rel-badge rel-badge--${meta.cls}`} style={{ fontSize: 10, marginLeft: 6 }}>
      <i className={`bi ${meta.iconCls}`} /> {meta.label}
    </span>
  );
}

/* ── Collapsible section wrapper ── */
function CollapsibleSection({
  title,
  icon,
  count,
  badge,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  icon?: string;
  count?: number;
  badge?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`inspector-card inspector-collapsible${open ? " inspector-collapsible--open" : ""}${className ? ` ${className}` : ""}`}>
      <div className="field-label inspector-collapse-header" onClick={() => setOpen(!open)}>
        <span className="inspector-collapse-toggle">
          <i className={open ? "bi bi-chevron-down" : "bi bi-chevron-right"} />
        </span>
        {icon && <i className={`bi ${icon}`} />}
        {" "}{title}{count != null ? ` (${count})` : ""}
        {badge && <RelBadgeTag badgeKey={badge} />}
      </div>
      {open && children}
    </div>
  );
}

function formatSequenceProjectionFilters(projection: SequenceProjectionMeta | null): string {
  if (!projection || projection.activeRelationFilters.length === 0) return "All relations";
  return projection.activeRelationFilters.join(", ");
}

function formatSequenceMessageKind(kind: SequenceMessagePanelData["kind"]): string {
  switch (kind) {
    case "create":
      return "create";
    case "async":
      return "async";
    case "response":
      return "response";
    case "self":
      return "self";
    default:
      return "sync";
  }
}

function formatSequenceDirection(direction: SequenceParticipantPanelData["messages"][number]["direction"]): string {
  switch (direction) {
    case "incoming":
      return "In";
    case "outgoing":
      return "Out";
    case "self":
      return "Self";
    default:
      return direction;
  }
}

function SequenceProjectionCard({
  projection,
  empty,
}: {
  projection: SequenceProjectionMeta;
  empty?: boolean;
}) {
  return (
    <div className="inspector-card">
      <div className="field-label">Sequence Projection</div>
      {empty && (
        <div className="summary" style={{ marginBottom: 10 }}>
          Select a participant or message
        </div>
      )}
      <div className="shc-preview-chip-row">
        <span className="shc-preview-chip">Mode {projection.sequenceMode}</span>
        <span className="shc-preview-chip">Participants {projection.usedParticipants}/{projection.participantLimit}</span>
        <span className="shc-preview-chip">Messages {projection.usedMessages}/{projection.messageLimit}</span>
        <span className="shc-preview-chip">Buckets {projection.bucketsActive ? "active" : "inactive"}</span>
      </div>
      <div className="shc-preview-chip-row" style={{ marginTop: 8 }}>
        <span className="shc-preview-chip">Labels {projection.labelMode}</span>
        <span className="shc-preview-chip">Filters {formatSequenceProjectionFilters(projection)}</span>
        {(projection.participantsCollapsed || projection.messagesCollapsed) && (
          <span className="shc-preview-chip">
            Collapsing {projection.participantsCollapsed || projection.messagesCollapsed ? "active" : "inactive"}
          </span>
        )}
      </div>
    </div>
  );
}

function SequenceParticipantSections({
  participant,
  projection,
  onSymbolClick,
}: {
  participant: SequenceParticipantPanelData;
  projection: SequenceProjectionMeta | null;
  onSymbolClick: (symbolId: string) => void;
}) {
  const previewMessages = participant.messages.slice(0, 10);

  return (
    <>
      <div className="inspector-card">
        <div className="field-label">Participant</div>
        <h3 style={{ marginBottom: 6 }}>{participant.label}</h3>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Role: <strong style={{ color: "var(--text)" }}>{participant.role}</strong>
          {" · "}
          Lane: <strong style={{ color: "var(--text)" }}>{participant.laneKind}</strong>
        </div>
        {participant.fullLabel && participant.fullLabel !== participant.label && (
          <div className="location" style={{ marginTop: 6 }}>{participant.fullLabel}</div>
        )}
      </div>

      <div className="inspector-card">
        <div className="field-label">Sequence Stats</div>
        <div className="shc-preview-chip-row">
          <span className="shc-preview-chip">In {participant.incomingCount}</span>
          <span className="shc-preview-chip">Out {participant.outgoingCount}</span>
          <span className="shc-preview-chip">First #{participant.firstMessageIndex ?? "-"}</span>
          <span className="shc-preview-chip">Created #{participant.createdAtMessageIndex ?? "-"}</span>
        </div>
        <div className="shc-preview-chip-row" style={{ marginTop: 8 }}>
          <span className="shc-preview-chip">sync {participant.breakdown.sync}</span>
          <span className="shc-preview-chip">async {participant.breakdown.async}</span>
          <span className="shc-preview-chip">create {participant.breakdown.create}</span>
          <span className="shc-preview-chip">self {participant.breakdown.self}</span>
        </div>
      </div>

      <div className="inspector-card">
        <div className="field-label">Activations</div>
        <div className="shc-preview-chip-row">
          <span className="shc-preview-chip">Count {participant.activationCount}</span>
          {participant.activationMaxDepth != null && (
            <span className="shc-preview-chip">Max depth {participant.activationMaxDepth}</span>
          )}
        </div>
      </div>

      {previewMessages.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Messages</div>
          <div className="shc-preview-detail-list">
            {previewMessages.map((message) => (
              <div key={`${participant.participantId}-${message.id}-${message.direction}`} className="shc-preview-detail-row">
                <div className="shc-preview-detail-label">#{message.index}</div>
                <div className="shc-preview-detail-value">
                  <span className="shc-preview-chip">{formatSequenceDirection(message.direction)}</span>
                  <SymbolLink symbolId={message.partnerId} label={message.partnerLabel} onClick={() => onSymbolClick(message.partnerId)} className="shc-preview-chip shc-preview-chip--link" />
                  <span className="shc-preview-chip">{message.label}</span>
                  <span className="shc-preview-chip">{message.kind}</span>
                  {message.count > 1 && <span className="shc-preview-chip">x{message.count}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {projection && <SequenceProjectionCard projection={projection} />}
    </>
  );
}

function SequenceMessageInspectorPanel({
  message,
  projection,
  onSymbolClick,
  onToggleInspector,
}: {
  message: SequenceMessagePanelData;
  projection: SequenceProjectionMeta | null;
  onSymbolClick: (symbolId: string) => void;
  onToggleInspector: () => void;
}) {
  const messageLabel = message.label ?? message.descriptorPreview[0] ?? message.relationType;

  return (
    <div className="inspector" data-testid="sequence-message-inspector">
      <div className="inspector-header-row">
        <h2>Inspector</h2>
        <div className="inspector-header-actions">
          <button
            className="inspector-header-btn inspector-header-btn--collapse"
            onClick={onToggleInspector}
            title="Inspector einklappen"
          >
            <i className="bi bi-layout-sidebar-inset-reverse" />
          </button>
        </div>
      </div>

      <div className="inspector-card">
        <div className="field-label">Sequence Message</div>
        <h3>#{message.index} {messageLabel}</h3>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Kind: <strong style={{ color: "var(--text)" }}>{formatSequenceMessageKind(message.kind)}</strong>
          {" · "}
          Relation: <strong style={{ color: "var(--text)" }}>{message.relationType}</strong>
          {" · "}
          Aggregates {message.count}
        </div>
      </div>

      <div className="inspector-card">
        <div className="field-label">Route</div>
        <div className="shc-preview-chip-row">
          <SymbolLink symbolId={message.sourceParticipantId} label={message.sourceParticipantLabel} onClick={() => onSymbolClick(message.sourceParticipantId)} className="shc-preview-chip shc-preview-chip--link" />
          <span className="shc-preview-chip">{message.sourceParticipantRole}</span>
          <span className="shc-preview-chip">{message.sourceLaneKind}</span>
        </div>
        <div className="shc-preview-chip-row" style={{ marginTop: 8 }}>
          <SymbolLink symbolId={message.targetParticipantId} label={message.targetParticipantLabel} onClick={() => onSymbolClick(message.targetParticipantId)} className="shc-preview-chip shc-preview-chip--link" />
          <span className="shc-preview-chip">{message.targetParticipantRole}</span>
          <span className="shc-preview-chip">{message.targetLaneKind}</span>
        </div>
      </div>

      {message.descriptorPreview.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Descriptors</div>
          <div className="shc-preview-chip-row">
            {message.descriptorPreview.map((descriptor, index) => (
              <span key={`${message.id}-descriptor-${index}`} className="shc-preview-chip">
                {descriptor}
              </span>
            ))}
          </div>
        </div>
      )}

      <details className="inspector-card" open>
        <summary className="field-label" style={{ cursor: "pointer" }}>
          Underlying Relations / relationIds ({message.relationIds.length})
        </summary>
        <div className="shc-preview-chip-row" style={{ marginTop: 10 }}>
          {message.relationIds.map((relationId) => (
            <span key={relationId} className="shc-preview-chip">{relationId}</span>
          ))}
        </div>
      </details>

      {message.evidenceFile && (
        <div className="inspector-card">
          <div className="field-label">Evidence</div>
          <div className="location">
            {message.evidenceFile}
            {message.evidenceLine != null ? `:${message.evidenceLine}` : ""}
          </div>
          <button
            className="source-view-btn"
            onClick={() => void openInIde("vscode", message.evidenceFile!, message.evidenceLine ?? undefined).catch(() => undefined)}
          >
            <i className="bi bi-box-arrow-up-right" /> Open in IDE
          </button>
        </div>
      )}

      {projection && <SequenceProjectionCard projection={projection} />}
    </div>
  );
}

/* ─── AI Badge + Validation Buttons ─── */
function AiBadge({ field, symbolId, onConfirm, onReject }: {
  field: string;
  symbolId: string;
  onConfirm: (symbolId: string, field: string) => void;
  onReject: (symbolId: string, field: string) => void;
}) {
  return (
    <span className="ai-badge-group">
      <span className="ai-badge" title="Vom LLM generiert"><i className="bi bi-cpu" /> AI</span>
      <button
        className="ai-action-btn ai-confirm-btn"
        onClick={(e) => { e.stopPropagation(); onConfirm(symbolId, field); }}
        title="Bestätigen — AI-Markierung entfernen"
      ><i className="bi bi-check-lg" /></button>
      <button
        className="ai-action-btn ai-reject-btn"
        onClick={(e) => { e.stopPropagation(); onReject(symbolId, field); }}
        title="Ablehnen — Eintrag löschen"
      ><i className="bi bi-x-lg" /></button>
    </span>
  );
}

function AiRelationBadge({ relationIds, onConfirm, onReject }: {
  relationIds: string[];
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <span className="ai-badge-group">
      <span className="ai-badge" title="Vom LLM entdeckt"><i className="bi bi-cpu" /></span>
      <button
        className="ai-action-btn ai-confirm-btn"
        onClick={(e) => { e.stopPropagation(); relationIds.forEach((relationId) => onConfirm(relationId)); }}
        title="Bestätigen"
      ><i className="bi bi-check-lg" /></button>
      <button
        className="ai-action-btn ai-reject-btn"
        onClick={(e) => { e.stopPropagation(); relationIds.forEach((relationId) => onReject(relationId)); }}
        title="Löschen"
      ><i className="bi bi-x-lg" /></button>
    </span>
  );
}

/**
 * Classify whether a symbol is project-defined (not standard library / built-in).
 * Default is project-own — only symbols whose root prefix is KNOWN to be external
 * (Python builtins, stdlib, or common third-party) are classified as "Vordefiniert".
 */
function isProjectOwn(
  sym: { kind: string; label: string } | undefined,
  symbolId: string,
  projectPrefixes: Set<string>,
  externalPrefixes: Set<string>,
): boolean {
  if (!sym) {
    const bare = symbolId.replace(/^(mod:|cls:|fn:|ext:|meth:)/, "");
    const first = bare.split(".")[0];
    // Matches a project root package → project-own
    if (first && projectPrefixes.has(first)) return true;
    // Matches a known external → predefined
    if (first && externalPrefixes.has(first)) return false;
    if (bare && externalPrefixes.has(bare)) return false;
    // Unknown → default project-own
    return true;
  }
  if (sym.kind !== "external") return true;
  // Data files → project-own
  if (/\.(csv|xlsx?|json|ya?ml|toml|txt|dat|sql|parquet|h5|pkl|pickle|feather|arrow)$/i.test(sym.label)) return true;
  const first = sym.label.split(".")[0];
  // Project prefix → project-own
  if (first && projectPrefixes.has(first)) return true;
  // Known external → predefined
  if (first && externalPrefixes.has(first)) return false;
  if (externalPrefixes.has(sym.label)) return false;
  // Unknown external → project-own (local variable method calls etc.)
  return true;
}

/** Reusable list that partitions relation targets into project-own (top, highlighted) and stdlib (collapsed) */
function RelationItemList({
  items,
  graph,
  showKind,
  showConfidence,
  chipClassName,
  onSymbolClick,
  onConfirmAi,
  onRejectAi,
}: {
  items: NavigableRelationItem[];
  graph: ProjectGraph | null;
  showKind?: boolean;
  showConfidence?: boolean;
  chipClassName?: string;
  onSymbolClick: (id: string) => void;
  onConfirmAi: (id: string) => void;
  onRejectAi: (id: string) => void;
}) {
  const [showStdlib, setShowStdlib] = useState(false);

  /** Collect root package names from non-external symbols → anything sharing a root is project-own */
  const projectPrefixes = useMemo(() => {
    const prefixes = new Set<string>();
    if (!graph) return prefixes;
    for (const s of graph.symbols) {
      if (s.kind === "external") continue;
      const first = s.label.split(".")[0];
      if (first) prefixes.add(first);
    }
    return prefixes;
  }, [graph]);

  /** Build the effective external prefix set: hardcoded + dangling import targets */
  const externalPrefixes = useMemo(() => {
    const prefixes = new Set<string>(KNOWN_EXTERNAL);
    if (!graph) return prefixes;
    const allSymIds = new Set(graph.symbols.map((s) => s.id));
    for (const r of (graph as any).relations ?? []) {
      if (r.type !== "imports") continue;
      if (!allSymIds.has(r.target)) {
        // Import target has no symbol → external module
        const bare = (r.target as string).replace(/^(mod:|ext:)/, "");
        const first = bare.split(".")[0];
        if (first) prefixes.add(first);
      }
    }
    return prefixes;
  }, [graph]);

  const { own, stdlib } = useMemo(() => {
    const ownArr: Array<{ item: NavigableRelationItem; isOwn: true }> = [];
    const stdlibArr: Array<{ item: NavigableRelationItem; isOwn: false }> = [];
    for (const item of items) {
      if (isProjectOwn(item.symbol, item.symbolId, projectPrefixes, externalPrefixes)) {
        ownArr.push({ item, isOwn: true });
      } else {
        stdlibArr.push({ item, isOwn: false });
      }
    }
    return { own: ownArr, stdlib: stdlibArr };
  }, [items, projectPrefixes, externalPrefixes]);

  const renderItem = ({ item, isOwn }: { item: NavigableRelationItem; isOwn: boolean }) => {
    const singleRelation = item.relations.length === 1 ? item.relations[0] : null;

    return (
      <li
        key={item.symbolId}
        className={`rel-item ${isOwn ? "rel-own" : "rel-stdlib"} ${item.aiRelationIds.length > 0 ? "ai-generated-item" : ""}`}
      >
        <SymbolLink
          symbolId={item.symbolId}
          label={item.symbol.label}
          className={chipClassName ?? "symbol-link"}
          onClick={() => onSymbolClick(item.symbolId)}
        />
        {showKind && item.symbol.kind && <span className="rel-kind">({item.symbol.kind})</span>}
        {item.relations.length > 1 && (
          <span className="rel-confidence">{item.relations.length}x</span>
        )}
        {showConfidence && singleRelation?.confidence != null && singleRelation.confidence < 1 && (
          <span className="rel-confidence">{Math.round(singleRelation.confidence * 100)}%</span>
        )}
        {item.aiRelationIds.length > 0 && <AiRelationBadge relationIds={item.aiRelationIds} onConfirm={onConfirmAi} onReject={onRejectAi} />}
      </li>
    );
  };

  return (
    <ul>
      {own.map(renderItem)}
      {stdlib.length > 0 && (
        <li className="rel-stdlib-header" onClick={() => setShowStdlib(!showStdlib)}>
          <span className="rel-stdlib-toggle"><i className={showStdlib ? "bi bi-chevron-down" : "bi bi-chevron-right"} /></span>
          Vordefiniert ({stdlib.length})
        </li>
      )}
      {showStdlib && stdlib.map(renderItem)}
    </ul>
  );
}

function chipClassNameForBadge(badgeKey: string): string {
  if (badgeKey.includes(":reads")) return "shc-link-chip shc-link-read";
  if (badgeKey.includes(":writes")) return "shc-link-chip shc-link-write";
  if (badgeKey.includes(":imports")) return "shc-link-chip shc-link-import";
  if (badgeKey.includes(":inherits")) return "shc-link-chip shc-link-inherit";
  if (badgeKey.includes(":instantiates")) return "shc-link-chip shc-link-create";
  if (badgeKey.includes(":uses_config")) return "shc-link-chip shc-link-config";
  return "shc-link-chip shc-link-call";
}

function stageIdFromPackageId(symbolId: string | null | undefined): string | null {
  switch (symbolId) {
    case "proc:pkg:inputs":
      return "inputs";
    case "proc:pkg:extract":
      return "extract";
    case "proc:pkg:transform":
      return "transform";
    case "proc:pkg:match":
      return "match";
    case "proc:pkg:distribution":
      return "distribution";
    case "proc:pkg:simulation":
      return "simulation";
    default:
      return null;
  }
}

function resolveClusterEdgeItems(
  relation: Relation,
  srcSym: { id: string; preview?: { lines?: string[] }; tags?: string[] } | undefined,
  tgtSym: { id: string; preview?: { lines?: string[] }; tags?: string[] } | undefined,
) : ArtifactPreviewItem[] {
  const sourcePreview = srcSym ? buildArtifactPreview(srcSym) : null;
  const targetPreview = tgtSym ? buildArtifactPreview(tgtSym) : null;
  const clusterSym = sourcePreview?.kind === "cluster" ? srcSym : targetPreview?.kind === "cluster" ? tgtSym : undefined;
  const preview = sourcePreview?.kind === "cluster" ? sourcePreview : targetPreview?.kind === "cluster" ? targetPreview : null;
  if (!clusterSym || !preview) return [];

  const items = preview.itemEntries;
  if (items.length === 0) return [];

  const sourceStage = stageIdFromPackageId(relation.source);
  const targetStage = stageIdFromPackageId(relation.target);

  if (relation.type === "writes" && clusterSym.id === relation.target && sourceStage) {
    return items.filter((item) => item.producerStages.length === 0 || item.producerStages.includes(sourceStage));
  }

  if (relation.type === "reads" && clusterSym.id === relation.source && targetStage) {
    return items.filter((item) => item.consumerStages.includes(targetStage));
  }

  if (relation.type === "writes" && clusterSym.id === relation.source && targetStage) {
    return items.filter((item) => item.consumerStages.includes(targetStage));
  }

  if (relation.type === "reads" && clusterSym.id === relation.target && sourceStage) {
    return items.filter((item) => item.producerStages.includes(sourceStage));
  }

  return items;
}

/* ─── Edge Inspector Panel ─── */
function EdgeInspector({ onToggleInspector }: { onToggleInspector: () => void }) {
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const projectionMode = useAppStore((s) => s.projectionMode);
  const sequenceProjectionMode = useAppStore((s) => s.sequenceProjectionMode);
  const sequenceContext = useAppStore((s) => s.sequenceContext);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const updateRelation = useAppStore((s) => s.updateRelation);
  const removeRelation = useAppStore((s) => s.removeRelation);
  const diagramSettings = useAppStore((s) => s.diagramSettings);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const focusSymbolInContext = useAppStore((s) => s.focusSymbolInContext);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);

  const currentView = currentViewId && graph ? graph.views.find((view) => view.id === currentViewId) ?? null : null;
  const resolvedArtifactView = useMemo(
    () =>
      graph && currentView
        ? resolveArtifactView(graph, currentView, {
            input: diagramSettings.inputArtifactMode,
            generated: diagramSettings.generatedArtifactMode,
          })
        : null,
    [currentView, diagramSettings.generatedArtifactMode, diagramSettings.inputArtifactMode, graph],
  );
  const sequenceView =
    (projectionMode === "sequence" && !!sequenceContext && sequenceContext.originViewId === currentViewId) ||
    isPackageSequenceView(currentView, graph);
  const sequenceDetails = useMemo(() => {
    if (!graph || !currentView || !sequenceView) return null;
    if (projectionMode === "sequence" && sequenceContext && sequenceContext.originViewId === currentView.id) {
      return buildEdgeContextSequenceDiagramDetails({
        graph,
        view: currentView,
        sourceSymbolId: sequenceContext.sourceSymbolId,
        targetSymbolId: sequenceContext.targetSymbolId,
        relationFilters: diagramSettings.relationFilters,
        labelsMode: diagramSettings.labels,
        selectedSymbolId,
        selectedEdgeId,
      });
    }
    if (!resolvedArtifactView) return null;
    const hiddenSymbolIds = resolvedArtifactView.hiddenSymbolIds;
    const visibleViewNodeRefs = resolvedArtifactView.nodeRefs.filter((id) => !hiddenSymbolIds.has(id));
    return buildPackageSequenceDiagramDetails({
      graph,
      view: currentView,
      visibleViewNodeRefs,
      hiddenSymbolIds,
      symbolOverrides: resolvedArtifactView.symbolOverrides,
      relationFilters: diagramSettings.relationFilters,
      labelsMode: diagramSettings.labels,
      sequenceMode: sequenceProjectionMode,
      selectedSymbolId,
      selectedEdgeId,
    });
  }, [
    currentView,
    diagramSettings.labels,
    diagramSettings.relationFilters,
    graph,
    projectionMode,
    sequenceProjectionMode,
    resolvedArtifactView,
    selectedEdgeId,
    selectedSymbolId,
    sequenceContext,
    sequenceView,
  ]);
  const selectedSequenceMessage = selectedEdgeId && sequenceDetails
    ? sequenceDetails.messages.get(selectedEdgeId)
      ?? Array.from(sequenceDetails.messages.values()).find((message) => message.relationIds.includes(selectedEdgeId))
      ?? null
    : null;

  // Try direct relation lookup first
  const rel = graph?.relations.find((r) => r.id === selectedEdgeId);

  // If not found, parse as projected edge key: "source|target" / "source|target|type" / "source|target|type|relationId"
  const projectedParts = !rel && selectedEdgeId ? selectedEdgeId.split("|") : null;
  const validProjectedParts = projectedParts && projectedParts.length >= 2 && projectedParts.length <= 4
    ? projectedParts
    : null;
  const isProjected = Boolean(validProjectedParts);
  const projSrc = validProjectedParts?.[0] ?? null;
  const projTgt = validProjectedParts?.[1] ?? null;
  const projType = validProjectedParts && validProjectedParts.length >= 3 ? validProjectedParts[2] : null;
  const projRelationId = validProjectedParts && validProjectedParts.length === 4 ? validProjectedParts[3] : null;

  // For projected edges, find the underlying relations
  const projectedRelations = isProjected
    ? (graph?.relations ?? []).filter((r) => {
        // Check if source/target ancestors include the projected endpoints
        const srcChain = getAncestorChain(r.source, graph?.symbols ?? []);
        const tgtChain = getAncestorChain(r.target, graph?.symbols ?? []);
        return (
          srcChain.includes(projSrc!) &&
          tgtChain.includes(projTgt!) &&
          (!projType || r.type === projType) &&
          (!projRelationId || r.id === projRelationId)
        );
      })
    : [];
  const representativeRelation = rel ?? projectedRelations[0];

  const srcSym = graph?.symbols.find((s) => s.id === (representativeRelation?.source ?? projSrc));
  const tgtSym = graph?.symbols.find((s) => s.id === (representativeRelation?.target ?? projTgt));
  const clusterEdgeItems = representativeRelation ? resolveClusterEdgeItems(representativeRelation, srcSym, tgtSym) : [];
  const projectedTypeSummary = useMemo(() => {
    if (projectedRelations.length === 0) return projType ?? "";
    const typeCounts = new Map<RelationType, number>();
    for (const relation of projectedRelations) {
      typeCounts.set(relation.type, (typeCounts.get(relation.type) ?? 0) + 1);
    }
    return [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count]) => (count > 1 ? `${count}x ${type}` : type))
      .join(", ");
  }, [projType, projectedRelations]);

  const [label, setLabel] = useState(representativeRelation?.label ?? projType ?? "");
  const [relType, setRelType] = useState<RelationType>((representativeRelation?.type ?? projType ?? "calls") as RelationType);

  useEffect(() => {
    setLabel(representativeRelation?.label ?? projType ?? "");
    setRelType((representativeRelation?.type ?? projType ?? "calls") as RelationType);
  }, [representativeRelation, projType]);

  if (!rel && !isProjected) return null;

  const handleSave = () => {
    if (rel) {
      updateRelation(rel.id, { label, type: relType as Relation["type"] });
    }
  };

  const handleSymbolClick = (symId: string) => {
    if (!graph) return;
    const resolvedId = resolveNavigableSymbolId(graph, symId);
    if (!resolvedId) return;
    focusSymbolInContext(resolvedId);
  };

  if (selectedSequenceMessage) {
    return (
      <SequenceMessageInspectorPanel
        message={selectedSequenceMessage}
        projection={sequenceDetails?.projection ?? null}
        onSymbolClick={handleSymbolClick}
        onToggleInspector={onToggleInspector}
      />
    );
  }

  return (
    <div className="inspector">
      <div className="inspector-header-row">
        <h2>Edge Inspector</h2>
        <div className="inspector-header-actions">
          <button
            className="inspector-header-btn inspector-header-btn--collapse"
            onClick={onToggleInspector}
            title="Inspector einklappen"
          >
            <i className="bi bi-layout-sidebar-inset-reverse" />
          </button>
        </div>
      </div>

      <div className="inspector-card">
        <h3 style={{ fontSize: 13 }}>
          <SymbolLink symbolId={srcSym?.id ?? ""} label={srcSym?.label ?? representativeRelation?.source ?? projSrc ?? ""} onClick={() => srcSym && handleSymbolClick(srcSym.id)} />
          {" → "}
          <SymbolLink symbolId={tgtSym?.id ?? ""} label={tgtSym?.label ?? representativeRelation?.target ?? projTgt ?? ""} onClick={() => tgtSym && handleSymbolClick(tgtSym.id)} />
        </h3>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          Typ: <strong style={{ color: "var(--accent)" }}>{rel?.type ?? projectedTypeSummary}</strong>
          {isProjected && projectedRelations.length > 1 && (
            <span> ({projectedRelations.length} aggregated)</span>
          )}
          {representativeRelation?.confidence != null && representativeRelation.confidence < 1 && (
            <span> · Confidence: {Math.round(representativeRelation.confidence * 100)}%</span>
          )}
        </div>
        {representativeRelation?.label && (
          <div style={{ fontSize: 12, marginTop: 8, color: "var(--text)" }}>
            {representativeRelation.label}
          </div>
        )}
      </div>

      {/* Show underlying relations for projected edges */}
      {isProjected && projectedRelations.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Enthaltene Relationen</div>
          <ul>
            {projectedRelations.slice(0, 20).map((r) => {
              const s = graph?.symbols.find((sym) => sym.id === r.source);
              const t = graph?.symbols.find((sym) => sym.id === r.target);
              return (
                <li key={r.id} style={{ fontSize: 11 }}>
                  <SymbolLink symbolId={r.source} label={s?.label ?? r.source} onClick={() => handleSymbolClick(r.source)} />
                  {" → "}
                  <SymbolLink symbolId={r.target} label={t?.label ?? r.target} onClick={() => handleSymbolClick(r.target)} />
                  {r.confidence != null && r.confidence < 1 && (
                    <span style={{ color: "var(--text-dim)" }}> ({Math.round(r.confidence * 100)}%)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {clusterEdgeItems.length > 0 && (
        <div className="inspector-card">
          <div className="field-label">Cluster-Elemente auf dieser Kante</div>
          <div className="inspector-cluster-member-list">
            {clusterEdgeItems.map((item) => (
              <div key={`${item.label}-${item.paths[0] ?? "none"}`} className="inspector-cluster-member">
                <div className="inspector-cluster-member__title">{item.label}</div>
                {item.paths.length > 0 && (
                  <div className="inspector-cluster-member__meta">{item.paths.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit label/type only for direct relations */}
      {rel && (
        <>
          <div className="inspector-card">
            <div className="field-label">Label</div>
            <input
              className="inspector-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="z.B. calls, imports, uses…"
            />
          </div>

          <div className="inspector-card">
            <div className="field-label">Type</div>
            <select
              className="inspector-select"
              value={relType}
              onChange={(e) => {
                const val = e.target.value as RelationType;
                setRelType(val);
                updateRelation(rel.id, { type: val, label: val });
                setLabel(val);
              }}
            >
              {RELATION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
            <button className="btn btn-sm btn-danger" onClick={() => { removeRelation(rel.id); selectEdge(null); }}>
              <i className="bi bi-trash" /> Kante löschen
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Helper: get ancestor chain for a symbol */
function getAncestorChain(symId: string, symbols: { id: string; parentId?: string }[]): string[] {
  const chain = [symId];
  let current = symbols.find((s) => s.id === symId);
  let depth = 0;
  while (current?.parentId && depth < 20) {
    chain.push(current.parentId);
    current = symbols.find((s) => s.id === current!.parentId);
    depth++;
  }
  return chain;
}

interface ArtifactLinkRef {
  key: string;
  label: string;
  symbolId: string | null;
  kind: string | null;
}

function normalizeSymbolReference(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:/\\()[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findSymbolByReference(graph: ProjectGraph | null, reference: string): ArtifactLinkRef | null {
  if (!graph || !reference.trim()) return null;

  const exact = graph.symbols.find((symbol) => symbol.id === reference || symbol.label === reference);
  if (exact) {
    return {
      key: `exact:${exact.id}`,
      label: exact.label,
      symbolId: exact.id,
      kind: exact.kind,
    };
  }

  const normalizedReference = normalizeSymbolReference(reference);
  if (!normalizedReference) return null;

  const exactNormalized = graph.symbols.find(
    (symbol) => normalizeSymbolReference(symbol.label) === normalizedReference,
  );
  if (exactNormalized) {
    return {
      key: `norm:${exactNormalized.id}`,
      label: exactNormalized.label,
      symbolId: exactNormalized.id,
      kind: exactNormalized.kind,
    };
  }

  const lastSegment = graph.symbols.find((symbol) => {
    const tail = symbol.label.split(".").pop() ?? symbol.label;
    return normalizeSymbolReference(tail) === normalizedReference;
  });
  if (lastSegment) {
    return {
      key: `tail:${lastSegment.id}`,
      label: lastSegment.label,
      symbolId: lastSegment.id,
      kind: lastSegment.kind,
    };
  }

  return null;
}

function toArtifactLinkRefs(items: NavigableRelationItem[]): ArtifactLinkRef[] {
  return items.map((item) => ({
    key: `nav:${item.symbolId}`,
    label: item.symbol.label,
    symbolId: item.symbolId,
    kind: item.symbol.kind,
  }));
}

function mergeArtifactLinkRefs(...groups: ArtifactLinkRef[][]): ArtifactLinkRef[] {
  const merged = new Map<string, ArtifactLinkRef>();
  for (const group of groups) {
    for (const item of group) {
      const key = item.symbolId ?? `label:${item.label}`;
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    }
  }
  return [...merged.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function stageLinkRefs(graph: ProjectGraph | null, stageIds: string[], keyPrefix: string): ArtifactLinkRef[] {
  if (!graph) return [];
  const refs: ArtifactLinkRef[] = [];
  for (const stageId of stageIds) {
    const packageId = PROCESS_STAGE_PACKAGE_IDS[stageId];
    if (!packageId) continue;
    const symbol = graph.symbols.find((entry) => entry.id === packageId);
    if (!symbol) continue;
    refs.push({
      key: `${keyPrefix}:${packageId}`,
      label: symbol.label,
      symbolId: symbol.id,
      kind: symbol.kind,
    });
  }
  return refs;
}

function symbolIdLinkRefs(graph: ProjectGraph | null, ids: string[], keyPrefix: string): ArtifactLinkRef[] {
  if (!graph) return [];
  const refs: ArtifactLinkRef[] = [];
  for (const id of ids) {
    const symbol = graph.symbols.find((entry) => entry.id === id);
    if (!symbol) continue;
    refs.push({
      key: `${keyPrefix}:${id}`,
      label: symbol.label,
      symbolId: symbol.id,
      kind: symbol.kind,
    });
  }
  return refs;
}

function symbolLabelLinkRefs(graph: ProjectGraph | null, labels: string[], keyPrefix: string): ArtifactLinkRef[] {
  return labels.map((label, index) => {
    const resolved = findSymbolByReference(graph, label);
    if (resolved) {
      return {
        key: `${keyPrefix}:${resolved.symbolId ?? index}`,
        label: resolved.label,
        symbolId: resolved.symbolId,
        kind: resolved.kind,
      };
    }
    return {
      key: `${keyPrefix}:raw:${index}:${label}`,
      label,
      symbolId: null,
      kind: null,
    };
  });
}

function resolveArtifactSymbolIds(graph: ProjectGraph | null, item: ArtifactPreviewItem): string[] {
  if (!graph) return [];

  const directIds = item.artifactIds.filter((artifactId) =>
    graph.symbols.some((symbol) => symbol.id === artifactId),
  );
  if (directIds.length > 0) {
    return [...new Set(directIds)];
  }

  const exactLabelMatches = graph.symbols
    .filter((symbol) => symbol.id.startsWith("proc:artifact:") && symbol.label === item.label)
    .map((symbol) => symbol.id);
  if (exactLabelMatches.length > 0) {
    return [...new Set(exactLabelMatches)];
  }

  const pathMatches = graph.symbols
    .filter((symbol) =>
      symbol.id.startsWith("proc:artifact:") &&
      symbol.preview?.lines?.some((line) => item.paths.some((path) => line.includes(path))),
    )
    .map((symbol) => symbol.id);
  if (pathMatches.length > 0) {
    return [...new Set(pathMatches)];
  }

  const normalizedLabel = normalizeSymbolReference(item.label);
  return [
    ...new Set(
      graph.symbols
        .filter((symbol) =>
          symbol.id.startsWith("proc:artifact:") &&
          normalizeSymbolReference(symbol.label) === normalizedLabel,
        )
        .map((symbol) => symbol.id),
    ),
  ];
}

function buildArtifactItemRelations(
  graph: ProjectGraph | null,
  item: ArtifactPreviewItem,
): {
  reads: ArtifactLinkRef[];
  readBy: ArtifactLinkRef[];
  writes: ArtifactLinkRef[];
  writtenBy: ArtifactLinkRef[];
} {
  if (!graph) {
    return { reads: [], readBy: [], writes: [], writtenBy: [] };
  }

  const artifactIds = resolveArtifactSymbolIds(graph, item);
  const relations = graph.relations.filter((relation) =>
    artifactIds.includes(relation.source) || artifactIds.includes(relation.target),
  );

  const actualReads = toArtifactLinkRefs(
    buildNavigableRelationItems(
      graph,
      relations.filter((relation) => artifactIds.includes(relation.source) && relation.type === "reads"),
      "out",
    ),
  );
  const actualReadBy = toArtifactLinkRefs(
    buildNavigableRelationItems(
      graph,
      relations.filter((relation) => artifactIds.includes(relation.target) && relation.type === "reads"),
      "in",
    ),
  );
  const actualWrites = toArtifactLinkRefs(
    buildNavigableRelationItems(
      graph,
      relations.filter((relation) => artifactIds.includes(relation.source) && relation.type === "writes"),
      "out",
    ),
  );
  const actualWrittenBy = toArtifactLinkRefs(
    buildNavigableRelationItems(
      graph,
      relations.filter((relation) => artifactIds.includes(relation.target) && relation.type === "writes"),
      "in",
    ),
  );

  const previewReadBy = mergeArtifactLinkRefs(
    symbolIdLinkRefs(graph, item.consumerIds, "consumer-id"),
    symbolLabelLinkRefs(graph, item.consumers, "consumer-label"),
    stageLinkRefs(graph, item.consumerStages, "consumer-stage"),
  );
  const previewWrittenBy = mergeArtifactLinkRefs(
    symbolIdLinkRefs(graph, item.producerIds, "producer-id"),
    symbolLabelLinkRefs(graph, item.producers, "producer-label"),
    stageLinkRefs(graph, item.producerStages, "producer-stage"),
  );

  return {
    reads: actualReads,
    readBy: mergeArtifactLinkRefs(actualReadBy, previewReadBy),
    writes: actualWrites,
    writtenBy: mergeArtifactLinkRefs(actualWrittenBy, previewWrittenBy),
  };
}

function InspectorHoverSymbolLink({
  symbolId,
  label,
  onClick,
  className = "symbol-link",
}: {
  symbolId: string;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      scheduleShowHover(symbolId, rect, { source: "inspector" });
    },
    [symbolId],
  );

  return (
    <span
      className={className}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => scheduleHideHover()}
    >
      {label}
    </span>
  );
}

function ArtifactRelationSection({
  title,
  badgeKey,
  items,
  onSymbolClick,
}: {
  title: string;
  badgeKey: string;
  items: ArtifactLinkRef[];
  onSymbolClick: (symbolId: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="artifact-preview-relation-section">
      <div className="artifact-preview-relation-header">
        <div className="shc-preview-subsection-label">{title} ({items.length})</div>
        <RelBadgeTag badgeKey={badgeKey} />
      </div>
      <ul className="artifact-preview-relation-list">
        {items.map((item) => (
          <li
            key={item.key}
            className={`rel-item ${item.symbolId ? "rel-own" : "artifact-preview-relation-item--static"}`}
          >
            {item.symbolId ? (
              <>
                <InspectorHoverSymbolLink
                  symbolId={item.symbolId}
                  label={item.label}
                  onClick={() => onSymbolClick(item.symbolId!)}
                />
                {item.kind && <span className="artifact-preview-kind">{item.kind}</span>}
              </>
            ) : (
              <>
                <span className="artifact-preview-static-label">{item.label}</span>
                {item.kind && <span className="artifact-preview-kind">{item.kind}</span>}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArtifactPreviewItemCard({
  item,
  itemKeyPrefix,
  graph,
  onSymbolClick,
}: {
  item: ArtifactPreviewItem;
  itemKeyPrefix: string;
  graph: ProjectGraph | null;
  onSymbolClick: (symbolId: string) => void;
}) {
  const relationLinks = useMemo(() => buildArtifactItemRelations(graph, item), [graph, item]);

  return (
    <div className="shc-preview-item">
      <div className="shc-preview-item-header">
        <div className="shc-preview-item-title">{item.label}</div>
        <div className="shc-preview-metrics">
          {item.writeCount != null && (
            <span className="shc-preview-metric shc-preview-metric--write">W {item.writeCount}</span>
          )}
          {item.readCount != null && (
            <span className="shc-preview-metric shc-preview-metric--read">R {item.readCount}</span>
          )}
        </div>
      </div>

      {item.paths.length > 0 && (
        <div className="shc-preview-subsection">
          <div className="shc-preview-subsection-label">Pfade</div>
          <div className="shc-preview-chip-row">
            {item.paths.map((path, index) => (
              <span key={`${itemKeyPrefix}-path-${index}`} className="shc-preview-chip shc-preview-chip--path">
                {path}
              </span>
            ))}
          </div>
        </div>
      )}

      {(item.reviewHints?.length ?? 0) > 0 && (
        <div className="shc-preview-subsection">
          <div className="shc-preview-subsection-label">Diagnose</div>
          <div className="shc-preview-chip-row">
            {(item.reviewHints ?? []).map((hint, index) => (
              <span key={`${itemKeyPrefix}-hint-${index}`} className="shc-preview-chip">
                {hint}
              </span>
            ))}
          </div>
        </div>
      )}

      <ArtifactRelationSection
        title="Liest"
        badgeKey="out:reads"
        items={relationLinks.reads}
        onSymbolClick={onSymbolClick}
      />

      <ArtifactRelationSection
        title="Gelesen von"
        badgeKey="in:reads"
        items={relationLinks.readBy}
        onSymbolClick={onSymbolClick}
      />

      <ArtifactRelationSection
        title="Schreibt"
        badgeKey="out:writes"
        items={relationLinks.writes}
        onSymbolClick={onSymbolClick}
      />

      <ArtifactRelationSection
        title="Geschrieben von"
        badgeKey="in:writes"
        items={relationLinks.writtenBy}
        onSymbolClick={onSymbolClick}
      />
    </div>
  );
}

function ArtifactPreviewInspectorSection({
  preview,
  symbolId,
  graph,
  showState,
  onSymbolClick,
}: {
  preview: ArtifactPreviewData;
  symbolId: string;
  graph: ProjectGraph | null;
  showState: boolean;
  onSymbolClick: (symbolId: string) => void;
}) {
  const metaChips = buildArtifactPreviewMetaChips(preview);
  const primaryItem = preview.itemEntries[0] ?? null;
  const title = "Artefaktdetails";
  const stateLabel = !showState
    ? null
    : preview.kind === "cluster"
    ? `Cluster${preview.itemCount != null ? ` · ${preview.itemCount}` : ""}`
    : preview.kind === "single"
      ? "Einzelobjekt"
      : "Detailinfo";

  return (
    <div className="inspector-card">
      <div className="field-label">
        <i className={`bi ${preview.kind === "cluster" ? "bi-collection" : "bi-file-earmark-text"}`} /> {title}
      </div>

      <div className="shc-preview-summary-block">
        {stateLabel && (
          <div className={`artifact-state-pill artifact-state-pill--${preview.kind === "cluster" ? "cluster" : "single"}`}>
            <i className={`bi ${preview.kind === "cluster" ? "bi-collection" : "bi-file-earmark-text"}`} />
            {stateLabel}
          </div>
        )}

        {preview.kind === "cluster" ? (
          <>
            <div className="shc-preview-count">
              <i className="bi bi-collection" />
              {preview.itemCount ?? preview.itemEntries.length} Artefakte
              {preview.groupCount != null && preview.itemCount != null && preview.groupCount !== preview.itemCount && (
                <span className="shc-dim"> in {preview.groupCount} Gruppen</span>
              )}
            </div>
            {preview.summaryItems.length > 0 && (
              <div className="shc-preview-summary">
                <span className="shc-preview-summary-label">Beispiele:</span>
                <span className="shc-preview-summary-text">{preview.summaryItems.join(" · ")}</span>
                {(preview.itemCount ?? 0) > preview.summaryItems.length && (
                  <span className="shc-dim"> +{(preview.itemCount ?? 0) - preview.summaryItems.length} weitere</span>
                )}
              </div>
            )}
          </>
        ) : primaryItem ? (
          <div className="shc-preview-count">
            <i className="bi bi-file-earmark-text" />
            {primaryItem.label}
          </div>
        ) : null}
      </div>

      {metaChips.length > 0 && (
        <div className="shc-preview-meta-list">
          {metaChips.map((chip, index) => (
            <span key={`${symbolId}-artifact-chip-${index}`} className="shc-preview-meta-chip">
              {chip}
            </span>
          ))}
        </div>
      )}

      {preview.detailRows.length > 0 && (
        <div className="shc-preview-detail-list">
          {preview.detailRows.map((row, index) => (
            <div key={`${symbolId}-artifact-detail-${index}`} className="shc-preview-detail-row">
              <div className="shc-preview-detail-label">{translateArtifactPreviewLabel(row.label)}</div>
              <div className="shc-preview-detail-value">
                <div className="shc-preview-chip-row">
                  {(row.values.length > 1 ? row.values : [row.value]).map((value, valueIndex) => {
                    const resolved = findSymbolByReference(graph, value);
                    return resolved?.symbolId ? (
                      <InspectorHoverSymbolLink
                        key={`${symbolId}-artifact-detail-value-${index}-${valueIndex}`}
                        symbolId={resolved.symbolId}
                        label={resolved.label}
                        className="shc-preview-chip shc-preview-chip--link"
                        onClick={() => onSymbolClick(resolved.symbolId!)}
                      />
                    ) : (
                      <span key={`${symbolId}-artifact-detail-value-${index}-${valueIndex}`} className="shc-preview-chip">
                        {value}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview.kind === "cluster" && preview.itemEntries.length > 0 && (
        <div className="shc-preview-box inspector-artifact-list">
          {preview.itemEntries.map((item, index) => (
            <ArtifactPreviewItemCard
              key={`${symbolId}-artifact-item-${item.label}-${index}`}
              item={item}
              itemKeyPrefix={`${symbolId}-artifact-item-${index}`}
              graph={graph}
              onSymbolClick={onSymbolClick}
            />
          ))}
        </div>
      )}

      {preview.kind === "single" && primaryItem && (
        <div className="inspector-artifact-single">
          <ArtifactPreviewItemCard
            item={primaryItem}
            itemKeyPrefix={`${symbolId}-artifact-single`}
            graph={graph}
            onSymbolClick={onSymbolClick}
          />
        </div>
      )}

      {preview.rawLines.length > 0 && (
        <div className="shc-preview-box inspector-artifact-raw">
          {preview.rawLines.map((line, index) => (
            <div key={`${symbolId}-artifact-raw-${index}`} className="shc-preview-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Hoverable Symbol Link — shows HoverCard on hover, navigates on click ─── */
function SymbolLink({
  symbolId,
  label,
  onClick,
  className,
}: {
  symbolId: string;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return <InspectorHoverSymbolLink symbolId={symbolId} label={label} onClick={onClick} className={className} />;
}

/* ─── AI Inspector Animation Hook ─── */
/**
 * Detects when AI-generated content changes in the inspector for the selected symbol.
 * Uses the store-driven animationSymbolId / animationSeq mechanism (same as UmlNode)
 * so animations fire in sync with the playback queue navigation.
 *
 * Returns a CSS class string that triggers a typewriter-style reveal animation
 * on the inspector card content.
 */
function useAiInspectorAnimation(sym: { id: string; doc?: { summary?: string; inputs?: unknown[]; outputs?: unknown[]; sideEffects?: unknown[]; aiGenerated?: Record<string, unknown> } } | undefined): string {
  const [animClass, setAnimClass] = useState("");
  const animationSymbolId = useAppStore((s) => s.aiAnalysis?.animationSymbolId ?? null);
  const animationSeq = useAppStore((s) => s.aiAnalysis?.animationSeq ?? 0);
  const lastAppliedSeqRef = useRef(0);

  useEffect(() => {
    if (!sym) return;
    if (animationSeq === 0 || animationSeq === lastAppliedSeqRef.current) return;
    lastAppliedSeqRef.current = animationSeq;
    if (animationSymbolId !== sym.id) return;

    setAnimClass("inspector-ai-typing");
    const timer = setTimeout(() => setAnimClass(""), 2500);
    return () => clearTimeout(timer);
  }, [animationSeq, animationSymbolId, sym?.id]);

  return animClass;
}

/* ─── Symbol Inspector Panel ─── */
export function Inspector() {
  const graph = useAppStore((s) => s.graph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const selectedSymbolId = useAppStore((s) => s.selectedSymbolId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const focusSymbolInContext = useAppStore((s) => s.focusSymbolInContext);
  const updateGraph = useAppStore((s) => s.updateGraph);
  const updateSymbol = useAppStore((s) => s.updateSymbol);
  const removeSymbol = useAppStore((s) => s.removeSymbol);
  const addRelation = useAppStore((s) => s.addRelation);
  const inspectorCollapsed = useAppStore((s) => s.inspectorCollapsed);
  const toggleInspector = useAppStore((s) => s.toggleInspector);
  const confirmAiField = useAppStore((s) => s.confirmAiField);
  const rejectAiField = useAppStore((s) => s.rejectAiField);
  const confirmAiRelation = useAppStore((s) => s.confirmAiRelation);
  const openSourceViewer = useAppStore((s) => s.openSourceViewer);
  const removeRelation = useAppStore((s) => s.removeRelation);
  const diagramSettings = useAppStore((s) => s.diagramSettings);
  const sequenceProjectionMode = useAppStore((s) => s.sequenceProjectionMode);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Edit mode toggle
  const [editMode, setEditMode] = useState(false);

  // Editing states
  const [editLabel, setEditLabel] = useState("");
  const [editKind, setEditKind] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // Tag editing
  const [newTag, setNewTag] = useState("");

  // Section-level inline editing
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editInputs, setEditInputs] = useState<Array<{ name: string; type: string; description: string }>>([]);
  const [editOutputs, setEditOutputs] = useState<Array<{ name: string; type: string; description: string }>>([]);
  const [editSideEffects, setEditSideEffects] = useState<string[]>([]);
  const [newSideEffect, setNewSideEffect] = useState("");

  // New connection state
  const [showAddConn, setShowAddConn] = useState(false);
  const [connTarget, setConnTarget] = useState("");
  const [connType, setConnType] = useState<string>("calls");
  const [connLabel, setConnLabel] = useState("calls");
  const [showDiagramSettings, setShowDiagramSettings] = useState(false);

  const currentView = currentViewId && graph ? graph.views.find((view) => view.id === currentViewId) ?? null : null;
  const resolvedArtifactView = useMemo(
    () =>
      graph && currentView
        ? resolveArtifactView(graph, currentView, {
            input: diagramSettings.inputArtifactMode,
            generated: diagramSettings.generatedArtifactMode,
          })
        : null,
    [currentView, diagramSettings.generatedArtifactMode, diagramSettings.inputArtifactMode, graph],
  );
  const sequenceView = isPackageSequenceView(currentView, graph);
  const sequenceDetails = useMemo(() => {
    if (!graph || !currentView || !resolvedArtifactView || !sequenceView) return null;
    const hiddenSymbolIds = resolvedArtifactView.hiddenSymbolIds;
    const visibleViewNodeRefs = resolvedArtifactView.nodeRefs.filter((id) => !hiddenSymbolIds.has(id));
    return buildPackageSequenceDiagramDetails({
      graph,
      view: currentView,
      visibleViewNodeRefs,
      hiddenSymbolIds,
      symbolOverrides: resolvedArtifactView.symbolOverrides,
      relationFilters: diagramSettings.relationFilters,
      labelsMode: diagramSettings.labels,
      sequenceMode: sequenceProjectionMode,
      selectedSymbolId,
      selectedEdgeId,
    });
  }, [
    currentView,
    diagramSettings.labels,
    diagramSettings.relationFilters,
    graph,
    resolvedArtifactView,
    sequenceProjectionMode,
    selectedEdgeId,
    selectedSymbolId,
    sequenceView,
  ]);
  const symbolOverrides = resolvedArtifactView?.symbolOverrides ?? new Map<string, GraphSymbol>();
  const sym = selectedSymbolId
    ? symbolOverrides.get(selectedSymbolId) ?? graph?.symbols.find((s) => s.id === selectedSymbolId)
    : undefined;
  const selectedSequenceParticipant = selectedSymbolId && sequenceDetails
    ? sequenceDetails.participants.get(selectedSymbolId) ?? null
    : null;
  const inspectorAnimClass = useAiInspectorAnimation(sym);

  // Reset edit form when symbol changes
  useEffect(() => {
    if (sym) {
      setEditLabel(sym.label);
      setEditKind(sym.kind);
      setEditSummary(sym.doc?.summary ?? "");
      setIsEditing(false);
      setShowAddConn(false);
      setEditingSection(null);
      setNewTag("");
      setEditMode(false);
    }
  }, [sym?.id]);

  useEffect(() => {
    const onInspectorCommand = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "open-settings") {
        if (inspectorCollapsed) toggleInspector();
        setShowDiagramSettings(true);
      }
    };

    window.addEventListener("dmpg:inspector-command", onInspectorCommand as EventListener);
    return () => window.removeEventListener("dmpg:inspector-command", onInspectorCommand as EventListener);
  }, [inspectorCollapsed, toggleInspector]);

  useEffect(() => {
    if (!showDiagramSettings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDiagramSettings(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showDiagramSettings]);

  const settingsOverlay = showDiagramSettings ? (
    <div className="inspector-settings-overlay" onClick={() => setShowDiagramSettings(false)}>
      <div className="inspector-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="inspector-settings-modal__header">
          <h3>Diagram Settings</h3>
          <button
            className="inspector-settings-modal__close"
            onClick={() => setShowDiagramSettings(false)}
            title="Diagram Settings schließen"
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="inspector-settings-modal__body">
          <DiagramSettingsPanel />
        </div>
      </div>
    </div>
  ) : null;

  const handleAiGenerate = useCallback(async () => {
    if (!sym) return;
    setAiLoading(true);
    setAiError("");
    try {
      const result = await summarizeSymbol(sym.id, undefined, sym.doc?.summary);
      if (graph) {
        const updated = {
          ...graph,
          symbols: graph.symbols.map((s) =>
            s.id === sym.id ? { ...s, doc: { ...s.doc, ...result.doc } } : s,
          ),
        };
        updateGraph(updated);
      }
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }, [sym, graph, updateGraph]);

  const handleSaveEdit = useCallback(() => {
    if (!sym) return;
    updateSymbol(sym.id, {
      label: editLabel,
      kind: editKind as any,
      doc: { ...sym.doc, summary: editSummary },
    });
    setIsEditing(false);
  }, [sym, editLabel, editKind, editSummary, updateSymbol]);

  // ─── Tag helpers ───
  const handleAddTag = useCallback(() => {
    if (!sym || !newTag.trim()) return;
    const tags = [...(sym.tags ?? []), newTag.trim()];
    updateSymbol(sym.id, { tags });
    setNewTag("");
  }, [sym, newTag, updateSymbol]);

  const handleRemoveTag = useCallback((tag: string) => {
    if (!sym) return;
    const tags = (sym.tags ?? []).filter((t) => t !== tag);
    updateSymbol(sym.id, { tags });
  }, [sym, updateSymbol]);

  // ─── Parameter (inputs) helpers ───
  const handleStartEditInputs = useCallback(() => {
    const inputs = sym?.doc?.inputs ?? [];
    setEditInputs(inputs.map((p) => ({ name: p.name, type: p.type ?? "", description: p.description ?? "" })));
    setEditingSection("inputs");
  }, [sym]);

  const handleSaveInputs = useCallback(() => {
    if (!sym) return;
    const cleaned = editInputs.filter((p) => p.name.trim());
    updateSymbol(sym.id, {
      doc: { ...sym.doc, inputs: cleaned.length ? cleaned.map((p) => ({ name: p.name, type: p.type || undefined, description: p.description || undefined })) : undefined },
    });
    setEditingSection(null);
  }, [sym, editInputs, updateSymbol]);

  const handleAddInput = useCallback(() => {
    setEditInputs((prev) => [...prev, { name: "", type: "", description: "" }]);
  }, []);

  const handleRemoveInput = useCallback((idx: number) => {
    setEditInputs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleInputChange = useCallback((idx: number, field: "name" | "type" | "description", value: string) => {
    setEditInputs((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, []);

  // ─── Output helpers ───
  const handleStartEditOutputs = useCallback(() => {
    const outputs = sym?.doc?.outputs ?? [];
    setEditOutputs(outputs.map((p) => ({ name: p.name, type: p.type ?? "", description: p.description ?? "" })));
    setEditingSection("outputs");
  }, [sym]);

  const handleSaveOutputs = useCallback(() => {
    if (!sym) return;
    const cleaned = editOutputs.filter((p) => p.name.trim());
    updateSymbol(sym.id, {
      doc: { ...sym.doc, outputs: cleaned.length ? cleaned.map((p) => ({ name: p.name, type: p.type || undefined, description: p.description || undefined })) : undefined },
    });
    setEditingSection(null);
  }, [sym, editOutputs, updateSymbol]);

  const handleAddOutput = useCallback(() => {
    setEditOutputs((prev) => [...prev, { name: "", type: "", description: "" }]);
  }, []);

  const handleRemoveOutput = useCallback((idx: number) => {
    setEditOutputs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleOutputChange = useCallback((idx: number, field: "name" | "type" | "description", value: string) => {
    setEditOutputs((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, []);

  // ─── Side Effects helpers ───
  const handleStartEditSideEffects = useCallback(() => {
    setEditSideEffects([...(sym?.doc?.sideEffects ?? [])]);
    setNewSideEffect("");
    setEditingSection("sideEffects");
  }, [sym]);

  const handleSaveSideEffects = useCallback(() => {
    if (!sym) return;
    const cleaned = editSideEffects.filter((s) => s.trim());
    updateSymbol(sym.id, {
      doc: { ...sym.doc, sideEffects: cleaned.length ? cleaned : undefined },
    });
    setEditingSection(null);
  }, [sym, editSideEffects, updateSymbol]);

  const handleAddSideEffect = useCallback(() => {
    if (!newSideEffect.trim()) return;
    setEditSideEffects((prev) => [...prev, newSideEffect.trim()]);
    setNewSideEffect("");
  }, [newSideEffect]);

  const handleRemoveSideEffect = useCallback((idx: number) => {
    setEditSideEffects((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSideEffectChange = useCallback((idx: number, value: string) => {
    setEditSideEffects((prev) => prev.map((s, i) => i === idx ? value : s));
  }, []);

  const handleAddConnection = useCallback(() => {
    if (!sym || !connTarget || !currentViewId) return;
    const relId = `rel-${Date.now()}`;
    const newRel: Relation = {
      id: relId,
      type: connType as Relation["type"],
      source: sym.id,
      target: connTarget,
      label: connLabel || connType,
      confidence: 1,
    };
    addRelation(newRel, currentViewId);
    setShowAddConn(false);
    setConnTarget("");
    setConnType("calls");
    setConnLabel("calls");
  }, [sym, connTarget, connType, connLabel, currentViewId, addRelation]);

  const handleSymbolLinkClick = useCallback(
    (targetId: string) => {
      if (!graph) return;
      const resolvedId = resolveNavigableSymbolId(graph, targetId);
      if (!resolvedId) return;
      focusSymbolInContext(resolvedId);
    },
    [graph, focusSymbolInContext],
  );

  // If an edge is selected, show edge inspector (AFTER all hooks!)
  if (inspectorCollapsed) {
    return (
      <div className="inspector inspector--collapsed">
        <button
          className="inspector-header-btn inspector-header-btn--expand"
          onClick={toggleInspector}
          title="Inspector öffnen"
        >
          <i className="bi bi-layout-sidebar-inset" />
        </button>
      </div>
    );
  }

  if (selectedEdgeId && !selectedSymbolId) {
    return (
      <EdgeInspector onToggleInspector={toggleInspector} />
    );
  }

  if (!sym) {
    return (
      <div className="inspector">
        <div className="inspector-header-row">
          <h2>Inspector</h2>
          <div className="inspector-header-actions">
            <button
              className={`btn btn-xs inspector-settings-toggle${showDiagramSettings ? " inspector-settings-toggle--active" : ""}`}
              onClick={() => setShowDiagramSettings(true)}
              title="Diagram Settings öffnen"
            >
              <i className="bi bi-sliders" /> Diagram Settings
            </button>
            <button
              className="inspector-header-btn inspector-header-btn--collapse"
              onClick={toggleInspector}
              title="Inspector einklappen"
            >
              <i className="bi bi-layout-sidebar-inset-reverse" />
            </button>
          </div>
        </div>
        {sequenceView && sequenceDetails?.projection ? (
          <>
            <SequenceProjectionCard projection={sequenceDetails.projection} empty />
            <div className="empty-state">
              Click a node or edge to inspect it
            </div>
          </>
        ) : (
          <div className="empty-state">
            Click a node or edge to inspect it
          </div>
        )}
        {settingsOverlay}
      </div>
    );
  }

  const doc = sym?.doc;
  const relations = sym
    ? resolvedArtifactView?.relations.filter((r) => r.source === sym.id || r.target === sym.id) ??
      graph?.relations.filter((r) => r.source === sym.id || r.target === sym.id) ??
      []
    : [];

  // Enriched info — compute from graph relations
  const outgoingCalls = sym ? relations.filter((r) => r.source === sym.id && r.type === "calls") : [];
  const incomingCalls = sym ? relations.filter((r) => r.target === sym.id && r.type === "calls") : [];
  const reads = sym ? relations.filter((r) => r.source === sym.id && r.type === "reads") : [];
  const readBy = sym ? relations.filter((r) => r.target === sym.id && r.type === "reads") : [];
  const writes = sym ? relations.filter((r) => r.source === sym.id && r.type === "writes") : [];
  const writtenBy = sym ? relations.filter((r) => r.target === sym.id && r.type === "writes") : [];
  const importsR = sym ? relations.filter((r) => r.source === sym.id && r.type === "imports") : [];
  const importedByR = sym ? relations.filter((r) => r.target === sym.id && r.type === "imports") : [];
  const inheritsR = sym ? relations.filter((r) => r.source === sym.id && r.type === "inherits") : [];
  const inheritedByR = sym ? relations.filter((r) => r.target === sym.id && r.type === "inherits") : [];
  const instantiatesR = sym ? relations.filter((r) => r.source === sym.id && r.type === "instantiates") : [];
  const instantiatedByR = sym ? relations.filter((r) => r.target === sym.id && r.type === "instantiates") : [];
  const usesConfigR = sym ? relations.filter((r) => r.source === sym.id && r.type === "uses_config") : [];
  const configUsedByR = sym ? relations.filter((r) => r.target === sym.id && r.type === "uses_config") : [];
  const parentSym = sym?.parentId
    ? symbolOverrides.get(sym.parentId) ?? graph?.symbols.find((s) => s.id === sym.parentId) ?? null
    : null;
  const children = sym
    ? graph?.symbols.filter((s) => s.parentId === sym.id) ?? []
    : [];
  const lineCount = sym?.location?.startLine != null && sym.location?.endLine != null
    ? sym.location.endLine - sym.location.startLine + 1
    : null;
  const outgoingCallItems = buildNavigableRelationItems(graph, outgoingCalls, "out");
  const incomingCallItems = buildNavigableRelationItems(graph, incomingCalls, "in");
  const readItems = buildNavigableRelationItems(graph, reads, "out");
  const readByItems = buildNavigableRelationItems(graph, readBy, "in");
  const writeItems = buildNavigableRelationItems(graph, writes, "out");
  const writtenByItems = buildNavigableRelationItems(graph, writtenBy, "in");
  const importItems = buildNavigableRelationItems(graph, importsR, "out");
  const importedByItems = buildNavigableRelationItems(graph, importedByR, "in");
  const inheritItems = buildNavigableRelationItems(graph, inheritsR, "out");
  const inheritedByItems = buildNavigableRelationItems(graph, inheritedByR, "in");
  const instantiateItems = buildNavigableRelationItems(graph, instantiatesR, "out");
  const instantiatedByItems = buildNavigableRelationItems(graph, instantiatedByR, "in");
  const usesConfigItems = buildNavigableRelationItems(graph, usesConfigR, "out");
  const configUsedByItems = buildNavigableRelationItems(graph, configUsedByR, "in");
  const artifactPreview = sym ? buildArtifactPreview(sym) : null;
  const artifactStateKind = artifactPreview?.kind === "cluster" || artifactPreview?.kind === "single"
    ? artifactPreview.kind
    : null;
  const showArtifactState = diagramSettings.generatedArtifactMode !== "individual";
  const artifactStateLabel = !showArtifactState
    ? null
    : artifactStateKind === "cluster"
    ? `Cluster${artifactPreview?.itemCount != null ? ` · ${artifactPreview.itemCount}` : ""}`
    : artifactStateKind === "single"
      ? "Einzelobjekt"
      : null;

  // Build signature
  const sigParams = doc?.inputs?.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ") ?? "";
  const returnType = doc?.outputs?.map((o) => o.type ?? o.name).join(", ") ?? "";

  // Group remaining relations by type (exclude what's shown separately)
  const shownTypes = new Set(["calls", "reads", "writes", "imports", "inherits", "instantiates", "uses_config", "contains"]);
  const otherRelations = relations.filter((r) => !shownTypes.has(r.type));

  const deadCodeReasonText = (() => {
    const explicit = (doc?.deadCodeReason ?? "").trim();
    if (explicit) return explicit;

    const inboundCallCount = incomingCalls.length + instantiatedByR.length;
    const outboundCallCount = outgoingCalls.length + instantiatesR.length;

    if (inboundCallCount === 0 && outboundCallCount === 0) {
      return "Keine eingehenden oder ausgehenden Aufrufbeziehungen gefunden. Das Symbol ist im aktuellen Graphen nicht eingebunden und wurde deshalb als Dead Code markiert.";
    }
    if (inboundCallCount === 0) {
      return "Keine eingehenden Aufrufe/Instanziierungen gefunden. Das Symbol wird aktuell von keinem anderen Symbol verwendet und wurde deshalb als Dead Code markiert.";
    }
    return "Das Symbol trägt das Dead-Code-Tag, aber es liegt keine detaillierte LLM-Begründung vor. Bitte Analyse erneut ausführen, um die genaue Ursache zu aktualisieren.";
  })();
  const codingGuidelines = doc?.codingGuidelines;
  const guidelineScoreClass = codingGuidelines
    ? codingGuidelines.score >= 85
      ? "guideline-score guideline-score--good"
      : codingGuidelines.score >= 65
        ? "guideline-score guideline-score--warn"
        : "guideline-score guideline-score--bad"
    : "guideline-score";

  // Available nodes for connection target (all symbols in graph except current)
  const availableTargets = graph?.symbols.filter((s) => s.id !== sym?.id) ?? [];

  return (
    <div className={`inspector${inspectorAnimClass ? " inspector--ai-animating" : ""}`}>
      <div className="inspector-header-row">
        <h2>Inspector</h2>
        <div className="inspector-header-actions">
          <button
            className={`btn btn-xs inspector-settings-toggle${showDiagramSettings ? " inspector-settings-toggle--active" : ""}`}
            onClick={() => setShowDiagramSettings(true)}
            title="Diagram Settings öffnen"
          >
            <i className="bi bi-sliders" /> Settings
          </button>
          <button
            className={`btn btn-xs inspector-edit-toggle${editMode ? " inspector-edit-toggle--active" : ""}`}
            onClick={() => { setEditMode(!editMode); if (editMode) { setIsEditing(false); setEditingSection(null); setShowAddConn(false); } }}
            title={editMode ? "Bearbeitungsmodus deaktivieren" : "Bearbeitungsmodus aktivieren"}
          >
            <i className={editMode ? "bi bi-pencil-fill" : "bi bi-pencil"} />{editMode ? " Bearbeiten" : " Bearbeiten"}
          </button>
          <button
            className="inspector-header-btn inspector-header-btn--collapse"
            onClick={toggleInspector}
            title="Inspector einklappen"
          >
            <i className="bi bi-layout-sidebar-inset-reverse" />
          </button>
        </div>
      </div>

      {/* ─── Node Header / Edit Toggle ─── */}
      <div className="inspector-card">
        {(!editMode || !isEditing) ? (
          <>
            <h3>
              <span className={`kind-badge kind-${sym.kind}`} style={{ marginRight: 6 }}>
                {sym.kind}
              </span>
              {sym.label}
              {artifactStateLabel && (
                <span className={`artifact-state-pill artifact-state-pill--${artifactStateKind} inspector-artifact-pill`}>
                  <i className={`bi ${artifactStateKind === "cluster" ? "bi-collection" : "bi-file-earmark-text"}`} />
                  {artifactStateLabel}
                </span>
              )}
              {editMode && (
                <button
                  className="btn-icon"
                  title="Edit"
                  onClick={() => setIsEditing(true)}
                  style={{ marginLeft: 8, cursor: "pointer", background: "none", border: "none", color: "var(--accent)", fontSize: 14 }}
                >
                  <i className="bi bi-pencil" />
                </button>
              )}
            </h3>

            {sym.location && (
              <div className="location">
                <i className="bi bi-file-earmark" /> {sym.location.file}
                {sym.location.startLine != null && `:${sym.location.startLine}`}
                {sym.location.endLine != null && `-${sym.location.endLine}`}
                <button
                  className="source-view-btn"
                  onClick={() => openSourceViewer(sym.id, sym.label)}
                  title="Quellcode anzeigen"
                >
                  <i className="bi bi-code-square" /> Code
                </button>
              </div>
            )}

            {/* ─── Tags ─── */}
            <div className="tags">
              {(sym.tags ?? []).map((t) => (
                <span key={t} className={`tag${t === "dead-code" && doc?.aiGenerated?.deadCode ? " ai-tagged" : ""}`}>
                  {t}
                  {t === "dead-code" && doc?.aiGenerated?.deadCode && (
                    <AiBadge field="deadCode" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
                  )}
                  {editMode && (
                    <button
                      className="tag-remove-btn"
                      onClick={() => handleRemoveTag(t)}
                      title={`Tag "${t}" entfernen`}
                    >×</button>
                  )}
                </span>
              ))}
              {editMode && (
                <span className="tag-add-inline">
                  <input
                    className="tag-add-input"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(); }}
                    placeholder="+ Tag"
                  />
                  {newTag.trim() && (
                    <button className="tag-add-btn" onClick={handleAddTag} title="Tag hinzufügen">+</button>
                  )}
                </span>
              )}
            </div>

            {/* ─── Dead Code Reason ─── */}
            {sym.tags?.includes("dead-code") && (
              <div className="dead-code-reason">
                <div className="dead-code-reason-header">
                  <span className="dead-code-reason-icon"><i className="bi bi-x-circle" /></span>
                  <span>Dead Code — Begründung</span>
                </div>
                <p className="dead-code-reason-text">{deadCodeReasonText}</p>
                {sym.location && (
                  <div className="dead-code-source-ref">
                    <i className="bi bi-file-earmark" /> {sym.location.file}
                    {sym.location.startLine != null && `:${sym.location.startLine}`}
                    {sym.location.endLine != null && `-${sym.location.endLine}`}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* ─── Inline Edit Form ─── */
          <div className="node-edit-form">
            <div className="field-label">Name</div>
            <input
              className="inspector-input"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
            />

            <div className="field-label" style={{ marginTop: 8 }}>Kind</div>
            <select
              className="inspector-select"
              value={editKind}
              onChange={(e) => setEditKind(e.target.value)}
            >
              {SYMBOL_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>

            <div className="field-label" style={{ marginTop: 8 }}>Summary</div>
            <textarea
              className="inspector-textarea"
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              rows={3}
            />

            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <button className="btn btn-sm btn-primary" onClick={handleSaveEdit}>
                <i className="bi bi-floppy" /> Save
              </button>
              <button className="btn btn-sm" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedSequenceParticipant && (
        <SequenceParticipantSections
          participant={selectedSequenceParticipant}
          projection={sequenceDetails?.projection ?? null}
          onSymbolClick={handleSymbolLinkClick}
        />
      )}

      {/* ─── Summary (read-only when not editing) ─── */}
      {!isEditing && doc?.summary && (
        <div className={`inspector-card${doc.aiGenerated?.summary ? ` ai-generated-card ${inspectorAnimClass}` : ""}`}>
          <div className="field-label">
            Beschreibung
            {doc.aiGenerated?.summary && (
              <AiBadge field="summary" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
          </div>
          <div className="summary">{doc.summary}</div>
        </div>
      )}

      {artifactPreview && (
        <ArtifactPreviewInspectorSection
          preview={artifactPreview}
          symbolId={sym.id}
          graph={graph}
          showState={showArtifactState}
          onSymbolClick={handleSymbolLinkClick}
        />
      )}

      {/* ─── Signature (for functions/methods) ─── */}
      {!isEditing && (sym.kind === "function" || sym.kind === "method") && (doc?.inputs?.length || doc?.outputs?.length) && (
        <div className="inspector-card">
          <div className="field-label">Signatur</div>
          <div className="inspector-signature">
            <span style={{ color: "#c9a0ff" }}>def</span>{" "}
            <span style={{ color: "#80e0a0" }}>{sym.label.split(".").pop()}</span>
            <span style={{ color: "var(--text-dim)" }}>(</span>
            <span>{sigParams || "…"}</span>
            <span style={{ color: "var(--text-dim)" }}>)</span>
            {returnType && (
              <span style={{ color: "var(--accent)" }}> → {returnType}</span>
            )}
          </div>
        </div>
      )}

      {/* ─── Parent module / class ─── */}
      {parentSym && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-box" /> Übergeordnet</div>
          <SymbolLink
            symbolId={parentSym.id}
            label={parentSym.label}
            onClick={() => handleSymbolLinkClick(parentSym.id)}
          />
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}> ({parentSym.kind})</span>
        </div>
      )}

      {/* ─── Line count ─── */}
      {lineCount != null && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-rulers" /> Umfang</div>
          <span>{lineCount} Zeilen</span>
        </div>
      )}

      {/* ─── Coding Guidelines ─── */}
      {codingGuidelines && (
        <div className="inspector-card">
          <div className="field-label"><i className="bi bi-shield-check" /> Coding Guidelines</div>
          <div className={guidelineScoreClass}>
            Score: <strong>{codingGuidelines.score}/100</strong>
          </div>
          <div className="guideline-grid">
            <span>Naming</span>
            <span>
              {codingGuidelines.naming.detected}
              {codingGuidelines.naming.expected !== "unknown" && (
                <> (expected: {codingGuidelines.naming.expected})</>
              )}
            </span>
            <span>Line length</span>
            <span>{codingGuidelines.readability.longLineCount} over {120} chars</span>
            <span>Nesting</span>
            <span>max depth {codingGuidelines.complexity.maxNestingDepth}</span>
            <span>Comments</span>
            <span>{Math.round(codingGuidelines.readability.commentRatio * 100)}%</span>
          </div>
          {codingGuidelines.recommendations.length > 0 && (
            <ul className="guideline-recommendations">
              {codingGuidelines.recommendations.map((item, idx) => (
                <li key={`${idx}-${item}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── Parameters (inputs) ─── */}
      {(editingSection === "inputs" || (doc?.inputs && doc.inputs.length > 0)) && (
        <div className={`inspector-card${doc?.aiGenerated?.inputs ? ` ai-generated-card ${inspectorAnimClass}` : ""}`}>
          <div className="field-label">
            <i className="bi bi-arrow-down" /> Parameter
            {doc?.aiGenerated?.inputs && (
              <AiBadge field="inputs" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
            {editMode && editingSection !== "inputs" && (
              <button className="section-edit-btn" onClick={handleStartEditInputs} title="Parameter bearbeiten"><i className="bi bi-pencil" /></button>
            )}
          </div>
          {editingSection === "inputs" ? (
            <div className="section-edit-form">
              {editInputs.map((inp, i) => (
                <div key={i} className="param-edit-row">
                  <input className="param-edit-input param-edit-name" value={inp.name} onChange={(e) => handleInputChange(i, "name", e.target.value)} placeholder="Name" />
                  <input className="param-edit-input param-edit-type" value={inp.type} onChange={(e) => handleInputChange(i, "type", e.target.value)} placeholder="Typ" />
                  <input className="param-edit-input param-edit-desc" value={inp.description} onChange={(e) => handleInputChange(i, "description", e.target.value)} placeholder="Beschreibung" />
                  <button className="param-remove-btn" onClick={() => handleRemoveInput(i)} title="Entfernen">×</button>
                </div>
              ))}
              <div className="section-edit-actions">
                <button className="btn btn-xs" onClick={handleAddInput}>+ Parameter</button>
                <button className="btn btn-xs btn-primary" onClick={handleSaveInputs}><i className="bi bi-floppy" /> Speichern</button>
                <button className="btn btn-xs" onClick={() => setEditingSection(null)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <table className="inspector-param-table">
              <tbody>
                {doc!.inputs!.map((inp, i) => (
                  <tr key={i}>
                    <td className="param-name-cell">{inp.name}</td>
                    <td className="param-type-cell">{inp.type ?? "—"}</td>
                    <td className="param-desc-cell">{inp.description ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* Add Parameters when none exist */}
      {editMode && !doc?.inputs?.length && editingSection !== "inputs" && (
        <div className="inspector-card">
          <button className="btn btn-xs" onClick={handleStartEditInputs}>+ Parameter hinzufügen</button>
        </div>
      )}

      {/* ─── Outputs ─── */}
      {(editingSection === "outputs" || (doc?.outputs && doc.outputs.length > 0)) && (
        <div className={`inspector-card${doc?.aiGenerated?.outputs ? ` ai-generated-card ${inspectorAnimClass}` : ""}`}>
          <div className="field-label">
            <i className="bi bi-arrow-up" /> Rückgabe
            {doc?.aiGenerated?.outputs && (
              <AiBadge field="outputs" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
            {editMode && editingSection !== "outputs" && (
              <button className="section-edit-btn" onClick={handleStartEditOutputs} title="Rückgabe bearbeiten"><i className="bi bi-pencil" /></button>
            )}
          </div>
          {editingSection === "outputs" ? (
            <div className="section-edit-form">
              {editOutputs.map((out, i) => (
                <div key={i} className="param-edit-row">
                  <input className="param-edit-input param-edit-name" value={out.name} onChange={(e) => handleOutputChange(i, "name", e.target.value)} placeholder="Name" />
                  <input className="param-edit-input param-edit-type" value={out.type} onChange={(e) => handleOutputChange(i, "type", e.target.value)} placeholder="Typ" />
                  <input className="param-edit-input param-edit-desc" value={out.description} onChange={(e) => handleOutputChange(i, "description", e.target.value)} placeholder="Beschreibung" />
                  <button className="param-remove-btn" onClick={() => handleRemoveOutput(i)} title="Entfernen">×</button>
                </div>
              ))}
              <div className="section-edit-actions">
                <button className="btn btn-xs" onClick={handleAddOutput}>+ Rückgabe</button>
                <button className="btn btn-xs btn-primary" onClick={handleSaveOutputs}><i className="bi bi-floppy" /> Speichern</button>
                <button className="btn btn-xs" onClick={() => setEditingSection(null)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <table className="inspector-param-table">
              <tbody>
                {doc!.outputs!.map((out, i) => (
                  <tr key={i}>
                    <td className="param-name-cell">{out.name}</td>
                    <td className="param-type-cell">{out.type ?? "—"}</td>
                    <td className="param-desc-cell">{out.description ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* Add Outputs when none exist */}
      {editMode && !doc?.outputs?.length && editingSection !== "outputs" && (
        <div className="inspector-card">
          <button className="btn btn-xs" onClick={handleStartEditOutputs}>+ Rückgabe hinzufügen</button>
        </div>
      )}

      {/* ─── Side Effects ─── */}
      {(editingSection === "sideEffects" || (doc?.sideEffects && doc.sideEffects.length > 0)) && (
        <div className={`inspector-card${doc?.aiGenerated?.sideEffects ? ` ai-generated-card ${inspectorAnimClass}` : ""}`}>
          <div className="field-label">
            <i className="bi bi-exclamation-triangle" /> Seiteneffekte
            {doc?.aiGenerated?.sideEffects && (
              <AiBadge field="sideEffects" symbolId={sym.id} onConfirm={confirmAiField} onReject={rejectAiField} />
            )}
            {editMode && editingSection !== "sideEffects" && (
              <button className="section-edit-btn" onClick={handleStartEditSideEffects} title="Seiteneffekte bearbeiten"><i className="bi bi-pencil" /></button>
            )}
          </div>
          {editingSection === "sideEffects" ? (
            <div className="section-edit-form">
              {editSideEffects.map((se, i) => (
                <div key={i} className="side-effect-edit-row">
                  <input className="inspector-input" value={se} onChange={(e) => handleSideEffectChange(i, e.target.value)} />
                  <button className="param-remove-btn" onClick={() => handleRemoveSideEffect(i)} title="Entfernen">×</button>
                </div>
              ))}
              <div className="side-effect-add-row">
                <input
                  className="inspector-input"
                  value={newSideEffect}
                  onChange={(e) => setNewSideEffect(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSideEffect(); }}
                  placeholder="Neuer Seiteneffekt"
                />
                <button className="btn btn-xs" onClick={handleAddSideEffect} disabled={!newSideEffect.trim()}>+</button>
              </div>
              <div className="section-edit-actions">
                <button className="btn btn-xs btn-primary" onClick={handleSaveSideEffects}><i className="bi bi-floppy" /> Speichern</button>
                <button className="btn btn-xs" onClick={() => setEditingSection(null)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <ul>
              {doc!.sideEffects!.map((se, i) => (
                <li key={i}><i className="bi bi-exclamation-triangle" /> {se}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* Add SideEffects when none exist */}
      {editMode && !doc?.sideEffects?.length && editingSection !== "sideEffects" && (
        <div className="inspector-card">
          <button className="btn btn-xs" onClick={handleStartEditSideEffects}>+ Seiteneffekt hinzufügen</button>
        </div>
      )}

      {/* ─── Calls (outgoing) ─── */}
      {outgoingCallItems.length > 0 && (
        <CollapsibleSection title="Ruft auf" icon="bi-telephone-outbound" count={outgoingCallItems.length} badge="out:calls">
          <RelationItemList
            items={outgoingCallItems}
            graph={graph}
            showKind
            showConfidence
            chipClassName={chipClassNameForBadge("out:calls")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Called by (incoming) ─── */}
      {incomingCallItems.length > 0 && (
        <CollapsibleSection title="Aufgerufen von" icon="bi-telephone-inbound" count={incomingCallItems.length} badge="in:calls">
          <RelationItemList
            items={incomingCallItems}
            graph={graph}
            showKind
            chipClassName={chipClassNameForBadge("in:calls")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Reads ─── */}
      {readItems.length > 0 && (
        <CollapsibleSection title="Liest" icon="bi-book" count={readItems.length} badge="out:reads">
          <RelationItemList
            items={readItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("out:reads")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Read by ─── */}
      {readByItems.length > 0 && (
        <CollapsibleSection title="Gelesen von" icon="bi-book" count={readByItems.length} badge="in:reads">
          <RelationItemList
            items={readByItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("in:reads")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Writes ─── */}
      {writeItems.length > 0 && (
        <CollapsibleSection title="Schreibt" icon="bi-pencil-square" count={writeItems.length} badge="out:writes">
          <RelationItemList
            items={writeItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("out:writes")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Written by ─── */}
      {writtenByItems.length > 0 && (
        <CollapsibleSection title="Geschrieben von" icon="bi-pencil-square" count={writtenByItems.length} badge="in:writes">
          <RelationItemList
            items={writtenByItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("in:writes")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Imports ─── */}
      {importItems.length > 0 && (
        <CollapsibleSection title="Importiert" icon="bi-box-arrow-in-down" count={importItems.length} badge="out:imports" defaultOpen={false}>
          <RelationItemList
            items={importItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("out:imports")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Imported by ─── */}
      {importedByItems.length > 0 && (
        <CollapsibleSection title="Importiert von" icon="bi-box-arrow-up" count={importedByItems.length} badge="in:imports" defaultOpen={false}>
          <RelationItemList
            items={importedByItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("in:imports")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Inherits ─── */}
      {inheritItems.length > 0 && (
        <CollapsibleSection title="Erbt von" icon="bi-diagram-3" count={inheritItems.length} badge="out:inherits">
          <RelationItemList
            items={inheritItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("out:inherits")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Inherited by ─── */}
      {inheritedByItems.length > 0 && (
        <CollapsibleSection title="Vererbt an" icon="bi-diagram-3" count={inheritedByItems.length} badge="in:inherits">
          <RelationItemList
            items={inheritedByItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("in:inherits")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Instantiates ─── */}
      {instantiateItems.length > 0 && (
        <CollapsibleSection title="Instanziiert" icon="bi-lightning" count={instantiateItems.length} badge="out:instantiates">
          <RelationItemList
            items={instantiateItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("out:instantiates")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Instantiated by ─── */}
      {instantiatedByItems.length > 0 && (
        <CollapsibleSection title="Instanziiert von" icon="bi-lightning" count={instantiatedByItems.length} badge="in:instantiates">
          <RelationItemList
            items={instantiatedByItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("in:instantiates")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Uses Config ─── */}
      {usesConfigItems.length > 0 && (
        <CollapsibleSection title="Konfiguration" icon="bi-gear" count={usesConfigItems.length} badge="out:uses_config">
          <RelationItemList
            items={usesConfigItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("out:uses_config")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Config used by ─── */}
      {configUsedByItems.length > 0 && (
        <CollapsibleSection title="Konfig. verwendet von" icon="bi-gear" count={configUsedByItems.length} badge="in:uses_config">
          <RelationItemList
            items={configUsedByItems}
            graph={graph}
            chipClassName={chipClassNameForBadge("in:uses_config")}
            onSymbolClick={handleSymbolLinkClick}
            onConfirmAi={confirmAiRelation}
            onRejectAi={(id) => removeRelation(id)}
          />
        </CollapsibleSection>
      )}

      {/* ─── Other relations ─── */}
      {otherRelations.length > 0 && (
        <CollapsibleSection title="Weitere Relationen" count={otherRelations.length}>
          <ul>
            {otherRelations.map((r) => {
              const isOut = r.source === sym.id;
              const rawOtherId = isOut ? r.target : r.source;
              const otherId = graph ? (resolveNavigableSymbolId(graph, rawOtherId) ?? rawOtherId) : rawOtherId;
              const other = graph?.symbols.find((s) => s.id === otherId);
              return (
                <li key={r.id} className={r.aiGenerated ? "ai-generated-item" : ""}>
                  <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 4 }}>
                    {isOut ? <i className="bi bi-arrow-right" /> : <i className="bi bi-arrow-left" />} {r.type}
                  </span>
                  <SymbolLink symbolId={otherId} label={other?.label ?? otherId} onClick={() => handleSymbolLinkClick(otherId)} />
                  {r.aiGenerated && (
                    <AiRelationBadge relationIds={[r.id]} onConfirm={confirmAiRelation} onReject={(id) => removeRelation(id)} />
                  )}
                </li>
              );
            })}
          </ul>
        </CollapsibleSection>
      )}

      {/* ─── Children ─── */}
      {children.length > 0 && (
        <CollapsibleSection title="Enthält" icon="bi-folder" count={children.length}>
          <ul>
            {children.slice(0, 20).map((child) => (
              <li key={child.id}>
                <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 4 }}>{child.kind}</span>
                <SymbolLink symbolId={child.id} label={child.label.split(".").pop() ?? child.label} onClick={() => handleSymbolLinkClick(child.id)} />
                {child.doc?.summary && (
                  <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                    — {child.doc.summary.slice(0, 50)}{child.doc.summary.length > 50 ? "…" : ""}
                  </span>
                )}
              </li>
            ))}
            {children.length > 20 && (
              <li style={{ color: "var(--text-dim)" }}>+{children.length - 20} weitere…</li>
            )}
          </ul>
        </CollapsibleSection>
      )}

      {doc?.links && doc.links.length > 0 && (
        <CollapsibleSection title="Links" icon="bi-link-45deg" count={doc.links.length}>
          <ul>
            {doc.links.map((lnk, i) => (
              <li key={i}>
                <SymbolLink symbolId={lnk.symbolId} label={lnk.label} onClick={() => handleSymbolLinkClick(lnk.symbolId)} />
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* ─── Add Connection ─── */}
      {editMode && (
        <div className="inspector-card">
          {!showAddConn ? (
            <button className="btn btn-sm" onClick={() => setShowAddConn(true)}>
              <i className="bi bi-plus-circle" /> Add Connection
            </button>
          ) : (
            <div className="add-connection-form">
              <div className="field-label">Target Node</div>
              <select
                className="inspector-select"
                value={connTarget}
                onChange={(e) => setConnTarget(e.target.value)}
              >
                <option value="">-- Select target --</option>
                {availableTargets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({s.kind})
                  </option>
                ))}
              </select>

              <div className="field-label" style={{ marginTop: 6 }}>Type</div>
              <select
                className="inspector-select"
                value={connType}
                onChange={(e) => { setConnType(e.target.value); setConnLabel(e.target.value); }}
              >
                {RELATION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <div className="field-label" style={{ marginTop: 6 }}>Label</div>
              <input
                className="inspector-input"
                value={connLabel}
                onChange={(e) => setConnLabel(e.target.value)}
                placeholder="Edge label"
              />

              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleAddConnection}
                  disabled={!connTarget}
                >
                  <i className="bi bi-check-circle" /> Add
                </button>
                <button className="btn btn-sm" onClick={() => setShowAddConn(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Actions ─── */}
      <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={handleAiGenerate} disabled={aiLoading}>
          {aiLoading ? "Generating…" : <><i className="bi bi-cpu" /> Generate AI Docs</>}
        </button>
        {editMode && (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => { removeSymbol(sym.id); selectSymbol(null); }}
          >
            <i className="bi bi-trash" /> Delete Node
          </button>
        )}
      </div>
      {aiError && (
        <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{aiError}</div>
      )}
      {settingsOverlay}
    </div>
  );
}
