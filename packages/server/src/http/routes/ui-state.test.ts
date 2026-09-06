import type { UiState, UiStateRequest } from '@garden/shared';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Projection } from '../../app/projection.js';
import { uiStateRoutes } from './ui-state.js';
import type { UiStateDeps } from './ui-state.js';

const baseUiState: UiState = {
  hideDead: false,
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  preset: 'single',
  slots: [null],
  focusedSlot: 0,
};

function fakeProjection(overrides: Partial<Projection> = {}): Projection {
  return {
    sessions: () => [],
    uiState: () => baseUiState,
    dispatch: () => undefined,
    updateUiState: () => undefined,
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    ...overrides,
  };
}

function buildApp(deps: UiStateDeps) {
  const app = Fastify();
  app.register((instance) => uiStateRoutes(instance, deps));
  return app;
}

describe('PUT /ui-state', () => {
  it('rejects a body with a field of the wrong type', async () => {
    const calls: UiStateRequest[] = [];
    const app = buildApp({
      projection: fakeProjection({
        updateUiState: (patch) => {
          calls.push(patch);
        },
      }),
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/ui-state',
      payload: { hideDead: 'yes' },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('rejects an unknown preset', async () => {
    const app = buildApp({ projection: fakeProjection() });

    const response = await app.inject({
      method: 'PUT',
      url: '/ui-state',
      payload: { preset: 'two-side' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('forwards a valid partial patch to the projection and answers ok', async () => {
    const calls: UiStateRequest[] = [];
    const app = buildApp({
      projection: fakeProjection({
        updateUiState: (patch) => {
          calls.push(patch);
        },
      }),
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/ui-state',
      payload: { hideDead: true, focusedSlot: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ hideDead: true, focusedSlot: 1 }]);
  });

  it('maps a failing store write to a 500', async () => {
    const app = buildApp({
      projection: fakeProjection({
        updateUiState: () => {
          throw new Error('EACCES');
        },
      }),
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/ui-state',
      payload: { hideDead: true },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'EACCES' });
  });
});
