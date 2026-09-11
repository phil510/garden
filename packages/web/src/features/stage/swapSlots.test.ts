import { describe, expect, it } from 'vitest';
import { swapSlots } from './swapSlots';

describe('swapSlots', () => {
  it('swaps two occupied slots', () => {
    expect(swapSlots(['a', 'b', null, null], 'a', 1)).toEqual({
      slots: ['b', 'a', null, null],
      focusedSlot: 1,
    });
  });

  it('moves a session into an empty slot and empties the origin', () => {
    expect(swapSlots(['a', null, null, null], 'a', 2)).toEqual({
      slots: [null, null, 'a', null],
      focusedSlot: 2,
    });
  });

  it('focuses the dragged session at its new slot', () => {
    const result = swapSlots(['a', 'b'], 'b', 0);
    expect(result.focusedSlot).toBe(0);
  });

  it('is a no-op when dropped on its own current slot', () => {
    const slots = ['a', 'b', null, null];
    const result = swapSlots(slots, 'a', 0);
    expect(result).toEqual({ slots: ['a', 'b', null, null], focusedSlot: 0 });
    expect(result.slots).not.toBe(slots);
  });

  it('is a no-op when the dragged id is not present in slots', () => {
    const slots = ['a', 'b', null, null];
    const result = swapSlots(slots, 'z', 2);
    expect(result).toEqual({ slots: ['a', 'b', null, null], focusedSlot: 2 });
    expect(result.slots).not.toBe(slots);
  });
});
