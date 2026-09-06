import { describe, expect, it } from 'vitest';
import { computeHoverCardPosition } from './hoverCardPosition';

const viewport = { width: 1200, height: 800 };

describe('computeHoverCardPosition', () => {
  it('anchors to the right of the row when there is room', () => {
    const anchor = { left: 20, right: 280, top: 100 };
    expect(computeHoverCardPosition(anchor, 120, viewport)).toEqual({ left: 288, top: 100 });
  });

  it('flips to the left of the row when the card would run past the right edge', () => {
    const anchor = { left: 1000, right: 1190, top: 100 };
    expect(computeHoverCardPosition(anchor, 120, viewport)).toEqual({ left: 712, top: 100 });
  });

  it('clamps to the bottom of the viewport when the row is near it', () => {
    const anchor = { left: 20, right: 280, top: 780 };
    expect(computeHoverCardPosition(anchor, 120, viewport)).toEqual({ left: 288, top: 668 });
  });

  it('never places the card above 8px even on a viewport shorter than the card', () => {
    const anchor = { left: 20, right: 280, top: 50 };
    expect(computeHoverCardPosition(anchor, 900, viewport)).toEqual({ left: 288, top: 8 });
  });
});
