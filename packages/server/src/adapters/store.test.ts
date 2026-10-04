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
          `{"version":1,"tmuxNames":{},"groups":{},"stage":${stage}}`,
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

  it('defaults swarms, placements, and swarm order/collapse/hide-dead without discarding the rest of a pre-#170 file', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        join(appDir, 'state.json'),
        JSON.stringify({
          version: 1,
          tmuxNames: { 'session-1': 'garden-project' },
          groups: { '/repo': { pinned: true, order: 0, collapsed: false, hideDead: true } },
          stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
          // No swarms/placements/swarmOrder/collapsedSwarms/hideDeadSwarms keys at all —
          // a file written before #170/#187.
        }),
      );
      const logger = collectingLogger();

      expect(readOverlayState(appDir, logger)).toEqual({
        version: 1,
        tmuxNames: { 'session-1': 'garden-project' },
        groups: { '/repo': { pinned: true, order: 0, collapsed: false, hideDead: true } },
        stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
        swarms: [],
        placements: {},
        swarmOrder: [],
        collapsedSwarms: [],
        hideDeadSwarms: [],
        watches: [],
      });
      expect(logger.warnings).toEqual([]);
    });
  });

  it('warns and returns the defaults when swarms is present but malformed', () => {
    for (const swarms of ['{}', '[1]', '[{"id":"s1","name":"A"}]']) {
      withTempAppDir((appDir) => {
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(appDir, 'state.json'),
          `{"version":1,"tmuxNames":{},"groups":{},"stage":{"preset":"single","slots":[null],"focusedSlot":0,"layout":{}},"swarms":${swarms}}`,
        );
        const logger = collectingLogger();
        expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
        expect(logger.warnings).toHaveLength(1);
      });
    }
  });

  it('warns and returns the defaults when placements is present but malformed', () => {
    for (const placements of ['[]', '{"sid-1":"not-an-object"}', '{"sid-1":{"parent":1}}']) {
      withTempAppDir((appDir) => {
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(appDir, 'state.json'),
          `{"version":1,"tmuxNames":{},"groups":{},"stage":{"preset":"single","slots":[null],"focusedSlot":0,"layout":{}},"placements":${placements}}`,
        );
        const logger = collectingLogger();
        expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
        expect(logger.warnings).toHaveLength(1);
      });
    }
  });

  it('warns and returns the defaults when swarmOrder, collapsedSwarms or hideDeadSwarms is present but malformed', () => {
    for (const field of ['swarmOrder', 'collapsedSwarms', 'hideDeadSwarms']) {
      withTempAppDir((appDir) => {
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(appDir, 'state.json'),
          `{"version":1,"tmuxNames":{},"groups":{},"stage":{"preset":"single","slots":[null],"focusedSlot":0,"layout":{}},"${field}":[1]}`,
        );
        const logger = collectingLogger();
        expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
        expect(logger.warnings).toHaveLength(1);
      });
    }
  });
});

describe('readOverlayState watches', () => {
  const watch = {
    id: 'w1',
    sessionId: 'session-1',
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'closed'],
    createdAt: 100,
    cursor: null,
    pendingDigest: null,
    status: 'active',
  };
  const file = (watches: unknown) => ({
    version: 1,
    tmuxNames: { 'session-1': 'garden-project' },
    groups: {},
    stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
    watches,
  });

  it('keeps tmux names and loads no watches from a file written before watches existed', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const legacy: Record<string, unknown> = file([]);
      delete legacy['watches'];
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(legacy));
      const logger = collectingLogger();

      const state = readOverlayState(appDir, logger);

      expect(state.watches).toEqual([]);
      expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
      expect(logger.warnings).toEqual([]);
    });
  });

  it('drops one malformed watch with a warning while keeping the valid ones and the tmux names', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const bad = { ...watch, id: 'bad', status: 'sleeping' };
      const good = { ...watch, id: 'good', pr: 8 };
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(file([watch, bad, 'junk', good])));
      const logger = collectingLogger();

      const state = readOverlayState(appDir, logger);

      expect(state.watches.map((w) => w.id)).toEqual(['w1', 'good']);
      expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
      expect(logger.warnings).toHaveLength(2);
    });
  });

  it('warns and returns the defaults when watches is present but not an array', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(file({ w1: watch })));
      const logger = collectingLogger();

      expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
    });
  });
});

describe('writeOverlayState', () => {
  it('round-trips a written state, including swarms, placements and swarm order/collapse/hide-dead', () => {
    withTempAppDir((appDir) => {
      const state: OverlayState = {
        version: 1,
        tmuxNames: { 'session-1': 'garden-project' },
        groups: { '/repo': { pinned: true, order: 0, collapsed: false, hideDead: true } },
        stage: { preset: 'two-across', slots: ['session-1', null], focusedSlot: 0, layout: {} },
        swarms: [{ id: 'swarm-1', name: 'A swarm', archived: false }],
        placements: { 'session-1': { swarmId: 'swarm-1' } },
        swarmOrder: ['swarm-1'],
        collapsedSwarms: ['swarm-1'],
        hideDeadSwarms: ['swarm-1'],
        watches: [
          {
            id: 'w1',
            sessionId: 'session-1',
            repo: 'acme/widgets',
            pr: 7,
            kinds: ['review', 'closed'],
            createdAt: 100,
            cursor: { etag: 'abc', seen: [1, 2, { nested: true }] },
            pendingDigest: { id: 'd1', line: 'PR merged', createdAt: 200 },
            status: 'closed',
          },
        ],
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
      writeOverlayState(appDir, {
        ...DEFAULT_OVERLAY_STATE,
        groups: { '/repo': { pinned: false, order: 0, collapsed: false, hideDead: true } },
      });
      writeOverlayState(appDir, DEFAULT_OVERLAY_STATE);
      expect(readOverlayState(appDir, collectingLogger())).toEqual(DEFAULT_OVERLAY_STATE);
    });
  });
});
