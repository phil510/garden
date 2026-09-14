import { describe, expect, it } from 'vitest';
import { groupIdsFromSlots, resolveRowMirror } from './mirrorRows';

describe('resolveRowMirror', () => {
  it('returns null when neither row changed since the last observation', () => {
    expect(resolveRowMirror([300, 700], [400, 600], [300, 700], [400, 600])).toBeNull();
  });

  it('mirrors the top row onto the bottom when only the top row changed', () => {
    expect(resolveRowMirror([300, 700], [400, 600], [400, 600], [400, 600])).toEqual({
      target: 'bottom',
      widths: [300, 700],
    });
  });

  it('mirrors the bottom row onto the top when only the bottom row changed', () => {
    expect(resolveRowMirror([400, 600], [250, 750], [400, 600], [400, 600])).toEqual({
      target: 'top',
      widths: [250, 750],
    });
  });

  it('does nothing when both rows changed at once', () => {
    expect(resolveRowMirror([300, 700], [200, 800], [400, 600], [400, 600])).toBeNull();
  });

  it('does nothing for a height-only change that leaves a lopsided legacy layout untouched', () => {
    // The rows already differ here (a pre-fix persisted layout), but neither row's own widths
    // moved since the last observation — e.g. the row-height divider was dragged instead. See
    // `resolveRowMirror`'s doc comment for why that stays inert.
    expect(resolveRowMirror([300, 700], [500, 500], [300, 700], [500, 500])).toBeNull();
  });
});

describe('groupIdsFromSlots', () => {
  it('returns the four group ids in [top-left, top-right, bottom-left, bottom-right] order', () => {
    expect(groupIdsFromSlots(['a', 'b', 'c', 'd'])).toEqual([
      'group-a',
      'group-b',
      'group-c',
      'group-d',
    ]);
  });

  it('falls back to the empty-slot convention for a null slot', () => {
    expect(groupIdsFromSlots(['a', null, 'c', 'd'])).toEqual([
      'group-a',
      'group-empty-slot-1',
      'group-c',
      'group-d',
    ]);
  });
});
