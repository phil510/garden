export type RowWidths = readonly [number, number];

export interface RowMirror {
  readonly target: 'top' | 'bottom';
  readonly widths: RowWidths;
}

function widthsEqual(a: RowWidths, b: RowWidths): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Decides which row's column widths to copy onto the other, by diffing each row's current
 * widths against its own previous observation — not against whether the two rows currently
 * match each other. That distinction is what keeps this inert for a layout change that never
 * touched column widths at all (dragging the row-height divider, a window resize): neither row's
 * widths moved since the last observation, so this returns `null` even when the two rows already
 * differ (a legacy lopsided layout). Mirrors only when exactly one row changed; two rows
 * changing at once, or neither changing, is left alone rather than guessed at.
 */
export function resolveRowMirror(
  topWidths: RowWidths,
  bottomWidths: RowWidths,
  previousTopWidths: RowWidths,
  previousBottomWidths: RowWidths,
): RowMirror | null {
  const topChanged = !widthsEqual(topWidths, previousTopWidths);
  const bottomChanged = !widthsEqual(bottomWidths, previousBottomWidths);
  if (topChanged && !bottomChanged) return { target: 'bottom', widths: topWidths };
  if (bottomChanged && !topChanged) return { target: 'top', widths: bottomWidths };
  return null;
}
