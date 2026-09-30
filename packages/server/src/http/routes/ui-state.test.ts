import type { UiState, UiStateRequest } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { Projection } from '../../app/projection.js';
import { createApp } from '../server.js';
import { uiStateRoutes } from './ui-state.js';
import type { UiStateDeps } from './ui-state.js';

const baseUiState: UiState = {
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  hideDeadRepos: [],
  preset: 'single',
  slots: [null],
  focusedSlot: 0,
  layout: null,
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
};

function fakeProjection(overrides: Partial<Projection> = {}): Projection {
  return {
    sessions: () => [],
    uiState: () => baseUiState,
    dispatch: () => undefined,
    updateUiState: () => undefined,
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

function buildApp(deps: UiStateDeps) {
  const app = createApp();
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
      payload: { hideDeadRepos: 'yes' },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('rejects a body carrying a swarms or placements key', async () => {
    const calls: UiStateRequest[] = [];
    const app = buildApp({
      projection: fakeProjection({
        updateUiState: (patch) => {
          calls.push(patch);
        },
      }),
    });

    const swarmsResponse = await app.inject({
      method: 'PUT',
      url: '/ui-state',
      payload: { swarms: [] },
    });
    const placementsResponse = await app.inject({
      method: 'PUT',
      url: '/ui-state',
      payload: { placements: {} },
    });

    expect(swarmsResponse.statusCode).toBe(400);
    expect(placementsResponse.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('rejects a body with a swarm collapse/order/hide-dead field of the wrong type', async () => {
    const calls: UiStateRequest[] = [];
    const app = buildApp({
      projection: fakeProjection({
        updateUiState: (patch) => {
          calls.push(patch);
        },
      }),
    });

    for (const payload of [
      { swarmOrder: 'swarm-1' },
      { collapsedSwarms: [1] },
      { hideDeadSwarms: 'yes' },
    ]) {
      const response = await app.inject({ method: 'PUT', url: '/ui-state', payload });
      expect(response.statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('forwards a valid swarm collapse/order/hide-dead patch to the projection', async () => {
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
      payload: {
        swarmOrder: ['swarm-1'],
        collapsedSwarms: ['swarm-1'],
        hideDeadSwarms: ['swarm-1'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        swarmOrder: ['swarm-1'],
        collapsedSwarms: ['swarm-1'],
        hideDeadSwarms: ['swarm-1'],
      },
    ]);
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

  it('rejects a focusedSlot that is not a slot index', async () => {
    const calls: UiStateRequest[] = [];
    const app = buildApp({
      projection: fakeProjection({
        updateUiState: (patch) => {
          calls.push(patch);
        },
      }),
    });

    for (const focusedSlot of [-1, 1.5]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/ui-state',
        payload: { focusedSlot },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
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
      payload: { hideDeadRepos: ['/repo'], focusedSlot: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ hideDeadRepos: ['/repo'], focusedSlot: 1 }]);
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
      payload: { hideDeadRepos: ['/repo'] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'EACCES' });
  });
});
