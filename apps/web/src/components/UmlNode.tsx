import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAppStore } from "../store";

export interface UmlNodeData {
  label: string;
  kind: string;
  summary?: string;
  symbolId: string;
  childViewId?: string;
  [key: string]: unknown;
}

export const UmlNode = memo(function UmlNode({ data, selected }: NodeProps) {
  const d = data as unknown as UmlNodeData;
  const selectSymbol = useAppStore((s) => s.selectSymbol);
  const navigateToView = useAppStore((s) => s.navigateToView);

  const handleClick = useCallback(() => {
    selectSymbol(d.symbolId);
  }, [selectSymbol, d.symbolId]);

  const handleDrilldown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (d.childViewId) navigateToView(d.childViewId);
    },
    [navigateToView, d.childViewId],
  );

  const isGroup = d.kind === "group";

  return (
    <div
      className={`uml-node kind-${d.kind} ${isGroup ? "group-node" : ""} ${selected ? "selected" : ""}`}
      onClick={handleClick}
    >
      <Handle type="target" position={Position.Top} />

      <div className="node-header">
        <span className="kind-badge">{d.kind}</span>
        <span className="node-label">{d.label}</span>
      </div>

      {d.summary && <div className="node-body">{d.summary}</div>}

      {isGroup && d.childViewId && (
        <div className="group-drilldown" onClick={handleDrilldown}>
          ▶ Drill down
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
