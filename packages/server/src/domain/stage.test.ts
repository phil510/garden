import { describe, expect, it } from 'vitest';
import { switchPreset } from './stage.js';

describe('switchPreset', () => {
  it('keeps every pane when the new preset has equal or greater capacity', () => {
    expect(switchPreset(['a', 'b'], 1, 'two-stacked')).toEqual({
      slots: ['a', 'b'],
      focusedSlot: 1,
    });
  });

  it('pads with empty slots when the new preset has more capacity', () => {
    expect(switchPreset(['a'], 0, 'grid-2x2')).toEqual({
      slots: ['a', null, null, null],
      focusedSlot: 0,
    });
  });

  it('evicts panes past the new capacity back to the sidebar, keeping slot order', () => {
    expect(switchPreset(['a', 'b', 'c', 'd'], 0, 'single')).toEqual({
      slots: ['a'],
      focusedSlot: 0,
    });
  });

  it('evicts from three down to two-across, keeping the first two slots', () => {
    expect(switchPreset(['a', 'b', 'c'], 0, 'two-across')).toEqual({
      slots: ['a', 'b'],
      focusedSlot: 0,
    });
  });

  it('resets focus to slot 0 when the focused slot no longer fits', () => {
    expect(switchPreset(['a', 'b', 'c', 'd'], 3, 'two-across')).toEqual({
      slots: ['a', 'b'],
      focusedSlot: 0,
    });
  });

  it('leaves focus alone when it still fits after eviction', () => {
    expect(switchPreset(['a', 'b', 'c', 'd'], 1, 'three')).toEqual({
      slots: ['a', 'b', 'c'],
      focusedSlot: 1,
    });
  });

  it('treats a gap in the surviving slots as empty rather than compacting', () => {
    expect(switchPreset([null, 'b', 'c', 'd'], 0, 'three')).toEqual({
      slots: [null, 'b', 'c'],
      focusedSlot: 0,
    });
  });
});
