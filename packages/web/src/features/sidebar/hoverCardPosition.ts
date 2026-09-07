export interface AnchorRect {
  left: number;
  right: number;
  top: number;
}

export interface Viewport {
  width: number;
  height: number;
}

const CARD_WIDTH = 280;
const CARD_GAP = 8;

/** Anchors the card beside the hovered row, flipping to the left edge when it would run past
 *  the right of the viewport and clamping its top so it never runs past the bottom. */
export function computeHoverCardPosition(
  anchor: AnchorRect,
  cardHeight: number,
  viewport: Viewport,
): { left: number; top: number } {
  const maxTop = viewport.height - cardHeight - 12;
  const top = anchor.top > maxTop ? Math.max(8, maxTop) : anchor.top;
  const overflowsRight = anchor.right + CARD_GAP + CARD_WIDTH > viewport.width;
  const left = overflowsRight ? anchor.left - CARD_WIDTH - CARD_GAP : anchor.right + CARD_GAP;
  return { left, top };
}
