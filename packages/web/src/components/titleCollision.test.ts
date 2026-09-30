import { describe, expect, it } from 'vitest';
import { titleCollides } from './titleCollision';

describe('titleCollides', () => {
  const bar = 500;
  const title = 60;
  const gap = 16;

  it('is clear when neighbours end well before and start well after the title', () => {
    expect(
      titleCollides(
        bar,
        title,
        [
          { left: 0, right: 200 },
          { left: 800, right: 1000 },
        ],
        gap,
      ),
    ).toBe(false);
  });

  it('collides when a neighbour comes within the gap of the title', () => {
    // title spans 470..530, so the gap-padded span is 454..546
    expect(titleCollides(bar, title, [{ left: 0, right: 455 }], gap)).toBe(true);
    expect(titleCollides(bar, title, [{ left: 545, right: 900 }], gap)).toBe(true);
  });

  it('is clear when a neighbour sits exactly at the gap', () => {
    expect(titleCollides(bar, title, [{ left: 0, right: 454 }], gap)).toBe(false);
    expect(titleCollides(bar, title, [{ left: 546, right: 900 }], gap)).toBe(false);
  });

  it('considers the wider side even when the other side is clear', () => {
    expect(
      titleCollides(
        bar,
        title,
        [
          { left: 0, right: 100 },
          { left: 520, right: 600 },
        ],
        gap,
      ),
    ).toBe(true);
  });

  it('is clear with no neighbours', () => {
    expect(titleCollides(bar, title, [], gap)).toBe(false);
  });
});
