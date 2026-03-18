import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { DiagramEdgeType } from "../diagramSettings";
import type { EdgeRoute } from "../layout";

type ElkEdgeData = {
  elkRoute?: EdgeRoute;
  fallbackEdgeType?: DiagramEdgeType;
  hideFallback?: boolean;
  sequenceKind?: "sync" | "async" | "create" | "self";
  sequenceLabelWidth?: number;
  sequenceLabelLineCount?: number;
};

type BaseEdgeConfig = {
  label?: EdgeProps<Edge<ElkEdgeData>>["label"];
  labelStyle?: EdgeProps<Edge<ElkEdgeData>>["labelStyle"];
  labelShowBg?: EdgeProps<Edge<ElkEdgeData>>["labelShowBg"];
  labelBgStyle?: EdgeProps<Edge<ElkEdgeData>>["labelBgStyle"];
  labelBgPadding?: EdgeProps<Edge<ElkEdgeData>>["labelBgPadding"];
  labelBgBorderRadius?: EdgeProps<Edge<ElkEdgeData>>["labelBgBorderRadius"];
  style?: EdgeProps<Edge<ElkEdgeData>>["style"];
  markerStart?: EdgeProps<Edge<ElkEdgeData>>["markerStart"];
  markerEnd?: EdgeProps<Edge<ElkEdgeData>>["markerEnd"];
  interactionWidth?: EdgeProps<Edge<ElkEdgeData>>["interactionWidth"];
  className?: string;
};

function buildPolylinePath(route: EdgeRoute): string {
  return route.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x},${point.y}`)
    .join(" ");
}

function buildFallbackPath(
  edgeType: DiagramEdgeType,
  props: EdgeProps<Edge<ElkEdgeData>>,
): { path: string; labelX: number; labelY: number } {
  if (props.data?.sequenceKind === "self" || props.source === props.target) {
    const anchorX = Math.max(props.sourceX, props.targetX);
    const topY = Math.min(props.sourceY, props.targetY);
    const bottomY = Math.max(props.sourceY, props.targetY);
    const loopWidth = 54;
    const elbowX = anchorX + loopWidth;
    const midY = (topY + bottomY) / 2;

    return {
      path: [
        `M ${anchorX},${topY}`,
        `C ${elbowX},${topY} ${elbowX},${topY} ${elbowX},${midY}`,
        `S ${elbowX},${bottomY} ${anchorX},${bottomY}`,
      ].join(" "),
      labelX: elbowX - 8,
      labelY: midY,
    };
  }

  if (edgeType === "straight") {
    const [path, labelX, labelY] = getStraightPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      targetX: props.targetX,
      targetY: props.targetY,
    });
    return { path, labelX, labelY };
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: edgeType === "step" ? 0 : 14,
  });
  return { path, labelX, labelY };
}

export function ElkEdge(props: EdgeProps<Edge<ElkEdgeData>>) {
  const route = props.data?.elkRoute;
  const className = (props as EdgeProps<Edge<ElkEdgeData>> & { className?: string }).className;
  const isSequenceEdge = !!props.data?.sequenceKind;
  const label = typeof props.label === "string" ? props.label : undefined;
  const baseEdgeProps = {
    label: isSequenceEdge ? undefined : props.label,
    labelStyle: isSequenceEdge ? undefined : props.labelStyle,
    labelShowBg: isSequenceEdge ? undefined : props.labelShowBg,
    labelBgStyle: isSequenceEdge ? undefined : props.labelBgStyle,
    labelBgPadding: isSequenceEdge ? undefined : props.labelBgPadding,
    labelBgBorderRadius: isSequenceEdge ? undefined : props.labelBgBorderRadius,
    style: props.style,
    markerStart: props.markerStart,
    markerEnd: props.markerEnd,
    interactionWidth: props.interactionWidth,
    className,
  };

  if (route && route.points.length >= 2) {
    return renderEdge({
      baseEdgeProps,
      path: buildPolylinePath(route),
      labelX: route.labelX,
      labelY: route.labelY,
      edgeId: props.id,
      label,
      className,
      data: props.data,
      selected: props.selected ?? false,
    });
  }

  if (props.data?.hideFallback) {
    return null;
  }

  const fallback = buildFallbackPath(props.data?.fallbackEdgeType ?? "step", props);
  return renderEdge({
    baseEdgeProps,
    path: fallback.path,
    labelX: fallback.labelX,
    labelY: fallback.labelY,
    edgeId: props.id,
    label,
    className,
    data: props.data,
    selected: props.selected ?? false,
  });
}

function renderEdge(params: {
  baseEdgeProps: BaseEdgeConfig;
  path: string;
  labelX: number;
  labelY: number;
  edgeId: string;
  label?: string;
  className?: string;
  data?: ElkEdgeData;
  selected: boolean;
}) {
  const { baseEdgeProps, path, labelX, labelY, edgeId, label, className, data, selected } = params;
  const isSequenceEdge = !!data?.sequenceKind;
  const labelClassName = [
    "sequence-edge-label",
    data?.sequenceKind ? `sequence-edge-label--${data.sequenceKind}` : "",
    className ?? "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <BaseEdge
        {...baseEdgeProps}
        path={path}
        labelX={labelX}
        labelY={labelY}
      />
      {isSequenceEdge && label ? (
        <EdgeLabelRenderer>
          <div
            className={labelClassName}
            data-edge-id={edgeId}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              maxWidth: `${Math.max(72, data?.sequenceLabelWidth ?? 180)}px`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

