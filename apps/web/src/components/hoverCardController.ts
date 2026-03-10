import { HOVER_CARD_VIEWPORT_MARGIN, HOVER_CARD_WIDTH } from "../hoverCardPlacement";
import { useAppStore } from "../store";

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let mouseOverCard = false;
let hoverBlocked = false;
let hoverSuppressedUntil = 0;
let inspectorHighlightedNodeId: string | null = null;

const HOVER_SHOW_DELAY_MS = 560;
const HOVER_HIDE_DELAY_MS = 300;

function hoverIsSuppressed(): boolean {
  return hoverBlocked || Date.now() < hoverSuppressedUntil;
}

function clearInspectorNodeHighlight() {
  if (!inspectorHighlightedNodeId) return;
  const previous = document.querySelector(`[data-id="${CSS.escape(inspectorHighlightedNodeId)}"]`);
  previous?.classList.remove("inspector-hover-highlight");
  inspectorHighlightedNodeId = null;
}

function setInspectorNodeHighlight(symbolId: string | null) {
  if (!symbolId) {
    clearInspectorNodeHighlight();
    return;
  }
  if (inspectorHighlightedNodeId === symbolId) return;
  clearInspectorNodeHighlight();
  const next = document.querySelector(`[data-id="${CSS.escape(symbolId)}"]`);
  if (!next) return;
  next.classList.add("inspector-hover-highlight");
  inspectorHighlightedNodeId = symbolId;
}

export function setLinkedNodeHighlight(symbolId: string | null) {
  setInspectorNodeHighlight(symbolId);
}

export function clearLinkedNodeHighlight() {
  clearInspectorNodeHighlight();
}

export function setHoverInteractionBlocked(blocked: boolean, suppressMs = 0) {
  hoverBlocked = blocked;

  if (blocked) {
    mouseOverCard = false;
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    clearInspectorNodeHighlight();
    useAppStore.getState().setHoverSymbol(null);
    return;
  }

  hoverSuppressedUntil = suppressMs > 0 ? Date.now() + suppressMs : 0;
}

export function scheduleShowHover(
  symbolId: string,
  rect: DOMRect,
  options?: { source?: "canvas" | "inspector" },
) {
  const source = options?.source ?? "canvas";
  if (hoverIsSuppressed()) return;
  cancelHideHover();
  if (showTimer) clearTimeout(showTimer);
  if (source === "inspector") {
    setInspectorNodeHighlight(symbolId);
  } else {
    clearInspectorNodeHighlight();
  }
  showTimer = setTimeout(() => {
    if (hoverIsSuppressed()) {
      showTimer = null;
      return;
    }
    const inspectorEl = source === "inspector" ? document.querySelector(".inspector") : null;
    const inspectorRect = inspectorEl instanceof HTMLElement ? inspectorEl.getBoundingClientRect() : null;
    const x = source === "inspector" && inspectorRect
      ? Math.max(
          HOVER_CARD_VIEWPORT_MARGIN,
          inspectorRect.left - (HOVER_CARD_WIDTH + 18),
        )
      : rect.right + 12 + HOVER_CARD_WIDTH > window.innerWidth
        ? rect.left - (HOVER_CARD_WIDTH + 12)
        : rect.right + 12;
    const y = source === "inspector" && inspectorRect
      ? Math.max(
          inspectorRect.top + 8,
          Math.min(rect.top - 6, inspectorRect.bottom - 520),
        )
      : Math.max(HOVER_CARD_VIEWPORT_MARGIN, Math.min(rect.top, window.innerHeight - 500));
    useAppStore.getState().setHoverSymbol(symbolId, { x, y, source });
    showTimer = null;
  }, HOVER_SHOW_DELAY_MS);
}

export function scheduleHideHover() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (hoverIsSuppressed()) {
    mouseOverCard = false;
    clearInspectorNodeHighlight();
    useAppStore.getState().setHoverSymbol(null);
    return;
  }
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (mouseOverCard) return;
    clearInspectorNodeHighlight();
    useAppStore.getState().setHoverSymbol(null);
  }, HOVER_HIDE_DELAY_MS);
}

export function cancelHideHover() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function setMouseOverCard(over: boolean) {
  mouseOverCard = over;
  if (over) cancelHideHover();
}
