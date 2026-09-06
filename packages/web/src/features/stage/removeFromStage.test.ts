import { describe, expect, it } from 'vitest';
import { removeFromStage } from './removeFromStage';

describe('removeFromStage', () => {
  it('clears the session out of its slot', () => {
    expect(removeFromStage(['a', 'b', null, null], 0, 'b')).toEqual({
      slots: ['a', null, null, null],
      focusedSlot: 0,
    });
  });

  it('leaves focus untouched even when the closed slot was focused', () => {
    expect(removeFromStage(['a', 'b'], 1, 'b')).toEqual({
      slots: ['a', null],
      focusedSlot: 1,
    });
  });

  it('is a no-op when the session is not on stage', () => {
    const slots = ['a', null];
    const result = removeFromStage(slots, 0, 'z');
    expect(result).toEqual({ slots: ['a', null], focusedSlot: 0 });
    expect(result.slots).not.toBe(slots);
  });
});
