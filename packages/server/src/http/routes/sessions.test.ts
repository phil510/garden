import { aSession } from '@garden/shared/fixtures';
import type { SessionsFilter, SessionState } from '@garden/shared';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { OverlayState, StorePort, TmuxNewSessionRequest, TmuxPort } from '../../app/ports.js';
import type { Projection } from '../../app/projection.js';
import type { SessionsDeps } from '../../app/sessions.js';
import { sessionRoutes } from './sessions.js';

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  hideDead: false,
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
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
  };
}

function buildApp(deps: SessionsDeps) {
  const app = Fastify();
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=0.5' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a status value outside the four Status literals with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      claudeCommand: ['claude'],
    });

    const response = await app.inject({ method: 'GET', url: '/sessions?status=bogus' });

    expect(response.statusCode).toBe(400);
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
      claudeCommand: ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('creates a session and answers with its id and tmux name', async () => {
    const app = buildApp({
      tmux: fakeTmux({ newSession: () => Promise.resolve() }),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      claudeCommand: ['claude'],
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

  it('maps a tmux failure to a 500 rather than a 404', async () => {
    const app = buildApp({
      tmux: fakeTmux({ newSession: () => Promise.reject(new Error('tmux is not installed')) }),
      store: fakeStore(),
      projection: fakeProjection(),
      serverPort: 4310,
      settingsPath,
      claudeCommand: ['claude'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'tmux is not installed' });
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
      claudeCommand: ['claude'],
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
      claudeCommand: ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions/sid-1/resume' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'sid-1', tmuxName: 'garden' });
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
      claudeCommand: ['claude'],
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
        hideDead: false,
        groups: {},
        stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
      }),
      projection: fakeProjection([session]),
      serverPort: 4310,
      settingsPath,
      claudeCommand: ['claude'],
    });

    const response = await app.inject({ method: 'POST', url: '/sessions/sid-1/kill' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
