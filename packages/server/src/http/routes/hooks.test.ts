import { aHookEvent } from '@garden/shared/fixtures';
import type { HookPayload } from '@garden/shared';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../../domain/types.js';
import type { Projection } from '../../app/projection.js';
import { hookRoutes } from './hooks.js';

function fakeProjection() {
  const dispatched: GardenEvent[] = [];
  const projection: Projection = {
    sessions: () => [],
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: (event) => dispatched.push(event),
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    overlay: () => {
      throw new Error('not used by this test');
    },
    updateOverlay: () => {
      throw new Error('not used by this test');
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => {
      throw new Error('not used by this test');
    },
  };
  return { projection, dispatched };
}

function buildApp(projection: Projection) {
  const app = Fastify();
  app.register((instance) => hookRoutes(instance, { projection }));
  return app;
}

describe('POST /hooks', () => {
  it('dispatches a valid payload and answers 204', async () => {
    const { projection, dispatched } = fakeProjection();
    const app = buildApp(projection);
    const payload: HookPayload = aHookEvent({ session_id: 'sid-1', hook_event_name: 'Stop' });

    const response = await app.inject({ method: 'POST', url: '/hooks', payload });

    expect(response.statusCode).toBe(204);
    expect(dispatched).toEqual([{ type: 'hook', payload }]);
  });

  it('stores a hook for a session id it has never seen, rather than rejecting it', async () => {
    const { projection, dispatched } = fakeProjection();
    const app = buildApp(projection);
    const payload: HookPayload = aHookEvent({ session_id: 'unknown-session' });

    const response = await app.inject({ method: 'POST', url: '/hooks', payload });

    expect(response.statusCode).toBe(204);
    expect(dispatched).toEqual([{ type: 'hook', payload }]);
  });

  it('rejects a body missing a required field without dispatching anything', async () => {
    const { projection, dispatched } = fakeProjection();
    const app = buildApp(projection);

    const response = await app.inject({
      method: 'POST',
      url: '/hooks',
      payload: { session_id: 'sid-1', hook_event_name: 'Stop' },
    });

    expect(response.statusCode).toBe(400);
    expect(dispatched).toEqual([]);
  });
});
