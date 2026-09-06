import type { SerializedDockview } from 'dockview-core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function panelIds(layout: SerializedDockview): string[] {
  return Object.keys(layout.panels).sort();
}

/** The stored blob is only ever handed back to `fromJSON`, so the things worth checking are that
 *  it holds a grid with exactly the panels this stage wants — a blob describing a different set
 *  of sessions would put panes on stage the server did not ask for — and that its root splits
 *  along the same axis, which is the only thing separating the two two-pane presets. */
function fits(stored: unknown, wanted: SerializedDockview): stored is SerializedDockview {
  if (!isRecord(stored) || !isRecord(stored['grid']) || !isRecord(stored['panels'])) return false;
  if (stored['grid']['orientation'] !== wanted.grid.orientation) return false;
  const ids = Object.keys(stored['panels']).sort();
  const wantedIds = panelIds(wanted);
  return ids.length === wantedIds.length && ids.every((id, index) => id === wantedIds[index]);
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
