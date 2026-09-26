import { describe, expect, it } from 'vitest';
import { computeContextMenuPosition } from './contextMenuPosition';

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
