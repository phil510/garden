import { aSession } from '@garden/shared/fixtures';
import type { SessionsFilter, SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type {
  Logger,
  OverlayState,
  StorePort,
  TmuxNewSessionRequest,
  TmuxPort,
} from '../../app/ports.js';
import type { Projection } from '../../app/projection.js';
import type { SessionsDeps } from '../../app/sessions.js';
import { createApp } from '../server.js';
import { sessionRoutes } from './sessions.js';

function spyLogger(): { logger: Logger; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      warn: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
    warnings,
    errors,
  };
}

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
};

function fakeTmux(overrides: Partial<TmuxPort> = {}): TmuxPort {
  return {
    listPanes: () => Promise.resolve([]),
    newSession: () => Promise.reject(new Error('not used by this test')),
    respawnPane: () => Promise.reject(new Error('not used by this test')),
    killSession: () => Promise.reject(new Error('not used by this test')),
    ...overrides,
  };
}

function fakeStore(initial: OverlayState = emptyOverlay): StorePort {
  let current = initial;
  return {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
}

/** `placementOf` defaults to "no placement" rather than throwing, since every
 *  `resumeSession` call reads it to decide whether a swarm needs unarchiving — a test with
 *  no swarms in play should not have to override it just to reach the behavior it actually
 *  exercises. */
function fakeProjection(
  sessions: SessionState[] = [],
  onSessions?: (filter: SessionsFilter | undefined) => void,
): Projection {
  return {
    sessions: (filter) => {
      onSessions?.(filter);
      return sessions;
    },
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: () => undefined,
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    updateOverlay: () => {
      throw new Error('not used by this test');
    },
    placementOf: () => undefined,
  };
}

function buildApp(deps: SessionsDeps, logger?: Logger) {
  const app = createApp(logger);
  app.register((instance) => sessionRoutes(instance, deps));
  return app;
}

const settingsPath = '/home/.garden/claude-settings.json';

describe('GET /sessions', () => {
  it('is mounted and answers with the projection sessions', async () => {
    const session = aSession({ id: 'sid-1' });
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection([session]),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessions: [session] });
  });

  it('passes an empty filter when no query params are given, leaving the 7-day/500-char defaults to the domain layer', async () => {
    let seenFilter: SessionsFilter | undefined;
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection([], (filter) => (seenFilter = filter)),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions' });

    expect(response.statusCode).toBe(200);
    expect(seenFilter).toEqual({});
  });

  it('passes explicit query params through as the filter', async () => {
    let seenFilter: SessionsFilter | undefined;
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection([], (filter) => (seenFilter = filter)),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?sinceDays=30&maxRecapChars=100&live=true&status=working',
    });

    expect(response.statusCode).toBe(200);
    expect(seenFilter).toEqual({
      sinceDays: 30,
      maxRecapChars: 100,
      live: true,
      status: 'working',
    });
  });

  it('rejects a non-numeric sinceDays with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=nope' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-numeric maxRecapChars with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=nope' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a negative sinceDays with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=-1' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a negative maxRecapChars with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=-1' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty sinceDays with a 400 rather than coercing to 0', async () => {
    // `Number('')` is `0`, which is a non-negative integer — checking the coerced result
    // alone would silently apply sinceDays: 0 instead of surfacing the caller's mistake.
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty maxRecapChars with a 400 rather than coercing to 0', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a fractional maxRecapChars with a 400', async () => {
    // A naive `Number.isFinite` boundary check lets 0.5 through: `.slice(-0.5)` truncates
    // toward zero to `.slice(-0)`, which is `.slice(0)` — the whole string, uncapped.
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=0.5' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a repeated sinceDays query key with a 400 from the boundary, not a downstream guard', async () => {
    // Fastify's default querystring parser turns a repeated key into an array at runtime,
    // even though `SessionsQuerystring` declares `sinceDays?: string | string[]` to match.
    // Asserting the error message (not just the status code) proves `narrowQueryField`
    // caught this — a field-specific message would mean some other check got lucky instead.
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=5&sinceDays=7' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'sinceDays must not be repeated' });
  });

  it('rejects a repeated maxRecapChars query key with a 400 from the boundary, not a downstream guard', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?maxRecapChars=100&maxRecapChars=200',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'maxRecapChars must not be repeated' });
  });

  it('rejects a repeated live query key with a 400 from the boundary', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?live=true&live=false' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'live must not be repeated' });
  });

  it('rejects a repeated status query key with a 400 from the boundary', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?status=working&status=idle',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'status must not be repeated' });
  });

  it('rejects a status value outside the four Status literals with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?status=bogus' });

    expect(response.statusCode).toBe(400);
  });

  it('folds swarm into the filter as swarmId', async () => {
    let seenFilter: SessionsFilter | undefined;
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection([], (filter) => (seenFilter = filter)),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?swarm=swarm-1' });

    expect(response.statusCode).toBe(200);
    expect(seenFilter).toEqual({ swarmId: 'swarm-1' });
  });

  it('rejects a repeated swarm query key with a 400 from the boundary', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?swarm=a&swarm=b',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'swarm must not be repeated' });
  });
});

