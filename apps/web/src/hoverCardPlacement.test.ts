import test from "node:test";
import assert from "node:assert/strict";

import { resolveHoverCardPlacement, rectFromBox, buildCorridorRect } from "./hoverCardPlacement";

test("resolveHoverCardPlacement prefers the right side when no highlighted neighborhood is in the way", () => {
  const anchorRect = rectFromBox({ left: 420, top: 220, right: 560, bottom: 300 });
  const placement = resolveHoverCardPlacement({
    anchorRect,
    cardSize: { width: 380, height: 260 },
    bounds: rectFromBox({ left: 0, top: 0, right: 1400, bottom: 900 }),
  });

  assert.equal(placement.id, "right");
  assert.equal(placement.x, 574);
});

test("resolveHoverCardPlacement avoids connected nodes and corridors on the right side", () => {
  const anchorRect = rectFromBox({ left: 520, top: 220, right: 660, bottom: 300 });
  const rightNeighbor = rectFromBox({ left: 760, top: 180, right: 920, bottom: 320 });
  const placement = resolveHoverCardPlacement({
    anchorRect,
    cardSize: { width: 380, height: 260 },
    bounds: rectFromBox({ left: 0, top: 0, right: 1500, bottom: 900 }),
    avoidRects: [rightNeighbor],
    corridorRects: [buildCorridorRect(anchorRect, rightNeighbor)],
  });

  assert.equal(placement.id, "left");
  assert.ok(placement.x < anchorRect.left);
});

test("resolveHoverCardPlacement also avoids highlighted edge segments when possible", () => {
  const anchorRect = rectFromBox({ left: 520, top: 220, right: 660, bottom: 300 });
  const placement = resolveHoverCardPlacement({
    anchorRect,
    cardSize: { width: 380, height: 260 },
    bounds: rectFromBox({ left: 0, top: 0, right: 1500, bottom: 900 }),
    edgeRects: [
      rectFromBox({ left: 690, top: 140, right: 722, bottom: 520 }),
      rectFromBox({ left: 722, top: 254, right: 860, bottom: 286 }),
    ],
  });

  assert.notEqual(placement.id, "right");
});

test("resolveHoverCardPlacement keeps the card inside the available bounds", () => {
  const anchorRect = rectFromBox({ left: 1080, top: 760, right: 1220, bottom: 840 });
  const placement = resolveHoverCardPlacement({
    anchorRect,
    cardSize: { width: 380, height: 260 },
    bounds: rectFromBox({ left: 100, top: 80, right: 1280, bottom: 900 }),
  });

  assert.ok(placement.x >= 100);
  assert.ok(placement.y >= 80);
  assert.ok(placement.x + 380 <= 1280);
  assert.ok(placement.y + 260 <= 900);
});
