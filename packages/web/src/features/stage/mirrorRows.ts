import type { DockviewApi, SerializedDockview } from 'dockview-core';

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

type GridNode = SerializedDockview['grid']['root'];

function leafId(node: GridNode): string | null {
  return Array.isArray(node.data) ? null : node.data.id;
}

/**
 * The four leaf group ids of a rendered grid-2x2 layout — [top-left, top-right, bottom-left,
 * bottom-right] — read from dockview's own applied tree. Row membership must come from here, not
 * from `slots`: a drag-swap can change `slots` without moving any panel (`storedLayout.ts`'s
 * `fits()` is positionally blind to swaps, a pre-existing issue out of scope here), which leaves
 * `slots` order disagreeing with which groups are physically a row. Returns `null` if the tree
 * isn't shaped like two branches of two leaves each.
 */
export function groupIdsFromAppliedGrid2x2(
  root: GridNode,
): readonly [string, string, string, string] | null {
  const rows = Array.isArray(root.data) ? root.data : null;
  if (rows === null || rows.length !== 2) return null;
  const [topRow, bottomRow] = rows as [GridNode, GridNode];
  const topLeaves = Array.isArray(topRow.data) ? topRow.data : null;
  const bottomLeaves = Array.isArray(bottomRow.data) ? bottomRow.data : null;
  if (topLeaves?.length !== 2 || bottomLeaves?.length !== 2) return null;
  const ids = [...topLeaves, ...bottomLeaves].map(leafId);
  return ids.every((id): id is string => id !== null)
    ? (ids as [string, string, string, string])
    : null;
}

function rowWidths(api: DockviewApi, ids: readonly [string, string]): RowWidths {
  return [api.getGroup(ids[0])?.api.width ?? 0, api.getGroup(ids[1])?.api.width ?? 0];
}

/**
 * Wires up the grid-2x2 row-mirroring behavior on a live dockview api: whichever row's own
 * column widths just changed gets copied onto the other, on every `onDidLayoutChange` fire.
 * Returns `null` (nothing wired) when the applied grid isn't shaped like grid-2x2's two rows of
 * two leaves. Caller owns disposal — call the returned function to tear the listener down.
 *
 * `onDidLayoutChange` fires for the row-height divider, a window resize, or anything else that
 * touches the layout, not just a column-width drag — diffing each row against its own
 * last-observed widths, rather than whether the two rows currently match, is what keeps this
 * inert for those. `setSize` re-fires the event asynchronously, but needs no re-entrancy guard:
 * after mirroring, both rows have been observed at their new widths, so the re-fire sees neither
 * row as changed and `resolveRowMirror` returns `null`.
 */
export function wireRowMirror(api: DockviewApi): (() => void) | null {
  const ids = groupIdsFromAppliedGrid2x2(api.toJSON().grid.root);
  if (ids === null) return null;
  const [topLeft, topRight, bottomLeft, bottomRight] = ids;
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
