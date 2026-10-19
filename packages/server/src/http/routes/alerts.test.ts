import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import type { AlertsDeps } from '../../app/alerts.js';
import { createProjection } from '../../app/projection.js';
import type { OverlayState, StorePort } from '../../app/ports.js';
import { createApp } from '../server.js';
import { alertRoutes } from './alerts.js';

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
  alerts: [],
  digests: [],
  pipes: {},
};

function buildApp() {
  let overlay = emptyOverlay;
  const store: StorePort = {
    read: () => overlay,
    write: (state) => {
      overlay = state;
    },
  };
  const projection = createProjection(store);
  projection.dispatch({
    type: 'session-registered',
    id: aSession().id,
    tmuxName: 'repo',
    cwd: '/work',
  });
  const deps: AlertsDeps = { projection };
  const app = createApp();
  app.register((instance) => alertRoutes(instance, deps));
  return app;
}

const url = `/sessions/${aSession().id}/alert`;

describe('POST /sessions/:id/alert', () => {
  it('raises an alert and answers it', async () => {
    const response = await buildApp().inject({ method: 'POST', url, payload: { text: 'stuck' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ alert: { text: 'stuck' } });
  });

  it('rejects a body whose text is missing, not a string, or blank', async () => {
    for (const payload of [{}, { text: 5 }, { text: '  \n' }]) {
      const response = await buildApp().inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(400);
    }
  });

  it('answers 404 for an unknown session', async () => {
    const response = await buildApp().inject({
      method: 'POST',
      url: '/sessions/nope/alert',
      payload: { text: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /sessions/:id/alert', () => {
  it('clears the alert and answers ok', async () => {
    const response = await buildApp().inject({ method: 'DELETE', url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('answers 404 for an unknown session', async () => {
    const response = await buildApp().inject({ method: 'DELETE', url: '/sessions/nope/alert' });
    expect(response.statusCode).toBe(404);
  });
});
