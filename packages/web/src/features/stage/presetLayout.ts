import type { StagePreset } from '@garden/shared';
import { Orientation, type SerializedDockview } from 'dockview-core';

type GridNode = SerializedDockview['grid']['root'];

/** dockview stores absolute sizes plus the viewport they were authored against and re-derives
 *  proportions from the pair on load, so these are ratios in a nominal viewport rather than
 *  real pixels. */
const LAYOUT_WIDTH = 1000;
const LAYOUT_HEIGHT = 1000;

/** The mock's TRACK_DEFAULTS: every preset splits its axes evenly except the large left column
 *  of `three`. */
const THREE_LEFT_WIDTH = LAYOUT_WIDTH * 0.55;

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

/** Child sizes run along their parent's axis and alternate with depth, so a leaf under a
 *  `HORIZONTAL` root carries a width and a leaf one level deeper carries a height. */
function gridForPreset(preset: StagePreset, panelId: (slot: number) => string) {
  const horizontal = {
    width: LAYOUT_WIDTH,
    height: LAYOUT_HEIGHT,
    orientation: Orientation.HORIZONTAL,
  };
  const vertical = {
    width: LAYOUT_WIDTH,
    height: LAYOUT_HEIGHT,
    orientation: Orientation.VERTICAL,
  };
  const halfWidth = LAYOUT_WIDTH / 2;
  const halfHeight = LAYOUT_HEIGHT / 2;

  switch (preset) {
    case 'single':
      return { ...horizontal, root: branch(LAYOUT_HEIGHT, [leaf(panelId(0), LAYOUT_WIDTH)]) };
    case 'two-across':
      return {
        ...horizontal,
        root: branch(LAYOUT_HEIGHT, [leaf(panelId(0), halfWidth), leaf(panelId(1), halfWidth)]),
      };
    case 'two-stacked':
      return {
        ...vertical,
        root: branch(LAYOUT_WIDTH, [leaf(panelId(0), halfHeight), leaf(panelId(1), halfHeight)]),
      };
    case 'three':
      return {
        ...horizontal,
        root: branch(LAYOUT_HEIGHT, [
          leaf(panelId(0), THREE_LEFT_WIDTH),
          branch(LAYOUT_WIDTH - THREE_LEFT_WIDTH, [
            leaf(panelId(1), halfHeight),
            leaf(panelId(2), halfHeight),
          ]),
        ]),
      };
    case 'grid-2x2':
      return {
        ...vertical,
        root: branch(LAYOUT_WIDTH, [
          branch(halfHeight, [leaf(panelId(0), halfWidth), leaf(panelId(1), halfWidth)]),
          branch(halfHeight, [leaf(panelId(2), halfWidth), leaf(panelId(3), halfWidth)]),
        ]),
      };
  }
}

/** The four leaf group ids in `grid-2x2`, in slot order [top-left, top-right, bottom-left,
 *  bottom-right]. Reuses `panelIdForSlot`'s empty-slot convention so callers that mirror the
 *  two rows' widths (Stage.tsx) don't have to re-derive the `group-` prefix themselves. */
export function groupIdsForGrid2x2(
  slots: readonly (string | null)[],
): readonly [string, string, string, string] {
  return [
    `group-${panelIdForSlot(slots, 0)}`,
    `group-${panelIdForSlot(slots, 1)}`,
    `group-${panelIdForSlot(slots, 2)}`,
    `group-${panelIdForSlot(slots, 3)}`,
  ];
}

function collectViews(node: GridNode): string[] {
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
