import { describe, expect, it } from 'vitest';
import { raiseAlert, withoutAlert } from './alerts.js';
import type { OverlayState } from './overlay.js';

const anOverlay = (overrides: Partial<OverlayState> = {}): OverlayState => ({
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
  watches: [],
  alerts: [],
  digests: [],
  pipes: {},
  ...overrides,
});

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

describe('withoutAlert', () => {
  it('returns the same overlay when the session has no alert', () => {
    const overlay = anOverlay();
    expect(withoutAlert(overlay, 's1')).toBe(overlay);
  });

  it("removes only the named session's alert", () => {
    const mine = { sessionId: 's1', text: 'a', raisedAt: 1, updatedAt: 1 };
    const other = { sessionId: 's2', text: 'b', raisedAt: 2, updatedAt: 2 };
    const overlay = anOverlay({ alerts: [mine, other] });
    expect(withoutAlert(overlay, 's1').alerts).toEqual([other]);
  });
});
