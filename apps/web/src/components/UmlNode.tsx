import { memo, useCallback, useRef, useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAppStore } from "../store";
import { scheduleShowHover, scheduleHideHover } from "./hoverCardController";
import type { Symbol as Sym, SymbolUmlType } from "@dmpg/shared";
import type { DiagramLabelMode } from "../diagramSettings";
import type { PortInfo } from "../layout";

export interface UmlNodeData {
  label: string;
  kind: string;
  summary?: string;
  symbolId: string;
  childViewId?: string;
  inputs?: Array<{ name: string; type?: string; description?: string }>;
  outputs?: Array<{ name: string; type?: string; description?: string }>;
  children?: Sym[];
  tags?: string[];
  relationBadges?: string[];
  compactMode?: boolean;
  labelsMode?: DiagramLabelMode;
  umlType?: SymbolUmlType;
  location?: { file: string; startLine?: number; endLine?: number };
  artifactPreviewKind?: "cluster" | "single" | "plain";
  artifactPreviewItemCount?: number | null;
  artifactPreviewGroupCount?: number | null;
  /** Dynamic port handles computed by ELK layout */
  dynamicPorts?: PortInfo[];
  [key: string]: unknown;
}

/* ── Relation badge icons & labels ──────────────── */

/** Badge metadata: keyed by "out:<type>" or "in:<type>" */
const REL_BADGE_META: Record<string, { iconCls: string; label: string; cls: string }> = {
  "out:calls":       { iconCls: "bi-telephone-outbound", label: "ruft auf",         cls: "calls" },
  "in:calls":        { iconCls: "bi-telephone-inbound",  label: "aufgerufen von",   cls: "calls-in" },
  "out:reads":       { iconCls: "bi-book",               label: "liest",            cls: "reads" },
  "in:reads":        { iconCls: "bi-book",               label: "gelesen von",      cls: "reads-in" },
  "out:writes":      { iconCls: "bi-pencil-square",      label: "schreibt",         cls: "writes" },
  "in:writes":       { iconCls: "bi-pencil-square",      label: "geschrieben von",  cls: "writes-in" },
  "out:imports":     { iconCls: "bi-box-arrow-in-down",  label: "importiert",       cls: "imports" },
  "in:imports":      { iconCls: "bi-box-arrow-in-down",  label: "importiert von",   cls: "imports-in" },
  "out:inherits":    { iconCls: "bi-diagram-3",          label: "erbt von",         cls: "inherits" },
  "in:inherits":     { iconCls: "bi-diagram-3",          label: "vererbt an",       cls: "inherits-in" },
  "out:instantiates":{ iconCls: "bi-lightning",          label: "erstellt",         cls: "instantiates" },
  "in:instantiates": { iconCls: "bi-lightning",          label: "erstellt von",     cls: "instantiates-in" },
  "out:uses_config": { iconCls: "bi-gear",               label: "konfiguriert",     cls: "uses_config" },
  "in:uses_config":  { iconCls: "bi-gear",               label: "konfiguriert von", cls: "uses_config-in" },
};

function RelationBadges({
  badges,
  compactMode = false,
  labelsMode = "detailed",
}: {
  badges?: string[];
  compactMode?: boolean;
  labelsMode?: DiagramLabelMode;
}) {
  if (!badges || badges.length === 0 || labelsMode === "off") return null;
  const showText = labelsMode === "detailed" && !compactMode;
  return (
    <div className="rel-badges">
      {badges.map((t) => {
        const meta = REL_BADGE_META[t];
        if (!meta) return null;
        const isIn = t.startsWith("in:");
        return (
          <span key={t} className={`rel-badge rel-badge--${meta.cls}`}>
            {isIn && <i className="bi bi-arrow-left" style={{ fontSize: 9, marginRight: 2 }} />}
            <i className={`bi ${meta.iconCls}`} />
            {showText && <> {meta.label}</>}
          </span>
        );
      })}
    </div>
  );
}

/* ── Shared hooks ─────────────────────────────── */

/** Extracts just the filename from a path (e.g. "data_pipeline/util/util.py" → "util.py") */
function shortFileName(loc?: { file: string; startLine?: number; endLine?: number }): string | null {
  if (!loc?.file) return null;
  const parts = loc.file.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1];
  return loc.startLine != null ? `${name}:${loc.startLine}` : name;
}

/**
 * Detects when node content changes (label, inputs, outputs, summary) and
 * returns CSS classes to drive the AI-update shimmer animation.
 * Returns "" when there's no active change, "ai-content-updated" during animation.
 */
