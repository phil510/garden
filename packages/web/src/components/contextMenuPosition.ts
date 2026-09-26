export interface Point {
  x: number;
  y: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Anchors the menu at the click point, flipping left when it would run past the right edge of
 *  the viewport and clamping its top so it never runs past the bottom (min 8px from the top). */
export function computeContextMenuPosition(
  point: Point,
  menuSize: MenuSize,
  viewport: Viewport,
): { left: number; top: number } {
  const overflowsRight = point.x + menuSize.width > viewport.width;
  const left = overflowsRight ? point.x - menuSize.width : point.x;
  const maxTop = viewport.height - menuSize.height - 12;
  const top = point.y > maxTop ? Math.max(8, maxTop) : point.y;
  return { left, top };
}
