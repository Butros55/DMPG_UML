import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAppStore } from "../store";
import { scheduleShowHover, scheduleHideHover } from "./SymbolHoverCard";
import type { Symbol as Sym } from "@dmpg/shared";

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
  [key: string]: unknown;
}

/* ── Relation badge icons & labels ──────────────── */

const REL_BADGE_META: Record<string, { icon: string; label: string }> = {
  reads: { icon: "📖", label: "reads" },
  writes: { icon: "💾", label: "writes" },
  calls: { icon: "📞", label: "calls" },
  imports: { icon: "📦", label: "imports" },
  inherits: { icon: "🧬", label: "inherits" },
  instantiates: { icon: "⚡", label: "creates" },
  uses_config: { icon: "⚙️", label: "config" },
};

function RelationBadges({ badges }: { badges?: string[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <div className="rel-badges">
      {badges.map((t) => {
        const meta = REL_BADGE_META[t];
        if (!meta) return null;
        return (
          <span key={t} className={`rel-badge rel-badge--${t}`}>
            {meta.icon} {meta.label}
          </span>
        );
      })}
    </div>
  );
}

/* ── Shared hooks ─────────────────────────────── */

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

/* ── Default UML Node (fallback) ──────────────── */

export const UmlNode = memo(function UmlNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);
  const isDead = d.tags?.includes("dead-code");

  return (
    <div
      className={`uml-node kind-${d.kind} ${isDead ? "dead-code" : ""} ${selected ? "selected" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="kind-badge">{d.kind}</span>
        <span className="node-label">{d.label}</span>
        {isDead && <span className="dead-code-badge" title="Unused — no callers">💀</span>}
      </div>
      <RelationBadges badges={d.relationBadges} />
      {d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          ▶ Drill down
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

/* ── UML Group Node (groups & modules in overview) ─ */

export const UmlGroupNode = memo(function UmlGroupNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);

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
      className={`uml-node kind-${d.kind} group-node ${selected ? "selected" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="kind-badge">{d.kind}</span>
        <span className="node-label">{d.label}</span>
      </div>
      <RelationBadges badges={d.relationBadges} />
      {countParts.length > 0 && (
        <div className="node-count-badge">{countParts.join(", ")}</div>
      )}
      {d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          ▶ Drill down
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

/* ── UML Class Node with compartments ─────────── */

export const UmlClassNode = memo(function UmlClassNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);

  const children = d.children ?? [];
  const attributes = children.filter((c) => c.kind === "constant" || c.kind === "variable");
  const methods = children.filter((c) => c.kind === "method" || c.kind === "function");

  return (
    <div
      className={`uml-node uml-class-node kind-class ${selected ? "selected" : ""}`}
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
      </div>

      {/* Attributes compartment */}
      <div className="compartment">
        {attributes.length > 0 ? (
          attributes.map((a) => (
            <div key={a.id} className="compartment-item">
              <span className="attr-icon">−</span> {a.label}
              {a.doc?.inputs?.[0]?.type && (
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
        {methods.length > 0 ? (
          methods.map((m) => (
            <div key={m.id} className="compartment-item method-item">
              <span className="method-icon">+</span> {m.label.split(".").pop()}()
              {m.doc?.inputs && m.doc.inputs.length > 0 && (
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
          ▶ Methods detail
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="out-bottom" />
      <Handle type="source" position={Position.Right} id="out-right" style={{ top: "70%" }} />
    </div>
  );
});

/* ── UML Function/Method Node ─────────────────── */

export const UmlFunctionNode = memo(function UmlFunctionNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleDrilldown, handleMouseEnter, handleMouseLeave } = useNodeActions(d);
  const isDead = d.tags?.includes("dead-code");

  const inputs = d.inputs ?? [];
  const outputs = d.outputs ?? [];

  return (
    <div
      className={`uml-node uml-function-node kind-${d.kind} ${isDead ? "dead-code" : ""} ${selected ? "selected" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} />

      <div className="node-header">
        <span className="kind-badge">{d.kind === "method" ? "method" : "fn"}</span>
        <span className="node-label">{d.label.split(".").pop()}</span>
        {isDead && <span className="dead-code-badge" title="Unused — no callers">💀</span>}
      </div>

      {/* Signature */}
      {inputs.length > 0 && (
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

      {outputs.length > 0 && (
        <div className="fn-return">
          → {outputs.map((o) => o.type ?? o.name).join(", ")}
        </div>
      )}

      <RelationBadges badges={d.relationBadges} />

      {d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          ▶ Detail
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

/* ── UML Artifact/External Node ───────────────── */

export const UmlArtifactNode = memo(function UmlArtifactNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const { handleClick, handleMouseEnter, handleMouseLeave } = useNodeActions(d);

  // Determine icon based on label
  const label = d.label.toLowerCase();
  let icon = "📄";
  if (label.includes(".csv") || label.includes(".xlsx") || label.includes(".xls")) icon = "📊";
  else if (label.includes(".json")) icon = "📋";
  else if (label.includes(".pkl") || label.includes(".pickle")) icon = "🗃️";
  else if (label.includes("db") || label.includes("sql") || label.includes("database")) icon = "🗄️";
  else if (label.includes("http") || label.includes("api")) icon = "🌐";

  return (
    <div
      className={`uml-node uml-artifact-node kind-external ${selected ? "selected" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="target" position={Position.Top} />

      <div className="node-header artifact-header">
        <span className="artifact-icon">{icon}</span>
        <span className="node-label">{d.label}</span>
      </div>

      <RelationBadges badges={d.relationBadges} />

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
