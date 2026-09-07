import { STAGE_PRESETS } from '@garden/shared';
import type { SerializedDockview } from 'dockview-core';
import { describe, expect, it } from 'vitest';
import { EMPTY_SLOT_COMPONENT, PANE_COMPONENT, presetLayout } from './presetLayout';

type GridNode = SerializedDockview['grid']['root'];
type GroupData = Exclude<GridNode['data'], GridNode[]>;

function groups(node: GridNode): GroupData[] {
  return Array.isArray(node.data) ? node.data.flatMap(groups) : [node.data];
}

function panelOrder(layout: SerializedDockview): string[] {
  return groups(layout.grid.root).flatMap((group) => group.views);
}

const SLOTS = ['a', 'b', 'c', 'd'];

describe('presetLayout', () => {
  it.each(STAGE_PRESETS)('gives every pane its own headerless locked group in %s', (preset) => {
    const layout = presetLayout(preset, SLOTS);
    const placed = groups(layout.grid.root);

    for (const group of placed) {
      expect(group).toMatchObject({ hideHeader: true, locked: true });
      expect(group.views).toHaveLength(1);
    }
    expect(new Set(placed.map((group) => group.id)).size).toBe(placed.length);
  });

  it.each(STAGE_PRESETS)('declares exactly the panels the %s grid places', (preset) => {
    const layout = presetLayout(preset, SLOTS);

    expect(panelOrder(layout)).toEqual(Object.keys(layout.panels));
    for (const panel of Object.values(layout.panels)) {
      expect(panel.renderer).toBe('always');
    }
  });

  it('uses session ids as panel ids, in slot order', () => {
    expect(panelOrder(presetLayout('three', SLOTS))).toEqual(['a', 'b', 'c']);
  });

  it('stands a placeholder in an empty slot so the preset keeps its shape', () => {
    const layout = presetLayout('two-across', [null, 'b']);
    const [empty, filled] = panelOrder(layout);

    expect(filled).toBe('b');
    expect(layout.panels[empty ?? '']?.contentComponent).toBe(EMPTY_SLOT_COMPONENT);
    expect(layout.panels.b?.contentComponent).toBe(PANE_COMPONENT);
  });

  it('fills a slot array shorter than the preset with placeholders', () => {
    expect(panelOrder(presetLayout('grid-2x2', ['a']))).toHaveLength(4);
  });

  it('splits three into a large left pane and two stacked on the right', () => {
    const root = presetLayout('three', SLOTS).grid.root;
    const children = Array.isArray(root.data) ? root.data : [];
    const [leftSize = 0, rightSize = 0] = children.map((child) => child.size ?? 0);

    expect(children.map((child) => child.type)).toEqual(['leaf', 'branch']);
    expect(leftSize).toBeGreaterThan(rightSize);
  });
});
