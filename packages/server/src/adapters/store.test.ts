import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_STATE, readOverlayState, writeOverlayState } from './store.js';
import type { OverlayState } from './store.js';

function withTempHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'garden-home-'));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('readOverlayState', () => {
  it('returns the defaults when state.json does not exist', () => {
    withTempHome((home) => {
      expect(readOverlayState(home)).toEqual(DEFAULT_OVERLAY_STATE);
    });
  });

  it('returns the defaults when state.json is not valid JSON', () => {
    withTempHome((home) => {
      writeOverlayState(home, DEFAULT_OVERLAY_STATE);
      writeFileSync(join(home, '.garden', 'state.json'), '{ not json', 'utf8');
      expect(readOverlayState(home)).toEqual(DEFAULT_OVERLAY_STATE);
    });
  });
});

describe('writeOverlayState', () => {
  it('round-trips a written state', () => {
    withTempHome((home) => {
      const state: OverlayState = {
        version: 1,
        tmuxNames: { 'session-1': 'garden-project' },
        hideDead: true,
        groups: { '/repo': { pinned: true, order: 0, collapsed: false } },
        stage: { preset: 'two-across', slots: ['session-1', null], focusedSlot: 0, layout: {} },
      };
      writeOverlayState(home, state);
      expect(readOverlayState(home)).toEqual(state);
    });
  });

  it('leaves no temp file behind after writing', () => {
    withTempHome((home) => {
      writeOverlayState(home, DEFAULT_OVERLAY_STATE);
      expect(existsSync(join(home, '.garden', 'state.json.tmp'))).toBe(false);
    });
  });

  it('overwrites a previous write rather than merging with it', () => {
    withTempHome((home) => {
      writeOverlayState(home, { ...DEFAULT_OVERLAY_STATE, hideDead: true });
      writeOverlayState(home, DEFAULT_OVERLAY_STATE);
      expect(readOverlayState(home)).toEqual(DEFAULT_OVERLAY_STATE);
    });
  });
});
