import { HOVER_CARD_VIEWPORT_MARGIN, HOVER_CARD_WIDTH } from "../hoverCardPlacement";
import { useAppStore } from "../store";

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let mouseOverCard = false;
let hoverBlocked = false;
let hoverSuppressedUntil = 0;

const HOVER_SHOW_DELAY_MS = 560;
const HOVER_HIDE_DELAY_MS = 300;

function hoverIsSuppressed(): boolean {
  return hoverBlocked || Date.now() < hoverSuppressedUntil;
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
    useAppStore.getState().setHoverSymbol(null);
    return;
  }

  hoverSuppressedUntil = suppressMs > 0 ? Date.now() + suppressMs : 0;
}

export function scheduleShowHover(symbolId: string, rect: DOMRect) {
  if (hoverIsSuppressed()) return;
  cancelHideHover();
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    if (hoverIsSuppressed()) {
      showTimer = null;
      return;
    }
    const x = rect.right + 12 + HOVER_CARD_WIDTH > window.innerWidth
      ? rect.left - (HOVER_CARD_WIDTH + 12)
      : rect.right + 12;
    const y = Math.max(HOVER_CARD_VIEWPORT_MARGIN, Math.min(rect.top, window.innerHeight - 500));
    useAppStore.getState().setHoverSymbol(symbolId, { x, y });
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
    useAppStore.getState().setHoverSymbol(null);
    return;
  }
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (mouseOverCard) return;
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