function useAiChangeDetection(d: UmlNodeData) {
  const [animClass, setAnimClass] = useState("");
  const animationSymbolId = useAppStore((s) => s.aiAnalysis?.animationSymbolId ?? null);
  const animationSeq = useAppStore((s) => s.aiAnalysis?.animationSeq ?? 0);
  const lastAppliedSeqRef = useRef(0);

  useEffect(() => {
    if (animationSeq === 0 || animationSeq === lastAppliedSeqRef.current) return;
    lastAppliedSeqRef.current = animationSeq;
    if (animationSymbolId !== d.symbolId) return;

    setAnimClass("ai-content-updated");
    const timer = setTimeout(() => setAnimClass(""), 2000);
    return () => clearTimeout(timer);
  }, [animationSeq, animationSymbolId, d.symbolId]);

  return animClass;
}

function useNodeActions(data: UmlNodeData) {
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const navigateToView = useAppStore((s) => s.navigateToView);

  const handleClick = useCallback(() => {
    selectSymbol(data.symbolId);
  }, [selectSymbol, data.symbolId]);

  const handleDrilldown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.childViewId) navigateToView(data.childViewId);
    },
    [navigateToView, data.childViewId],
  );

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      // Do not open hover UI while any mouse button is held (drag/selection gesture).
      if (e.buttons !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      scheduleShowHover(data.symbolId, rect);
    },
    [data.symbolId],
  );

  const handleMouseLeave = useCallback(() => {
    scheduleHideHover();
  }, []);

  return { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave };
}

/* ── Dynamic port handles from ELK layout ─────── */

function portSideToPosition(side: string): Position {
  switch (side) {
    case "NORTH": return Position.Top;
    case "SOUTH": return Position.Bottom;
    case "EAST": return Position.Right;
    case "WEST": return Position.Left;
    default: return Position.Bottom;
  }
}

function DynamicPorts({ ports }: { ports?: PortInfo[] }) {
  if (!ports || ports.length === 0) return null;
  return (
    <>
      {ports.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type={port.type}
          position={portSideToPosition(port.side)}
          className="dynamic-port-handle"
          style={{
            ...(port.side === "EAST" || port.side === "WEST"
              ? { top: port.y }
              : { left: port.x }),
          }}
        />
      ))}
    </>
  );
}

function renderKindBadge(kind: string, umlType?: SymbolUmlType) {
  if (umlType === "package") return "package";
  if (umlType) return umlType;
  return kind;
}

function resolveArtifactMeta(umlType: SymbolUmlType | undefined, label: string) {
  switch (umlType) {
    case "database":
      return { iconCls: "bi-database", stereotype: "database" };
    case "component":
      return { iconCls: "bi-cpu", stereotype: "component" };
    case "note":
      return { iconCls: "bi-journal-text", stereotype: "note" };
    case "artifact":
      return { iconCls: "bi-file-earmark-code", stereotype: "artifact" };
    case "package":
      return { iconCls: "bi-box", stereotype: "package" };
    default:
      break;
  }

  const normalized = label.toLowerCase();
  if (normalized.includes(".csv") || normalized.includes(".xlsx") || normalized.includes(".xls")) {
    return { iconCls: "bi-file-earmark-spreadsheet", stereotype: "artifact" };
  }
  if (normalized.includes(".json")) {
    return { iconCls: "bi-filetype-json", stereotype: "artifact" };
  }
  if (normalized.includes(".pkl") || normalized.includes(".pickle")) {
    return { iconCls: "bi-archive", stereotype: "artifact" };
  }
  if (normalized.includes("db") || normalized.includes("sql") || normalized.includes("database")) {
    return { iconCls: "bi-database", stereotype: "database" };
  }
  if (normalized.includes("http") || normalized.includes("api")) {
    return { iconCls: "bi-globe", stereotype: "component" };
  }
  return { iconCls: "bi-file-earmark", stereotype: "artifact" };
}

/* ── Default UML Node (fallback) ──────────────── */

