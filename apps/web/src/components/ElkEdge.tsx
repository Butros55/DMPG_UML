import {
  BaseEdge,
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

  if (route && route.points.length >= 2) {
    return (
      <BaseEdge
        {...props}
        path={buildPolylinePath(route)}
        labelX={route.labelX}
        labelY={route.labelY}
      />
    );
  }

  if (props.data?.hideFallback) {
    return null;
  }

  const fallback = buildFallbackPath(props.data?.fallbackEdgeType ?? "step", props);
  return (
    <BaseEdge
      {...props}
      path={fallback.path}
      labelX={fallback.labelX}
      labelY={fallback.labelY}
    />
  );
}

