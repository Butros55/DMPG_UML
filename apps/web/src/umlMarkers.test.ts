import test from "node:test";
import assert from "node:assert/strict";
import {
  edgeMarkerEndForRelation,
  edgeMarkerStartForRelation,
  UML_MARKER,
} from "./umlMarkers.js";

test("class diagram markers place inheritance and realization triangles at the target end", () => {
  assert.equal(edgeMarkerEndForRelation("inherits"), UML_MARKER.inheritsTriangle);
  assert.equal(edgeMarkerEndForRelation("realizes"), UML_MARKER.realizesTriangle);
  assert.equal(edgeMarkerStartForRelation("inherits"), undefined);
});

test("class diagram markers place ownership diamonds at the source end", () => {
  assert.equal(edgeMarkerStartForRelation("aggregation"), UML_MARKER.aggregationDiamond);
  assert.equal(edgeMarkerStartForRelation("composition"), UML_MARKER.compositionDiamond);
  assert.equal(edgeMarkerEndForRelation("aggregation"), undefined);
  assert.equal(edgeMarkerEndForRelation("composition"), undefined);
});

test("association is plain while dependency remains navigable", () => {
  assert.equal(edgeMarkerEndForRelation("association"), undefined);
  assert.equal(edgeMarkerStartForRelation("association"), undefined);
  assert.equal(edgeMarkerEndForRelation("dependency"), UML_MARKER.dependencyArrow);
});
