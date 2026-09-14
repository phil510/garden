import type { SerializedDockview } from 'dockview-core';
import { collectViews } from './presetLayout';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors `collectViews`'s ordered flatten of a grid tree's leaf `views`, but tolerates a shape
 *  that doesn't match `SerializedDockview` instead of throwing — `stored` is untyped JSON read
 *  back from disk or the wire, not a value this process produced. Returns `null` on the first
 *  node that isn't a plain branch-or-leaf record, rather than assuming the grid-presence guard in
 *  `fits()` already covers everything beneath `root`. */
function collectStoredViews(node: unknown): string[] | null {
  if (!isRecord(node)) return null;
  const data = node['data'];
  if (Array.isArray(data)) {
    const views: string[] = [];
    for (const child of data) {
      const childViews = collectStoredViews(child);
      if (childViews === null) return null;
      views.push(...childViews);
    }
    return views;
  }
  if (!isRecord(data) || !Array.isArray(data['views'])) return null;
  return data['views'].every((view): view is string => typeof view === 'string')
    ? data['views']
    : null;
}

/** The stored blob is only ever handed back to `fromJSON`, so the things worth checking are that
 *  it holds a grid with exactly the panes this stage wants, in the same left-to-right/top-to-
 *  bottom order — a blob whose panel-id *set* matches but whose order doesn't reflects a swap
 *  `slots` has already moved past, and reusing it verbatim would silently undo the swap on
 *  render — and that its root splits along the same axis, which is the only thing separating the
 *  two two-pane presets. Each id in the grid also has to have a `panels` entry: `fromJSON` doesn't
 *  reject a view with no matching panel state, it silently drops it, leaving that leaf empty.
 *
 *  Order is compared via each tree's flattened leaf list, not tree shape: two structurally
 *  different grids could in principle flatten to the same ordered id list. This is believed
 *  unreachable in practice because every leaf `presetLayout` produces is `locked` with
 *  `hideHeader: true`, which keeps dockview's own drag-to-merge from reshaping the tree into
 *  something structurally different that still flattens the same way. */
function fits(stored: unknown, wanted: SerializedDockview): stored is SerializedDockview {
  if (!isRecord(stored) || !isRecord(stored['grid']) || !isRecord(stored['panels'])) return false;
  if (stored['grid']['orientation'] !== wanted.grid.orientation) return false;
  const storedOrder = collectStoredViews(stored['grid']['root']);
  const wantedOrder = collectViews(wanted.grid.root);
  const panels = stored['panels'];
  return (
    storedOrder !== null &&
    storedOrder.length === wantedOrder.length &&
    storedOrder.every((id, index) => id === wantedOrder[index] && id in panels)
  );
}

/** dockview serialises a maximised stage with the maximised node recorded, so restoring the blob
 *  verbatim would bring the stage back with a pane hidden and nothing on screen saying why. */
function withoutMaximizedNode(layout: SerializedDockview): SerializedDockview {
  const grid: Record<string, unknown> = { ...layout.grid };
  delete grid['maximizedNode'];
  return { ...layout, grid: grid as unknown as SerializedDockview['grid'] };
}

/**
 * The layout to hand `fromJSON`: the persisted blob when it still describes this preset and
 * these panes, so the track sizes the user dragged survive a reload, and the preset's own
 * default arrangement otherwise.
 */
export function stageLayout(wanted: SerializedDockview, stored: unknown): SerializedDockview {
  return fits(stored, wanted) ? withoutMaximizedNode(stored) : wanted;
}
