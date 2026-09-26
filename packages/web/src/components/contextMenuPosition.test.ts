import { describe, expect, it } from 'vitest';
import { computeContextMenuPosition, computeSubmenuFlip } from './contextMenuPosition';

const viewport = { width: 1200, height: 800 };
const menuSize = { width: 180, height: 120 };

describe('computeContextMenuPosition', () => {
  it('anchors at the click point when there is room', () => {
    expect(computeContextMenuPosition({ x: 100, y: 100 }, menuSize, viewport)).toEqual({
      left: 100,
      top: 100,
    });
  });

  it('flips left when the menu would run past the right edge', () => {
    expect(computeContextMenuPosition({ x: 1100, y: 100 }, menuSize, viewport)).toEqual({
      left: 920,
      top: 100,
    });
  });

  it('clamps to the bottom of the viewport when the click is near it', () => {
    expect(computeContextMenuPosition({ x: 100, y: 780 }, menuSize, viewport)).toEqual({
      left: 100,
      top: 668,
    });
  });

  it('never places the menu above 8px even on a viewport shorter than the menu', () => {
    expect(
      computeContextMenuPosition({ x: 100, y: 50 }, { width: 180, height: 900 }, viewport),
    ).toEqual({ left: 100, top: 8 });
  });
});

describe('computeSubmenuFlip', () => {
  it('does not flip when the submenu fits to the right of its parent item', () => {
    expect(computeSubmenuFlip({ left: 100, width: 168 }, 170, 1200)).toBe(false);
  });

  it('flips when the submenu would run past the right edge of the viewport', () => {
    expect(computeSubmenuFlip({ left: 900, width: 168 }, 170, 1200)).toBe(true);
  });

  it('treats the 8px margin the same as computeContextMenuPosition', () => {
    // 900 + 168 + 170 === 1238 === viewport 1246 - 8: exactly on the boundary, not past it.
    expect(computeSubmenuFlip({ left: 900, width: 168 }, 170, 1246)).toBe(false);
  });
});
