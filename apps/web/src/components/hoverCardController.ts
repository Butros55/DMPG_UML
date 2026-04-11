import { HOVER_CARD_VIEWPORT_MARGIN, HOVER_CARD_WIDTH } from "../hoverCardPlacement";
import { useAppStore, type HoverSource, type HoverTarget } from "../store";

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let mouseOverCard = false;
let hoverBlocked = false;
let hoverSuppressedUntil = 0;
let inspectorHighlightedNodeId: string | null = null;

const HOVER_SHOW_DELAY_MS = 320;
const HOVER_HIDE_DELAY_MS = 220;

function hoverIsSuppressed(): boolean {
  return hoverBlocked || Date.now() < hoverSuppressedUntil;
}

function remainingHoverSuppressionMs(): number {
  return Math.max(0, hoverSuppressedUntil - Date.now());
}

function commitHoverTarget(target: HoverTarget, rect: DOMRect, source: HoverSource) {
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
  useAppStore.getState().setHoverTarget({ ...target, source }, { x, y, source });
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
    useAppStore.getState().setHoverTarget(null);
    return;
  }

  hoverSuppressedUntil = suppressMs > 0 ? Date.now() + suppressMs : 0;
}

function scheduleShowHoverTarget(
  target: HoverTarget,
  rect: DOMRect,
  options?: { source?: HoverSource },
) {
  const source = options?.source ?? target.source ?? "canvas";
  if (hoverBlocked) return;
  cancelHideHover();
  if (showTimer) clearTimeout(showTimer);
  if (source === "inspector" && target.kind === "symbol") {
    setInspectorNodeHighlight(target.id);
  } else {
    clearInspectorNodeHighlight();
  }
  const delayMs = Math.max(HOVER_SHOW_DELAY_MS, remainingHoverSuppressionMs());
  showTimer = setTimeout(() => {
    if (hoverBlocked) {
      showTimer = null;
      return;
    }
    const remainingSuppression = remainingHoverSuppressionMs();
    if (remainingSuppression > 0) {
      showTimer = setTimeout(() => {
        showTimer = null;
        if (!hoverBlocked && remainingHoverSuppressionMs() <= 0) {
          commitHoverTarget(target, rect, source);
        }
      }, remainingSuppression);
      return;
    }
    commitHoverTarget(target, rect, source);
    showTimer = null;
  }, delayMs);
}

export function scheduleShowHover(
  symbolId: string,
  rect: DOMRect,
  options?: { source?: HoverSource },
) {
  scheduleShowHoverTarget({ kind: "symbol", id: symbolId, source: options?.source }, rect, options);
}

export function scheduleShowHoverSequenceMessage(
  messageId: string,
  rect: DOMRect,
  options?: { source?: HoverSource },
) {
  scheduleShowHoverTarget({ kind: "sequenceMessage", id: messageId, source: options?.source }, rect, options);
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
    useAppStore.getState().setHoverTarget(null);
    return;
  }
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (mouseOverCard) return;
    clearInspectorNodeHighlight();
    useAppStore.getState().setHoverTarget(null);
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