describe('POST /sessions', () => {
  it('rejects a body missing cwd without touching tmux', async () => {
    const calls: TmuxNewSessionRequest[] = [];
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          calls.push(request);
          return Promise.resolve();
        },
      }),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    ['an unknown effort', { effort: 'extreme' }],
    ['an empty model', { model: '' }],
  ])('rejects %s without touching tmux', async (_label, extra) => {
    const calls: TmuxNewSessionRequest[] = [];
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          calls.push(request);
          return Promise.resolve();
        },
      }),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden', ...extra },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('passes model and effort through to the spawned command', async () => {
    const calls: TmuxNewSessionRequest[] = [];
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          calls.push(request);
          return Promise.resolve();
        },
      }),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden', model: 'opus', effort: 'high' },
    });

    expect(response.statusCode).toBe(200);
    expect(calls[0]?.command).toEqual(
      expect.arrayContaining(['--model', 'opus', '--effort', 'high']),
    );
  });

  it('creates a session and answers with its id and tmux name', async () => {
    const app = buildApp({
      tmux: fakeTmux({ newSession: () => Promise.resolve() }),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ id: string; tmuxName: string }>();
    expect(body.tmuxName).toBe('garden');
    expect(body.id).not.toBe('');
  });

  it('warns and strips unknownCaller from the wire response when callerSessionId does not resolve', async () => {
    const { logger, warnings } = spyLogger();
    const app = buildApp(
      {
        tmux: fakeTmux({ newSession: () => Promise.resolve() }),
        store: fakeStore(),
        projection: {
          ...fakeProjection(),
          updateOverlay: (mutate) => mutate(emptyOverlay),
        },
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      logger,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden', callerSessionId: 'ghost' },
    });

    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json<object>())).toEqual(['id', 'tmuxName']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown caller/);
  });

  it('maps a tmux failure to a 500 rather than a 404', async () => {
    const app = buildApp({
      tmux: fakeTmux({ newSession: () => Promise.reject(new Error('tmux is not installed')) }),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'tmux is not installed' });
  });

  it('logs a failed create through the given logger', async () => {
    const { logger, errors } = spyLogger();
    const app = buildApp(
      {
        tmux: fakeTmux({ newSession: () => Promise.reject(new Error('tmux is not installed')) }),
        store: fakeStore(),
        projection: fakeProjection(),
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      logger,
    );

    await app.inject({ method: 'POST', url: '/sessions', payload: { cwd: '/Users/dev/garden' } });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Error: tmux is not installed\n/);
  });
});

describe('POST /sessions/:id/resume', () => {
  it('maps an unknown session id to 404', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection([]),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions/nope/resume' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'no such session: nope' });
  });

  it('resumes a known session and answers with its id and tmux name', async () => {
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' });
    const app = buildApp({
      tmux: fakeTmux({
        listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
        respawnPane: () => Promise.resolve(),
      }),
      store: fakeStore(),
      projection: fakeProjection([deadSession]),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions/sid-1/resume' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'sid-1', tmuxName: 'garden' });
  });

  it('rejects an unknown effort without touching tmux', async () => {
    const respawned: unknown[] = [];
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' });
    const app = buildApp({
      tmux: fakeTmux({
        listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
        respawnPane: (request) => {
          respawned.push(request);
          return Promise.resolve();
        },
      }),
      store: fakeStore(),
      projection: fakeProjection([deadSession]),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/sid-1/resume',
      payload: { effort: 'extreme' },
    });

    expect(response.statusCode).toBe(400);
    expect(respawned).toEqual([]);
  });

  it('passes model and effort from the body to the resumed command', async () => {
    const respawned: { command: readonly string[] }[] = [];
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' });
    const app = buildApp({
      tmux: fakeTmux({
        listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
        respawnPane: (request) => {
          respawned.push(request);
          return Promise.resolve();
        },
      }),
      store: fakeStore(),
      projection: fakeProjection([deadSession]),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/sid-1/resume',
      payload: { model: 'opus', effort: 'low' },
    });

    expect(response.statusCode).toBe(200);
    expect(respawned[0]?.command).toEqual(
      expect.arrayContaining(['--model', 'opus', '--effort', 'low']),
    );
  });

  it('logs a failed resume through the given logger', async () => {
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' });
    const { logger, errors } = spyLogger();
    const app = buildApp(
      {
        tmux: fakeTmux({
          listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
          respawnPane: () => Promise.reject(new Error('tmux is not installed')),
        }),
        store: fakeStore(),
        projection: fakeProjection([deadSession]),
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      logger,
    );

    await app.inject({ method: 'POST', url: '/sessions/sid-1/resume' });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Error: tmux is not installed\n/);
  });
});

describe('POST /sessions/:id/kill', () => {
  it('maps an unknown session id to 404', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection([]),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions/nope/kill' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'no such session: nope' });
  });

  it('kills a known session and answers ok', async () => {
    const session = aSession({ id: 'sid-1', tmuxName: 'garden' });
    const app = buildApp({
      tmux: fakeTmux({ killSession: () => Promise.resolve() }),
      store: fakeStore({
        version: 1,
        tmuxNames: { 'sid-1': 'garden' },
        groups: {},
        stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
        swarms: [],
        placements: {},
        swarmOrder: [],
        collapsedSwarms: [],
        hideDeadSwarms: [],
      }),
      projection: fakeProjection([session]),
      serverPort: 4310,
      settingsPath,
      readClaudeCommand: () => ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions/sid-1/kill' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('logs a failed kill through the given logger', async () => {
    const session = aSession({ id: 'sid-1', tmuxName: 'garden' });
    const { logger, errors } = spyLogger();
    const app = buildApp(
      {
        tmux: fakeTmux({ killSession: () => Promise.reject(new Error('tmux is not installed')) }),
        store: fakeStore({
          version: 1,
          tmuxNames: { 'sid-1': 'garden' },
          groups: {},
          stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
          swarms: [],
          placements: {},
          swarmOrder: [],
          collapsedSwarms: [],
          hideDeadSwarms: [],
        }),
        projection: fakeProjection([session]),
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      logger,
    );

    await app.inject({ method: 'POST', url: '/sessions/sid-1/kill' });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Error: tmux is not installed\n/);
  });
});
