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
        alerts: [],
        digests: [],
        pipes: {},
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

  it('loads a watch without an error reason, and keeps one that has it', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const errored = { ...watch, id: 'e', status: 'error', errorReason: 'gh is not logged in.' };
      const bad = { ...watch, id: 'bad', status: 'error', errorReason: 5 };
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(file([watch, errored, bad])));

      const state = readOverlayState(appDir, collectingLogger());

      expect(state.watches.map((w) => [w.id, w.errorReason])).toEqual([
        ['w1', undefined],
        ['e', 'gh is not logged in.'],
      ]);
    });
  });

  it('keeps a watch with ignored checks and drops one whose ignoredChecks is malformed', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const ignoring = { ...watch, id: 'i', ignoredChecks: ['cve-scan'] };
      const bad = { ...watch, id: 'bad', ignoredChecks: 'cve-scan' };
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(file([watch, ignoring, bad])));

      const state = readOverlayState(appDir, collectingLogger());

      expect(state.watches.map((w) => [w.id, w.ignoredChecks])).toEqual([
        ['w1', undefined],
        ['i', ['cve-scan']],
      ]);
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

describe('readOverlayState alerts', () => {
  const alert = { sessionId: 'session-1', text: 'stuck', raisedAt: 100, updatedAt: 200 };
  const file = (alerts?: unknown) => ({
    version: 1,
    tmuxNames: { 'session-1': 'garden-project' },
    groups: {},
    stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
    ...(alerts === undefined ? {} : { alerts }),
  });
  const read = (contents: unknown) => {
    const logger = collectingLogger();
    let state = DEFAULT_OVERLAY_STATE;
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(contents));
      state = readOverlayState(appDir, logger);
    });
    return { state, logger };
  };

  it('keeps tmux names and loads no alerts from a file written before alerts existed', () => {
    const { state, logger } = read(file());
    expect(state.alerts).toEqual([]);
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toEqual([]);
  });

  it('drops a malformed alert with a warning while keeping the valid ones', () => {
    const { state, logger } = read(
      file([
        alert,
        { ...alert, sessionId: 's2', raisedAt: 'soon' },
        'junk',
        { ...alert, sessionId: 's3' },
      ]),
    );
    expect(state.alerts.map((a) => a.sessionId)).toEqual(['session-1', 's3']);
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toHaveLength(2);
  });

  it('warns and returns the defaults when alerts is present but not an array', () => {
    const { state, logger } = read(file({ s1: alert }));
    expect(state).toEqual(DEFAULT_OVERLAY_STATE);
    expect(logger.warnings).toHaveLength(1);
  });
});

describe('readOverlayState pipes', () => {
  const file = (pipes: unknown) => ({
    version: 1,
    tmuxNames: { 'session-1': 'garden-project' },
    groups: {},
    stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
    pipes,
  });
  const read = (contents: unknown) => {
    const logger = collectingLogger();
    let state = DEFAULT_OVERLAY_STATE;
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(contents));
      state = readOverlayState(appDir, logger);
    });
    return { state, logger };
  };

  it('loads no pipe times from a file written before they existed', () => {
    const legacy: Record<string, unknown> = file({});
    delete legacy['pipes'];
    const { state, logger } = read(legacy);
    expect(state.pipes).toEqual({});
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toEqual([]);
  });

  it('round-trips pipe times through a write', () => {
    withTempAppDir((appDir) => {
      const state: OverlayState = { ...DEFAULT_OVERLAY_STATE, pipes: { 'session-1': 1234 } };
      writeOverlayState(appDir, state);
      expect(readOverlayState(appDir, collectingLogger())).toEqual(state);
    });
  });

  it('drops a malformed entry with a warning while keeping the rest', () => {
    const { state, logger } = read(file({ good: 5, text: 'soon', nothing: null }));
    expect(state.pipes).toEqual({ good: 5 });
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toHaveLength(2);
  });
});

describe('readOverlayState digests', () => {
  const items = {
    reviews: [],
    issueComments: [],
    reviewComments: [],
    checkRuns: [],
    statuses: [],
    conflicts: [],
  };
  const detail = {
    id: 'd1',
    repo: 'acme/widgets',
    pr: 7,
    line: '#7 acme/widgets: [digest d1] 1 comment',
    createdAt: '2026-01-01T00:00:00.000Z',
    replaces: null,
    atMint: { headSha: 'sha1', mergeable: true },
    closed: null,
    items,
  };
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
  const file = (extra: Record<string, unknown>) => ({
    version: 1,
    tmuxNames: { 'session-1': 'garden-project' },
    groups: {},
    stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
    ...extra,
  });
  const read = (contents: unknown) => {
    const logger = collectingLogger();
    let state: OverlayState | undefined;
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'state.json'), JSON.stringify(contents));
      state = readOverlayState(appDir, logger);
    });
    if (state === undefined) throw new Error('not read');
    return { state, logger };
  };

  it('reads no digests from a file written before they existed', () => {
    const { state, logger } = read(file({}));

    expect(state.digests).toEqual([]);
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toEqual([]);
  });

  it('round-trips archived digests and a pending digest that carries a detail', () => {
    withTempAppDir((appDir) => {
      const state: OverlayState = {
        ...DEFAULT_OVERLAY_STATE,
        watches: [
          { ...watch, pendingDigest: { id: 'd1', line: detail.line, createdAt: 5, detail } },
        ] as unknown as OverlayState['watches'],
        digests: [{ sessionId: 'session-1', detail }],
      };
      writeOverlayState(appDir, state);

      expect(readOverlayState(appDir, collectingLogger())).toEqual(state);
    });
  });

  it('keeps a watch whose pending digest has no detail', () => {
    const { state } = read(
      file({ watches: [{ ...watch, pendingDigest: { id: 'd1', line: 'x', createdAt: 5 } }] }),
    );

    expect(state.watches.map((w) => w.pendingDigest?.id)).toEqual(['d1']);
  });

  it('strips a malformed detail from a pending digest and keeps the watch', () => {
    const { state } = read(
      file({
        watches: [
          {
            ...watch,
            pendingDigest: {
              id: 'd1',
              line: 'x',
              createdAt: 5,
              detail: { ...detail, items: { reviews: [] } },
            },
          },
        ],
      }),
    );

    expect(state.watches).toHaveLength(1);
    expect(state.watches[0]?.pendingDigest).toEqual({ id: 'd1', line: 'x', createdAt: 5 });
  });

  it('drops a malformed digest record with a warning while keeping the rest', () => {
    const { state, logger } = read(
      file({
        digests: [
          { sessionId: 'session-1', detail },
          { sessionId: 'session-1', detail: { ...detail, items: { reviews: [] } } },
          { detail },
          'junk',
        ],
      }),
    );

    expect(state.digests.map((r) => r.detail.id)).toEqual(['d1']);
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toHaveLength(3);
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
        alerts: [{ sessionId: 'session-1', text: 'stuck\non CI', raisedAt: 400, updatedAt: 500 }],
        digests: [],
        pipes: { 'session-1': 300 },
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
