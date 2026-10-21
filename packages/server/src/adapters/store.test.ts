import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_UI_STATE } from '@garden/shared';
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

function readContents(contents: unknown): { state: OverlayState; logger: { warnings: string[] } } {
  const logger = collectingLogger();
  let state: OverlayState | undefined;
  withTempAppDir((appDir) => {
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, 'state.json'),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );
    state = readOverlayState(appDir, logger);
  });
  if (state === undefined) throw new Error('not read');
  return { state, logger };
}

function without(value: object, ...keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

const stage = { preset: 'single', slots: [null], focusedSlot: 0, layout: {} };
const v1Base = { version: 1, tmuxNames: {}, groups: {}, stage };

describe('readOverlayState', () => {
  it('warns and returns the defaults when state.json parses but is not an overlay', () => {
    const contents = [
      'null',
      '[]',
      '{}',
      '{"version":3,"tmuxNames":{},"ui":{}}',
      '{"version":2,"tmuxNames":{}}',
      '{"version":2,"tmuxNames":{},"ui":[]}',
      '{"version":2,"ui":{}}',
      '{"version":2,"tmuxNames":{},"ui":{},"watches":{}}',
    ];
    for (const text of contents) {
      const { state, logger } = readContents(text);
      expect(state).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
    }
  });

  it('warns rather than discarding silently when state.json is unparseable', () => {
    const { state, logger } = readContents('{ not json');
    expect(state).toEqual(DEFAULT_OVERLAY_STATE);
    expect(logger.warnings).toHaveLength(1);
  });

  it('returns the defaults when state.json does not exist', () => {
    withTempAppDir((appDir) => {
      const logger = collectingLogger();
      expect(readOverlayState(appDir, logger)).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toEqual([]);
    });
  });

  it('returns a state that shares no arrays or records with the defaults', () => {
    const { state } = readContents({ version: 2, tmuxNames: {}, ui: {} });
    expect(state.ui).toEqual(DEFAULT_UI_STATE);
    expect(state.ui.slots).not.toBe(DEFAULT_UI_STATE.slots);
    expect(state.ui.placements).not.toBe(DEFAULT_UI_STATE.placements);
  });
});

describe('readOverlayState version 2', () => {
  const ui = {
    ...DEFAULT_UI_STATE,
    groupOrder: ['/repos/b', '/repos/a'],
    pinnedRepos: ['/repos/a'],
    preset: 'two-across' as const,
    slots: ['session-1', null],
    focusedSlot: 1,
    layout: { grid: 'opaque' },
    swarms: [{ id: 'swarm-1', name: 'A swarm', archived: false }],
    placements: { 'session-1': { swarmId: 'swarm-1' } },
    swarmOrder: ['swarm-1'],
  };

  it('reads the ui as stored', () => {
    const { state, logger } = readContents({
      version: 2,
      tmuxNames: { 'session-1': 'garden-project' },
      ui,
    });
    expect(state.ui).toEqual(ui);
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toEqual([]);
  });

  it('takes the default for a ui key the file lacks, without a warning', () => {
    const partial = without(ui, 'layout', 'swarmOrder');
    const { state, logger } = readContents({
      version: 2,
      tmuxNames: { 'session-1': 'garden-project' },
      ui: partial,
    });
    expect(state.ui).toEqual({ ...ui, layout: {}, swarmOrder: [] });
    expect(logger.warnings).toEqual([]);
  });

  it('takes the default for an invalid ui key and keeps everything else, with one warning', () => {
    const { state, logger } = readContents({
      version: 2,
      tmuxNames: { 'session-1': 'garden-project' },
      ui: { ...ui, swarms: [{ id: 's1', name: 'A' }] },
    });
    expect(state.ui).toEqual({ ...ui, swarms: [] });
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('ui.swarms');
  });

  it('warns once per invalid ui key', () => {
    const invalid = {
      groupOrder: [1],
      preset: 'nope',
      slots: [1],
      focusedSlot: '0',
      placements: [],
      collapsedSwarms: [1],
    };
    const { state, logger } = readContents({ version: 2, tmuxNames: {}, ui: invalid });
    expect(state.ui).toEqual(DEFAULT_UI_STATE);
    expect(logger.warnings).toHaveLength(Object.keys(invalid).length);
  });

  it('round-trips a written state, including swarms, placements and swarm order/collapse/hide-dead', () => {
    withTempAppDir((appDir) => {
      const state: OverlayState = {
        version: 2,
        tmuxNames: { 'session-1': 'garden-project' },
        ui: {
          ...ui,
          collapsedSwarms: ['swarm-1'],
          hideDeadSwarms: ['swarm-1'],
          collapsedRepos: ['/repos/b'],
          hideDeadRepos: ['/repos/a'],
        },
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
      const logger = collectingLogger();
      expect(readOverlayState(appDir, logger)).toEqual(state);
      expect(logger.warnings).toEqual([]);
    });
  });
});

describe('readOverlayState version 1 migration', () => {
  const swarm = { id: 'swarm-1', name: 'A swarm', archived: false };
  const watch = {
    id: 'w1',
    sessionId: 'session-1',
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'closed'],
    createdAt: 100,
    cursor: { etag: 'abc' },
    pendingDigest: null,
    status: 'active',
  };
  const alert = { sessionId: 'session-1', text: 'stuck', raisedAt: 100, updatedAt: 200 };
  const digest = {
    sessionId: 'session-1',
    detail: {
      id: 'd1',
      repo: 'acme/widgets',
      pr: 7,
      line: '#7 acme/widgets: [digest d1] 1 comment',
      createdAt: '2026-01-01T00:00:00.000Z',
      replaces: null,
      atMint: { headSha: 'sha1', mergeable: true },
      closed: null,
      items: {
        reviews: [],
        issueComments: [],
        reviewComments: [],
        checkRuns: [],
        statuses: [],
        conflicts: [],
      },
    },
  };
  const full = {
    version: 1,
    tmuxNames: { 'session-1': 'garden-project' },
    groups: {
      '/repos/b': { pinned: false, order: 1, collapsed: true, hideDead: false },
      '/repos/c': { pinned: true, order: 2, collapsed: false, hideDead: false },
      '/repos/a': { pinned: true, order: 0, collapsed: false, hideDead: true },
    },
    stage: {
      preset: 'two-across',
      slots: ['session-1', null],
      focusedSlot: 1,
      layout: { grid: 'opaque' },
    },
    swarms: [swarm],
    placements: { 'session-1': { swarmId: 'swarm-1' } },
    swarmOrder: ['swarm-1'],
    collapsedSwarms: ['swarm-1'],
    hideDeadSwarms: ['swarm-1'],
    watches: [watch],
    alerts: [alert],
    digests: [digest],
    pipes: { 'session-1': 300 },
  };

  it("lifts a v1 file's stage and groups into ui and keeps every other record", () => {
    const { state, logger } = readContents(full);

    expect(state).toEqual({
      version: 2,
      tmuxNames: { 'session-1': 'garden-project' },
      ui: {
        groupOrder: ['/repos/a', '/repos/b', '/repos/c'],
        pinnedRepos: ['/repos/a', '/repos/c'],
        collapsedRepos: ['/repos/b'],
        hideDeadRepos: ['/repos/a'],
        preset: 'two-across',
        slots: ['session-1', null],
        focusedSlot: 1,
        layout: { grid: 'opaque' },
        swarms: [swarm],
        placements: { 'session-1': { swarmId: 'swarm-1' } },
        swarmOrder: ['swarm-1'],
        collapsedSwarms: ['swarm-1'],
        hideDeadSwarms: ['swarm-1'],
      },
      watches: [watch],
      alerts: [alert],
      digests: [digest],
      pipes: { 'session-1': 300 },
    });
    expect(logger.warnings).toEqual([]);
  });

  it('defaults the swarm fields of a v1 file that predates them', () => {
    const old = without(
      full,
      'swarms',
      'placements',
      'swarmOrder',
      'collapsedSwarms',
      'hideDeadSwarms',
    );
    const { state, logger } = readContents(old);

    expect(state.ui).toMatchObject({
      swarms: [],
      placements: {},
      swarmOrder: [],
      collapsedSwarms: [],
      hideDeadSwarms: [],
      preset: 'two-across',
    });
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toEqual([]);
  });

  it('defaults the layout of a v1 stage that has none', () => {
    const { state } = readContents({ ...full, stage: without(full.stage, 'layout') });

    expect(state.ui.layout).toEqual({});
  });

  it('writes a migrated file back as version 2 with a nested ui and no flat fields', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = join(appDir, 'state.json');
      writeFileSync(path, JSON.stringify(full));

      writeOverlayState(appDir, readOverlayState(appDir, collectingLogger()));

      const onDisk = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      expect(onDisk['version']).toBe(2);
      expect(onDisk['ui']).toMatchObject({
        preset: 'two-across',
        pinnedRepos: ['/repos/a', '/repos/c'],
      });
      expect(onDisk).not.toHaveProperty('groups');
      expect(onDisk).not.toHaveProperty('stage');
      expect(onDisk).not.toHaveProperty('swarms');
    });
  });

  it('leaves the file as v1 until something writes it', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = join(appDir, 'state.json');
      writeFileSync(path, JSON.stringify(full));

      readOverlayState(appDir, collectingLogger());

      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(full);
    });
  });

  it('warns and returns the defaults when a v1 overlay carries an unusable stage', () => {
    const stages = [
      {},
      { preset: 'single', slots: [null] },
      { preset: 'nope', slots: [null], focusedSlot: 0 },
    ];
    for (const bad of stages) {
      const { state, logger } = readContents({ ...v1Base, stage: bad });
      expect(state).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
    }
  });

  it('warns and returns the defaults when a v1 overlay carries an unusable group', () => {
    const groups = [[], { '/repo': 'pinned' }, { '/repo': { pinned: true, order: 'first' } }];
    for (const bad of groups) {
      const { state, logger } = readContents({ ...v1Base, groups: bad });
      expect(state).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
    }
  });

  it('warns and returns the defaults when swarms is present but malformed', () => {
    for (const swarms of [{}, [1], [{ id: 's1', name: 'A' }]]) {
      const { state, logger } = readContents({ ...v1Base, swarms });
      expect(state).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
    }
  });

  it('warns and returns the defaults when placements is present but malformed', () => {
    for (const placements of [[], { 'sid-1': 'not-an-object' }, { 'sid-1': { parent: 1 } }]) {
      const { state, logger } = readContents({ ...v1Base, placements });
      expect(state).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
    }
  });

  it('warns and returns the defaults when swarmOrder, collapsedSwarms or hideDeadSwarms is present but malformed', () => {
    for (const field of ['swarmOrder', 'collapsedSwarms', 'hideDeadSwarms']) {
      const { state, logger } = readContents({ ...v1Base, [field]: [1] });
      expect(state).toEqual(DEFAULT_OVERLAY_STATE);
      expect(logger.warnings).toHaveLength(1);
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
    version: 2,
    tmuxNames: { 'session-1': 'garden-project' },
    ui: {},
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

  it('drops a malformed watch from a v1 file the same way', () => {
    const { state, logger } = readContents({
      ...v1Base,
      tmuxNames: { 'session-1': 'garden-project' },
      watches: [watch, { ...watch, id: 'bad', status: 'sleeping' }],
    });

    expect(state.watches.map((w) => w.id)).toEqual(['w1']);
    expect(state.tmuxNames).toEqual({ 'session-1': 'garden-project' });
    expect(logger.warnings).toHaveLength(1);
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
    version: 2,
    tmuxNames: { 'session-1': 'garden-project' },
    ui: {},
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
    version: 2,
    tmuxNames: { 'session-1': 'garden-project' },
    ui: {},
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
    version: 2,
    tmuxNames: { 'session-1': 'garden-project' },
    ui: {},
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
        ui: { ...DEFAULT_UI_STATE, hideDeadRepos: ['/repo'] },
      });
      writeOverlayState(appDir, DEFAULT_OVERLAY_STATE);
      expect(readOverlayState(appDir, collectingLogger())).toEqual(DEFAULT_OVERLAY_STATE);
    });
  });
});
