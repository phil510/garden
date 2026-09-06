import { describe, expect, it } from 'vitest';
import { placeOnStage } from './placeOnStage.js';

describe('placeOnStage', () => {
  it('fills the first empty slot', () => {
    expect(placeOnStage([null, 'b', null], 1, 'a')).toEqual({
      slots: ['a', 'b', null],
      focusedSlot: 0,
    });
  });

  it('replaces the focused slot when the stage is full', () => {
    expect(placeOnStage(['a', 'b', 'c'], 2, 'd')).toEqual({
      slots: ['a', 'b', 'd'],
      focusedSlot: 2,
    });
  });

  it('refocuses a session already on stage instead of duplicating it', () => {
    expect(placeOnStage(['a', 'b', null], 0, 'b')).toEqual({
      slots: ['a', 'b', null],
      focusedSlot: 1,
    });
  });

  it('leaves a single-slot stage alone when reselecting its only occupant', () => {
    expect(placeOnStage(['a'], 0, 'a')).toEqual({ slots: ['a'], focusedSlot: 0 });
  });
});
