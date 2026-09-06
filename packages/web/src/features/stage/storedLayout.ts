import type { SerializedDockview } from 'dockview-core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function panelIds(layout: SerializedDockview): string[] {
  return Object.keys(layout.panels).sort();
}

/** The stored blob is only ever handed back to `fromJSON`, so the one thing worth checking is
 *  that it holds a grid and exactly the panels this stage wants — a blob describing a different
 *  preset or a different set of sessions would put panes on stage the server did not ask for. */
function fits(stored: unknown, wanted: SerializedDockview): stored is SerializedDockview {
  if (!isRecord(stored) || !isRecord(stored['grid']) || !isRecord(stored['panels'])) return false;
  const ids = Object.keys(stored['panels']).sort();
  const wantedIds = panelIds(wanted);
  return ids.length === wantedIds.length && ids.every((id, index) => id === wantedIds[index]);
}

/**
 * The layout to hand `fromJSON`: the persisted blob when it still describes this preset and
 * these panes, so the track sizes the user dragged survive a reload, and the preset's own
 * default arrangement otherwise.
 */
export function stageLayout(wanted: SerializedDockview, stored: unknown): SerializedDockview {
  return fits(stored, wanted) ? stored : wanted;
}
