import { PRESET_ARRANGEMENTS, type StagePreset } from '@garden/shared';
import { Orientation, type SerializedDockview } from 'dockview-core';

type GridNode = SerializedDockview['grid']['root'];

/** dockview stores absolute sizes plus the viewport they were authored against and re-derives
 *  proportions from the pair on load, so these are ratios in a nominal viewport rather than
 *  real pixels. */
const LAYOUT_WIDTH = 1000;
const LAYOUT_HEIGHT = 1000;

export const PANE_COMPONENT = 'pane';
export const EMPTY_SLOT_COMPONENT = 'empty-slot';

const EMPTY_SLOT_PREFIX = 'empty-slot-';

/** Distinguishes a placeholder panel from a pane, whose id is a session id. */
export function isEmptySlotId(panelId: string): boolean {
  return panelId.startsWith(EMPTY_SLOT_PREFIX);
}

/** Recovers the slot index an empty-slot panel id was minted for. Unlike a pane, whose slot is
 *  `slots.indexOf(props.api.id)`, an empty slot can't find itself that way — `null` appears more
 *  than once in `slots` — so the index rides in the id itself. */
export function slotFromEmptySlotId(panelId: string): number {
  return Number(panelId.slice(EMPTY_SLOT_PREFIX.length));
}

/** An empty slot still gets a panel so the preset's shape stays visible with nothing on stage.
 *  Session ids are uuids, so no session can collide with one of these. */
function panelIdForSlot(slots: readonly (string | null)[], slot: number): string {
  return slots[slot] ?? `${EMPTY_SLOT_PREFIX}${String(slot)}`;
}

/** The `leaf()` group-id convention (`group-<panelId>`), keyed by slot instead of by panel id
 *  directly — the caller usually has a slot index on hand, not the panel id it maps to. */
export function groupIdForSlot(slots: readonly (string | null)[], slot: number): string {
  return `group-${panelIdForSlot(slots, slot)}`;
}

/** Every pane is alone in its own group: a group holding two panels would show one and stack the
 *  other behind a tab that `hideHeader` has removed. */
function leaf(panelId: string, size: number): GridNode {
  return {
    type: 'leaf',
    size,
    data: {
      id: `group-${panelId}`,
      views: [panelId],
      activeView: panelId,
      hideHeader: true,
      locked: true,
    },
  };
}

function branch(size: number, children: GridNode[]): GridNode {
  return { type: 'branch', size, data: children };
}

/** Child sizes run along their parent's axis and alternate with depth, so a track under a
 *  `HORIZONTAL` root carries a width and a leaf inside a multi-slot track carries a height. */
function gridForPreset(preset: StagePreset, panelId: (slot: number) => string) {
  const { split, tracks } = PRESET_ARRANGEMENTS[preset];
  const horizontal = split === 'across';
  const rootLength = horizontal ? LAYOUT_WIDTH : LAYOUT_HEIGHT;
  const crossLength = horizontal ? LAYOUT_HEIGHT : LAYOUT_WIDTH;
  const totalWeight = tracks.reduce((sum, track) => sum + (track.weight ?? 1), 0);

  let slot = 0;
  const children = tracks.map((track) => {
    const size = ((track.weight ?? 1) / totalWeight) * rootLength;
    const first = slot;
    slot += track.slots;
    if (track.slots === 1) return leaf(panelId(first), size);
    return branch(
      size,
      Array.from({ length: track.slots }, (_, i) =>
        leaf(panelId(first + i), crossLength / track.slots),
      ),
    );
  });

  return {
    width: LAYOUT_WIDTH,
    height: LAYOUT_HEIGHT,
    orientation: horizontal ? Orientation.HORIZONTAL : Orientation.VERTICAL,
    root: branch(crossLength, children),
  };
}

export function collectViews(node: GridNode): string[] {
  return Array.isArray(node.data) ? node.data.flatMap(collectViews) : node.data.views;
}

/**
 * The preset's pane arrangement as a dockview layout, with panel ids taken from `slots` — that
 * identity is what `reuseExistingPanels` matches a surviving pane on, so a pane keeps its xterm
 * instance and its socket across a preset change.
 */
export function presetLayout(
  preset: StagePreset,
  slots: readonly (string | null)[],
): SerializedDockview {
  const grid = gridForPreset(preset, (slot) => panelIdForSlot(slots, slot));
  const panels: SerializedDockview['panels'] = {};
  for (const panelId of collectViews(grid.root)) {
    panels[panelId] = {
      id: panelId,
      contentComponent: isEmptySlotId(panelId) ? EMPTY_SLOT_COMPONENT : PANE_COMPONENT,
      renderer: 'always',
    };
  }
  return { grid, panels };
}
