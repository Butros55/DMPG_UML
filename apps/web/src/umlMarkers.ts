import type { Edge } from "@xyflow/react";
import type { RelationType } from "@dmpg/shared";

export const UML_MARKER = {
  inheritsTriangle: "url(#uml-inherits-triangle)",
  realizesTriangle: "url(#uml-realizes-triangle)",
  aggregationDiamond: "url(#uml-aggregation-diamond)",
  compositionDiamond: "url(#uml-composition-diamond)",
  dependencyArrow: "url(#uml-dependency-arrow)",
  instantiatesArrow: "url(#uml-instantiates-arrow)",
} as const;

type EdgeMarker = Edge["markerEnd"];

const BUILT_IN_ARROW_MARKER = {
  type: "arrow",
  width: 18,
  height: 18,
  color: "#6c8cff",
} as unknown as NonNullable<EdgeMarker>;

export function edgeMarkerStartForRelation(type: RelationType): EdgeMarker {
  switch (type) {
    case "aggregation":
      return UML_MARKER.aggregationDiamond;
    case "composition":
      return UML_MARKER.compositionDiamond;
    default:
      return undefined;
  }
}

export function edgeMarkerEndForRelation(type: RelationType): EdgeMarker {
  switch (type) {
    case "inherits":
      return UML_MARKER.inheritsTriangle;
    case "realizes":
      return UML_MARKER.realizesTriangle;
    case "dependency":
      return UML_MARKER.dependencyArrow;
    case "instantiates":
      return UML_MARKER.instantiatesArrow;
    case "imports":
    case "uses_config":
      return BUILT_IN_ARROW_MARKER;
    default:
      return undefined;
  }
}