export const UmlNode = memo(function UmlNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);
  const isDead = d.tags?.includes("dead-code");
  const animClass = useAiChangeDetection(d);
  const fileName = shortFileName(d.location);
  const compactMode = !!d.compactMode;
  const labelsMode = d.labelsMode ?? "detailed";

  return (
    <div
      className={`uml-node kind-${d.kind} ${d.umlType ? `uml-type-${d.umlType}` : ""} ${compactMode ? "node-compact" : ""} ${isDead ? "dead-code" : ""} ${selected ? "selected" : ""} ${animClass}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} id="in-top" />
      <Handle type="target" position={Position.Left} id="in-left" className="handle-alt" />
      <div className="node-header">
        <span className="kind-badge">{renderKindBadge(d.kind, d.umlType)}</span>
        <span className="node-label">{d.label}</span>
        {isDead && <span className="dead-code-badge" title="Unused — no callers"><i className="bi bi-x-circle" /></span>}
      </div>
      {!compactMode && fileName && <div className="node-file-location" title={d.location?.file}><i className="bi bi-file-earmark" /> {fileName}</div>}
      <RelationBadges badges={d.relationBadges} compactMode={compactMode} labelsMode={labelsMode} />
      {d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          <i className="bi bi-caret-right-fill" /> Drill down
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="out-bottom" />
      <Handle type="source" position={Position.Right} id="out-right" className="handle-alt" />
      <DynamicPorts ports={d.dynamicPorts} />
    </div>
  );
});

/* ── UML Group Node (groups & modules in overview) ─ */

export const UmlGroupNode = memo(function UmlGroupNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);
  const animClass = useAiChangeDetection(d);
  const fileName = shortFileName(d.location);
  const compactMode = !!d.compactMode;
  const labelsMode = d.labelsMode ?? "detailed";

  const children = d.children ?? [];
  const classes = children.filter((c) => c.kind === "class");
  const funcs = children.filter((c) => c.kind === "function" || c.kind === "method");
  const others = children.filter((c) => c.kind !== "class" && c.kind !== "function" && c.kind !== "method");

  const countParts: string[] = [];
  if (classes.length > 0) countParts.push(`${classes.length} class${classes.length > 1 ? "es" : ""}`);
  if (funcs.length > 0) countParts.push(`${funcs.length} fn`);
  if (others.length > 0) countParts.push(`${others.length} other`);

  return (
    <div
      className={`uml-node kind-${d.kind} ${d.umlType ? `uml-type-${d.umlType}` : ""} group-node ${compactMode ? "node-compact" : ""} ${selected ? "selected" : ""} ${animClass}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} id="in-top" />
      <Handle type="target" position={Position.Left} id="in-left" className="handle-alt" />
      <div className="node-header">
        <span className="kind-badge">{renderKindBadge(d.kind, d.umlType)}</span>
        <div className="group-node__title">
          {d.umlType === "package" && <div className="stereotype">«package»</div>}
          <span className="node-label">{d.label}</span>
        </div>
      </div>
      {!compactMode && fileName && <div className="node-file-location" title={d.location?.file}><i className="bi bi-file-earmark" /> {fileName}</div>}
      <RelationBadges badges={d.relationBadges} compactMode={compactMode} labelsMode={labelsMode} />
      {countParts.length > 0 && (
        <div className="node-count-badge">{countParts.join(", ")}</div>
      )}
      {d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          <i className="bi bi-caret-right-fill" /> Drill down
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="out-bottom" />
      <Handle type="source" position={Position.Right} id="out-right" className="handle-alt" />
      <DynamicPorts ports={d.dynamicPorts} />
    </div>
  );
});

/* ── UML Class Node with compartments ─────────── */

