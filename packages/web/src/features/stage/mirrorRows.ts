import type { DockviewApi } from 'dockview-core';
import { groupIdForSlot } from './presetLayout';

export type RowWidths = readonly [number, number];

export interface RowMirror {
  readonly target: 'top' | 'bottom';
  readonly widths: RowWidths;
}

function widthsEqual(a: RowWidths, b: RowWidths): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Decides which row's column widths to copy onto the other. Diffs each row against its own last
 * observation rather than checking whether the two rows currently match, so a layout event that
 * never touched column widths (the row-height divider, a window resize) stays inert even when
 * the rows already differ. Mirrors only when exactly one row changed.
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

/**
 * The four leaf group ids of a grid-2x2 layout — [top-left, top-right, bottom-left, bottom-right]
 * — derived directly from `slots`, matching `presetLayout.ts`'s `grid-2x2` branch order. Row
 * membership comes from slot position: `presetLayout(preset, slots)` lays slots 0-3 out as
 * top-left, top-right, bottom-left, bottom-right, and `group-<panelId>` is the id `leaf()` gives
 * each of those groups.
 */
export function groupIdsFromSlots(
  slots: readonly (string | null)[],
): readonly [string, string, string, string] {
  return [0, 1, 2, 3].map((slot) => groupIdForSlot(slots, slot)) as [
    string,
    string,
    string,
    string,
  ];
}

function rowWidths(api: DockviewApi, ids: readonly [string, string]): RowWidths {
  return [api.getGroup(ids[0])?.api.width ?? 0, api.getGroup(ids[1])?.api.width ?? 0];
}

/**
 * Wires up the grid-2x2 row-mirroring behavior on a live dockview api: whichever row's own
 * column widths just changed gets copied onto the other, on every `onDidLayoutChange` fire.
 * Caller owns disposal — call the returned function to tear the listener down. Call only when the
 * stage's preset is `grid-2x2`, so `slots` has the four entries `groupIdsFromSlots` expects.
 *
 * `onDidLayoutChange` fires for the row-height divider, a window resize, or anything else that
 * touches the layout, not just a column-width drag — diffing each row against its own
 * last-observed widths, rather than whether the two rows currently match, is what keeps this
 * inert for those. `setSize` re-fires the event asynchronously, but needs no re-entrancy guard:
 * after mirroring, both rows have been observed at their new widths, so the re-fire sees neither
 * row as changed and `resolveRowMirror` returns `null`.
 */
export function wireRowMirror(api: DockviewApi, slots: readonly (string | null)[]): () => void {
  const [topLeft, topRight, bottomLeft, bottomRight] = groupIdsFromSlots(slots);
  let previousTop = rowWidths(api, [topLeft, topRight]);
  let previousBottom = rowWidths(api, [bottomLeft, bottomRight]);
  const disposable = api.onDidLayoutChange(() => {
    const top = rowWidths(api, [topLeft, topRight]);
    const bottom = rowWidths(api, [bottomLeft, bottomRight]);
    const mirror = resolveRowMirror(top, bottom, previousTop, previousBottom);
    if (mirror !== null) {
      const [leftId, rightId] =
        mirror.target === 'top' ? [topLeft, topRight] : [bottomLeft, bottomRight];
      api.getGroup(leftId)?.api.setSize({ width: mirror.widths[0] });
      api.getGroup(rightId)?.api.setSize({ width: mirror.widths[1] });
    }
    previousTop = mirror?.target === 'top' ? mirror.widths : top;
    previousBottom = mirror?.target === 'bottom' ? mirror.widths : bottom;
  });
  return () => disposable.dispose();
}
