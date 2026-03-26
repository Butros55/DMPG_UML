export interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SizeBox {
  width: number;
  height: number;
}

export interface HoverPlacementCandidate {
  id: string;
  x: number;
  y: number;
}

export interface ResolveHoverCardPlacementInput {
  anchorRect: RectBox;
  cardSize: SizeBox;
  bounds: RectBox;
  avoidRects?: RectBox[];
  corridorRects?: RectBox[];
  edgeRects?: RectBox[];
}

const EDGE_CORRIDOR_THICKNESS = 26;
const NODE_KEEP_OUT_PADDING = 10;
const DISTANCE_WEIGHT = 1.25;
const NODE_OVERLAP_WEIGHT = 8;
const CORRIDOR_OVERLAP_WEIGHT = 2.6;
const EDGE_PATH_OVERLAP_WEIGHT = 7.5;
const ANCHOR_OVERLAP_WEIGHT = 14;
const PLACEMENT_BASE_PENALTY: Record<string, number> = {
  right: 0,
  left: 12,
  "bottom-right": 42,
  "top-right": 48,
  bottom: 132,
  top: 138,
  "bottom-left": 146,
  "top-left": 152,
};

export const HOVER_CARD_GAP = 14;
export const HOVER_CARD_VIEWPORT_MARGIN = 8;
export const HOVER_CARD_WIDTH = 380;

export function rectFromBox(input: Pick<RectBox, "left" | "top" | "right" | "bottom">): RectBox {
  return {
    left: input.left,
    top: input.top,
    right: input.right,
    bottom: input.bottom,
    width: Math.max(0, input.right - input.left),
    height: Math.max(0, input.bottom - input.top),
  };
}

export function rectFromDomRect(rect: DOMRect | DOMRectReadOnly): RectBox {
  return rectFromBox(rect);
}

export function inflateRect(rect: RectBox, amount: number): RectBox {
  return rectFromBox({
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
  });
}

export function buildCorridorRect(a: RectBox, b: RectBox, thickness = EDGE_CORRIDOR_THICKNESS): RectBox {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  const halfThickness = thickness / 2;

  return rectFromBox({
    left: Math.min(ax, bx) - halfThickness,
    top: Math.min(ay, by) - halfThickness,
    right: Math.max(ax, bx) + halfThickness,
    bottom: Math.max(ay, by) + halfThickness,
  });
}

function centerOf(rect: RectBox) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function intersectArea(a: RectBox, b: RectBox): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function clampToBounds(candidate: HoverPlacementCandidate, cardSize: SizeBox, bounds: RectBox): HoverPlacementCandidate {
  const maxX = Math.max(bounds.left, bounds.right - cardSize.width);
  const maxY = Math.max(bounds.top, bounds.bottom - cardSize.height);
  return {
    ...candidate,
    x: Math.min(Math.max(candidate.x, bounds.left), maxX),
    y: Math.min(Math.max(candidate.y, bounds.top), maxY),
  };
}

function candidateRect(candidate: HoverPlacementCandidate, cardSize: SizeBox): RectBox {
  return rectFromBox({
    left: candidate.x,
    top: candidate.y,
    right: candidate.x + cardSize.width,
    bottom: candidate.y + cardSize.height,
  });
}

function buildCandidates(anchorRect: RectBox, cardSize: SizeBox): HoverPlacementCandidate[] {
  const centerX = anchorRect.left + anchorRect.width / 2;
  const centerY = anchorRect.top + anchorRect.height / 2;

  return [
    {
      id: "right",
      x: anchorRect.right + HOVER_CARD_GAP,
      y: centerY - cardSize.height / 2,
    },
    {
      id: "left",
      x: anchorRect.left - HOVER_CARD_GAP - cardSize.width,
      y: centerY - cardSize.height / 2,
    },
    {
      id: "bottom",
      x: centerX - cardSize.width / 2,
      y: anchorRect.bottom + HOVER_CARD_GAP,
    },
    {
      id: "top",
      x: centerX - cardSize.width / 2,
      y: anchorRect.top - HOVER_CARD_GAP - cardSize.height,
    },
    {
      id: "bottom-right",
      x: anchorRect.right + HOVER_CARD_GAP,
      y: anchorRect.bottom + HOVER_CARD_GAP,
    },
    {
      id: "top-right",
      x: anchorRect.right + HOVER_CARD_GAP,
      y: anchorRect.top - HOVER_CARD_GAP - cardSize.height,
    },
    {
      id: "bottom-left",
      x: anchorRect.left - HOVER_CARD_GAP - cardSize.width,
      y: anchorRect.bottom + HOVER_CARD_GAP,
    },
    {
      id: "top-left",
      x: anchorRect.left - HOVER_CARD_GAP - cardSize.width,
      y: anchorRect.top - HOVER_CARD_GAP - cardSize.height,
    },
  ];
}

function scoreCandidate(
  candidate: HoverPlacementCandidate,
  anchorRect: RectBox,
  cardSize: SizeBox,
  avoidRects: RectBox[],
  corridorRects: RectBox[],
  edgeRects: RectBox[],
): number {
  const cardRect = candidateRect(candidate, cardSize);
  const anchorCenter = centerOf(anchorRect);
  const cardCenter = centerOf(cardRect);

  let score = Math.hypot(cardCenter.x - anchorCenter.x, cardCenter.y - anchorCenter.y) * DISTANCE_WEIGHT;
  score += PLACEMENT_BASE_PENALTY[candidate.id] ?? 0;
  score += intersectArea(cardRect, anchorRect) * ANCHOR_OVERLAP_WEIGHT;

  for (const avoidRect of avoidRects) {
    score += intersectArea(cardRect, inflateRect(avoidRect, NODE_KEEP_OUT_PADDING)) * NODE_OVERLAP_WEIGHT;
  }

  for (const corridorRect of corridorRects) {
    score += intersectArea(cardRect, corridorRect) * CORRIDOR_OVERLAP_WEIGHT;
  }

  for (const edgeRect of edgeRects) {
    score += intersectArea(cardRect, edgeRect) * EDGE_PATH_OVERLAP_WEIGHT;
  }

  return score;
}

export function resolveHoverCardPlacement(input: ResolveHoverCardPlacementInput): HoverPlacementCandidate {
  const avoidRects = input.avoidRects ?? [];
  const corridorRects = input.corridorRects ?? [];
  const edgeRects = input.edgeRects ?? [];

  return buildCandidates(input.anchorRect, input.cardSize)
    .map((candidate) => clampToBounds(candidate, input.cardSize, input.bounds))
    .reduce((best, candidate) => {
      const score = scoreCandidate(candidate, input.anchorRect, input.cardSize, avoidRects, corridorRects, edgeRects);
      if (!best || score < best.score) {
        return { candidate, score };
      }
      return best;
    }, null as { candidate: HoverPlacementCandidate; score: number } | null)?.candidate ?? {
      id: "fallback",
      x: input.bounds.left,
      y: input.bounds.top,
    };
}
