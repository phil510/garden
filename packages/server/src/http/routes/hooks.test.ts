import { aHookEvent } from '@garden/shared/fixtures';
import type { HookPayload } from '@garden/shared';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../../app/ports.js';
import type { Projection } from '../../app/projection.js';
import type { OverlayState } from '../../app/ports.js';
import { hookRoutes } from './hooks.js';

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
  watches: [],
  digests: [],
  pipes: {},
};

function fakeProjection() {
  const dispatched: GardenEvent[] = [];
  let overlayWrites = 0;
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
    updateOverlay: (mutate) => {
      overlayWrites += 1;
      return mutate(emptyOverlay);
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => {
      throw new Error('not used by this test');
    },
  };
  return { projection, dispatched, overlayWrites: () => overlayWrites };
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

  it('hands a clear with the garden session header to the watch writer, and ignores a missing or empty one', async () => {
    const { projection, overlayWrites } = fakeProjection();
    const app = buildApp(projection);
    const payload = aHookEvent({ hook_event_name: 'SessionStart', source: 'clear' });
    const post = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/hooks', payload, headers });

    await post({});
    await post({ 'x-garden-session': '' });
    expect(overlayWrites()).toBe(0);

    await post({ 'x-garden-session': 'garden-1' });
    expect(overlayWrites()).toBe(1);
  });
});
