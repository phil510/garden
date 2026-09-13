export type RowWidths = readonly [number, number];

export interface RowMirror {
  readonly target: 'top' | 'bottom';
  readonly widths: RowWidths;
}

function widthsEqual(a: RowWidths, b: RowWidths): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Decides which row's column widths to bring back in sync with the other, given the widths
 * both rows last agreed on. `baselineWidths` is seeded from the applied layout (Stage.tsx) so
 * the two rows are always symmetric before the first real divergence — there is no "no baseline
 * yet" case to handle here. Returns `null` when the rows already match.
 */
export function resolveRowMirror(
  topWidths: RowWidths,
  bottomWidths: RowWidths,
  baselineWidths: RowWidths,
): RowMirror | null {
  if (widthsEqual(topWidths, bottomWidths)) return null;
  return widthsEqual(topWidths, baselineWidths)
    ? { target: 'top', widths: bottomWidths }
    : { target: 'bottom', widths: topWidths };
}