export const UmlClassNode = memo(function UmlClassNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);
  const animClass = useAiChangeDetection(d);
  const fileName = shortFileName(d.location);
  const compactMode = !!d.compactMode;

  const children = d.children ?? [];
  const attributes = children.filter((c) => c.kind === "constant" || c.kind === "variable");
  const methods = children.filter((c) => c.kind === "method" || c.kind === "function");
  const shownAttributes = compactMode ? attributes.slice(0, 4) : attributes;
  const shownMethods = compactMode ? methods.slice(0, 5) : methods;

  return (
    <div
      className={`uml-node uml-class-node kind-class ${compactMode ? "node-compact" : ""} ${selected ? "selected" : ""} ${animClass}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} id="in-top" />
      <Handle type="target" position={Position.Left} id="in-left" style={{ top: "30%" }} />

      {/* Stereotype + Name */}
      <div className="node-header class-header">
        <div className="stereotype">«class»</div>
        <span className="node-label">{d.label}</span>
        {!compactMode && fileName && <div className="node-file-location" title={d.location?.file}><i className="bi bi-file-earmark" /> {fileName}</div>}
      </div>

      {/* Attributes compartment */}
      <div className="compartment">
        {shownAttributes.length > 0 ? (
          shownAttributes.map((a) => (
            <div key={a.id} className="compartment-item">
              <span className="attr-icon">−</span> {a.label}
              {!compactMode && a.doc?.inputs?.[0]?.type && (
                <span className="type-hint"> : {a.doc.inputs[0].type}</span>
              )}
            </div>
          ))
        ) : (
          <div className="compartment-empty">—</div>
        )}
      </div>

      {/* Methods compartment */}
      <div className="compartment">
        {shownMethods.length > 0 ? (
          shownMethods.map((m) => (
            <div key={m.id} className="compartment-item method-item">
              <span className="method-icon">+</span> {m.label.split(".").pop()}()
              {!compactMode && m.doc?.inputs && m.doc.inputs.length > 0 && (
                <span className="type-hint">
                  ({m.doc.inputs.map((p) => p.name).join(", ")})
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="compartment-empty">—</div>
        )}
      </div>

      {d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          <i className="bi bi-caret-right-fill" /> Methods detail
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="out-bottom" />
      <Handle type="source" position={Position.Right} id="out-right" style={{ top: "70%" }} />
      <DynamicPorts ports={d.dynamicPorts} />
    </div>
  );
});

/* ── UML Function/Method Node ─────────────────── */

export const UmlFunctionNode = memo(function UmlFunctionNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);
  const isDead = d.tags?.includes("dead-code");
  const animClass = useAiChangeDetection(d);
  const fileName = shortFileName(d.location);
  const compactMode = !!d.compactMode;
  const labelsMode = d.labelsMode ?? "detailed";

  const inputs = d.inputs ?? [];
  const outputs = d.outputs ?? [];

  return (
    <div
      className={`uml-node uml-function-node kind-${d.kind} ${compactMode ? "node-compact" : ""} ${isDead ? "dead-code" : ""} ${selected ? "selected" : ""} ${animClass}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} id="in-top" />
      <Handle type="target" position={Position.Left} id="in-left" className="handle-alt" />

      <div className="node-header">
        <span className="kind-badge">{d.kind === "method" ? "method" : "fn"}</span>
        <span className="node-label">{d.label.split(".").pop()}</span>
        {isDead && <span className="dead-code-badge" title="Unused — no callers"><i className="bi bi-x-circle" /></span>}
      </div>

      {!compactMode && fileName && <div className="node-file-location" title={d.location?.file}><i className="bi bi-file-earmark" /> {fileName}</div>}

      {/* Signature */}
      {!compactMode && inputs.length > 0 && (
        <div className="fn-signature">
          ({inputs.map((p, i) => (
            <span key={i}>
              <span className="param-name">{p.name}</span>
              {p.type && <span className="type-hint">: {p.type}</span>}
              {i < inputs.length - 1 && ", "}
            </span>
          ))})
        </div>
      )}

      {!compactMode && outputs.length > 0 && (
        <div className="fn-return">
          <i className="bi bi-arrow-return-right" /> {outputs.map((o) => o.type ?? o.name).join(", ")}
        </div>
      )}

      <RelationBadges badges={d.relationBadges} compactMode={compactMode} labelsMode={labelsMode} />

      {d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          <i className="bi bi-caret-right-fill" /> Detail
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="out-bottom" />
      <Handle type="source" position={Position.Right} id="out-right" className="handle-alt" />
      <DynamicPorts ports={d.dynamicPorts} />
    </div>
  );
});

/* ── UML Artifact/External Node ───────────────── */

export const UmlArtifactNode = memo(function UmlArtifactNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleMouseEnter, handleMouseLeave } = useNodeActions(d);
  const compactMode = !!d.compactMode;
  const labelsMode = d.labelsMode ?? "detailed";
  const artifactMeta = resolveArtifactMeta(d.umlType, d.label);
  const artifactPreviewKind = d.artifactPreviewKind === "cluster" || d.artifactPreviewKind === "single"
    ? d.artifactPreviewKind
    : null;
  const artifactPreviewCount = typeof d.artifactPreviewItemCount === "number" ? d.artifactPreviewItemCount : null;
  const artifactStateLabel = artifactPreviewKind === "cluster"
    ? `Cluster${artifactPreviewCount != null ? ` · ${artifactPreviewCount}` : ""}`
    : artifactPreviewKind === "single"
      ? "Einzelobjekt"
      : null;

  return (
    <div
      className={`uml-node uml-artifact-node kind-external ${d.umlType ? `uml-type-${d.umlType}` : ""} ${artifactPreviewKind ? `uml-artifact-node--${artifactPreviewKind}` : ""} ${compactMode ? "node-compact" : ""} ${selected ? "selected" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} id="in-top" />
      <Handle type="target" position={Position.Left} id="in-left" className="handle-alt" />

      <div className="node-header artifact-header">
        <span className="artifact-icon"><i className={`bi ${artifactMeta.iconCls}`} /></span>
        <div className="artifact-header__title">
          <div className="stereotype">«{artifactMeta.stereotype}»</div>
          <span className="node-label">{d.label}</span>
        </div>
      </div>

      {artifactStateLabel && (
        <div className="artifact-state-row">
          <span className={`artifact-state-badge artifact-state-badge--${artifactPreviewKind}`}>
            <i className={`bi ${artifactPreviewKind === "cluster" ? "bi-collection" : "bi-file-earmark-text"}`} />
            {artifactStateLabel}
          </span>
        </div>
      )}

      <RelationBadges badges={d.relationBadges} compactMode={compactMode} labelsMode={labelsMode} />
      <Handle type="source" position={Position.Bottom} id="out-bottom" />
      <Handle type="source" position={Position.Right} id="out-right" className="handle-alt" />
      <DynamicPorts ports={d.dynamicPorts} />
    </div>
  );
});
