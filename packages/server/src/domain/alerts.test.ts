import { describe, expect, it } from 'vitest';
import { raiseAlert } from './alerts.js';

describe('raiseAlert', () => {
  it('stamps a first alert as raised and updated now', () => {
    expect(raiseAlert(null, 'stuck', 100)).toEqual({
      text: 'stuck',
      raisedAt: 100,
      updatedAt: 100,
    });
  });

  it('replaces the text and bumps updatedAt while keeping raisedAt', () => {
    const prev = { text: 'first\nsecond', raisedAt: 100, updatedAt: 150 };
    expect(raiseAlert(prev, 'new', 200)).toEqual({ text: 'new', raisedAt: 100, updatedAt: 200 });
  });
});
