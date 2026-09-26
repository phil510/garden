import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Logger, OverlayState } from '../../app/ports.js';
import type { Projection } from '../../app/projection.js';
import { SessionNotFoundError } from '../../app/sessions.js';
import { CrossSwarmHandoffError, SwarmCycleError, SwarmNotFoundError } from '../../app/swarms.js';
import type { SwarmsDeps } from '../../app/swarms.js';
import { swarmRoutes } from './swarms.js';

const noopLogger: Logger = { warn: () => undefined, error: () => undefined };

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
  swarms: [],
  placements: {},
};

function fakeProjection(overrides: Partial<Projection> = {}): Projection {
  return {
    sessions: () => [],
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: () => {
      throw new Error('not used by this test');
    },
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    updateOverlay: () => {
      throw new Error('not used by this test');
    },
    placementOf: () => {
      throw new Error('not used by this test');
    },
    ...overrides,
  };
}

function buildApp(deps: SwarmsDeps, logger: Logger = noopLogger) {
  const app = Fastify();
  app.register((instance) => swarmRoutes(instance, deps, logger));
  return app;
}

describe('POST /swarms', () => {
  it('rejects a body with no name', async () => {
    const app = buildApp({ projection: fakeProjection() });
    const response = await app.inject({ method: 'POST', url: '/swarms', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('forwards a valid body and answers 201 with the new id', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: (mutate) => mutate(emptyOverlay),
      }),
    });
    const response = await app.inject({ method: 'POST', url: '/swarms', payload: { name: 'A' } });
    expect(response.statusCode).toBe(201);
    const body: unknown = response.json();
    expect(typeof (body as { id: unknown }).id).toBe('string');
  });
});

describe('PATCH /swarms/:id', () => {
  it('rejects a body with no name', async () => {
    const app = buildApp({ projection: fakeProjection() });
    const response = await app.inject({ method: 'PATCH', url: '/swarms/s1', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('maps SwarmNotFoundError to 404', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new SwarmNotFoundError('no such swarm: s1');
        },
      }),
    });
    const response = await app.inject({
      method: 'PATCH',
      url: '/swarms/s1',
      payload: { name: 'A' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /swarms/:id/archive', () => {
  it('answers ok on success', async () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'A', archived: false }],
    };
    const app = buildApp({
      projection: fakeProjection({ updateOverlay: (mutate) => mutate(overlay) }),
    });
    const response = await app.inject({ method: 'POST', url: '/swarms/s1/archive' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('maps SwarmNotFoundError to 404', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new SwarmNotFoundError('no such swarm: s1');
        },
      }),
    });
    const response = await app.inject({ method: 'POST', url: '/swarms/s1/archive' });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /swarms/:id/unarchive', () => {
  it('answers ok on success', async () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'A', archived: true }],
    };
    const app = buildApp({
      projection: fakeProjection({ updateOverlay: (mutate) => mutate(overlay) }),
    });
    const response = await app.inject({ method: 'POST', url: '/swarms/s1/unarchive' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('maps SwarmNotFoundError to 404', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new SwarmNotFoundError('no such swarm: s1');
        },
      }),
    });
    const response = await app.inject({ method: 'POST', url: '/swarms/s1/unarchive' });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /swarms/:id', () => {
  it('answers ok on success', async () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'A', archived: false }],
    };
    const app = buildApp({
      projection: fakeProjection({ updateOverlay: (mutate) => mutate(overlay) }),
    });
    const response = await app.inject({ method: 'DELETE', url: '/swarms/s1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('maps SwarmNotFoundError to 404', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new SwarmNotFoundError('no such swarm: s1');
        },
      }),
    });
    const response = await app.inject({ method: 'DELETE', url: '/swarms/s1' });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /sessions/:id/placement', () => {
  it('rejects an invalid placement shape', async () => {
    const app = buildApp({ projection: fakeProjection() });
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/a/placement',
      payload: { placement: { type: 'swarm' } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('forwards a valid parent placement and answers ok', async () => {
    const overlay: OverlayState = { ...emptyOverlay, tmuxNames: { a: 'garden-a', b: 'garden-b' } };
    const app = buildApp({
      projection: fakeProjection({ updateOverlay: (mutate) => mutate(overlay) }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/a/placement',
      payload: { placement: { type: 'parent', parentId: 'b' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('maps SessionNotFoundError to 404', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new SessionNotFoundError('no such session: a');
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/a/placement',
      payload: { placement: { type: 'none' } },
    });
    expect(response.statusCode).toBe(404);
  });

  it('maps SwarmCycleError to 409', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new SwarmCycleError('would create a cycle');
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/a/placement',
      payload: { placement: { type: 'parent', parentId: 'b' } },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('POST /sessions/:id/handoff', () => {
  it('rejects a body with no "to"', async () => {
    const app = buildApp({ projection: fakeProjection() });
    const response = await app.inject({ method: 'POST', url: '/sessions/a/handoff', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('forwards a valid body and answers ok', async () => {
    const overlay: OverlayState = { ...emptyOverlay, tmuxNames: { a: 'garden-a', b: 'garden-b' } };
    const app = buildApp({
      projection: fakeProjection({ updateOverlay: (mutate) => mutate(overlay) }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/a/handoff',
      payload: { to: 'b' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('maps CrossSwarmHandoffError to 409', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new CrossSwarmHandoffError('different swarm');
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/a/handoff',
      payload: { to: 'b' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('maps SessionNotFoundError to 404', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateOverlay: () => {
          throw new SessionNotFoundError('no such session: a');
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/a/handoff',
      payload: { to: 'b' },
    });
    expect(response.statusCode).toBe(404);
  });
});
