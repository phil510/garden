import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_STATE, readOverlayState, writeOverlayState } from './store.js';
import type { OverlayState } from '../domain/overlay.js';

function collectingLogger(): { warn(message: string): void; warnings: string[] } {
  const warnings: string[] = [];
  return { warn: (message) => void warnings.push(message), warnings };
}

function withTempAppDir(fn: (appDir: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'garden-home-'));
  try {
    fn(join(home, '.garden'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('readOverlayState', () => {
  it('warns and returns the defaults when state.json parses but is not a version 1 overlay', () => {
    for (const contents of ['null', '[]', '{}', '{"version":2,"tmuxNames":{}}']) {
      withTempAppDir((appDir) => {
        mkdirSync(appDir, { recursive: true });
        writeFileSync(join(appDir, 'state.json'), contents);
        const logger = collectingLogger();
        expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
        expect(logger.warnings).toHaveLength(1);
      });
    }
  });

  it('warns and returns the defaults when a v1 overlay carries an unusable stage', () => {
    const stages = [
      '{}',
      '{"preset":"single","slots":[null]}',
      '{"preset":"nope","slots":[null],"focusedSlot":0}',
    ];
    for (const stage of stages) {
      withTempAppDir((appDir) => {
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(appDir, 'state.json'),
          `{"version":1,"tmuxNames":{},"hideDead":false,"groups":{},"stage":${stage}}`,
        );
        const logger = collectingLogger();
        expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
        expect(logger.warnings).toHaveLength(1);
      });
    }
  });

  it('warns rather than discarding silently when state.json is unparseable', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'state.json'), '{ not json');
      const logger = collectingLogger();
      expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
    });
  });

  it('returns the defaults when state.json does not exist', () => {
    withTempAppDir((appDir) => {
      expect(readOverlayState(appDir, collectingLogger())).toEqual(DEFAULT_OVERLAY_STATE);
    });
  });
});

describe('writeOverlayState', () => {
  it('round-trips a written state', () => {
    withTempAppDir((appDir) => {
      const state: OverlayState = {
        version: 1,
        tmuxNames: { 'session-1': 'garden-project' },
        hideDead: true,
        groups: { '/repo': { pinned: true, order: 0, collapsed: false } },
        stage: { preset: 'two-across', slots: ['session-1', null], focusedSlot: 0, layout: {} },
      };
      writeOverlayState(appDir, state);
      expect(readOverlayState(appDir, collectingLogger())).toEqual(state);
    });
  });

  it('leaves no temp file behind after writing', () => {
    withTempAppDir((appDir) => {
      writeOverlayState(appDir, DEFAULT_OVERLAY_STATE);
      expect(existsSync(join(appDir, 'state.json.tmp'))).toBe(false);
    });
  });

  it('overwrites a previous write rather than merging with it', () => {
    withTempAppDir((appDir) => {
      writeOverlayState(appDir, { ...DEFAULT_OVERLAY_STATE, hideDead: true });
      writeOverlayState(appDir, DEFAULT_OVERLAY_STATE);
      expect(readOverlayState(appDir, collectingLogger())).toEqual(DEFAULT_OVERLAY_STATE);
    });
  });
});
