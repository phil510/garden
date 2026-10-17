import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import type { OverlayState } from '../../app/ports.js';
import type { Projection } from '../../app/projection.js';
import type { WatchesDeps } from '../../app/watches.js';
import { createApp } from '../server.js';
import { watchRoutes } from './watches.js';

const overlay: OverlayState = {
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

const unused = () => {
  throw new Error('not used by this test');
};

function buildApp(remoteUrl: () => Promise<string | null>, watches: OverlayState['watches'] = []) {
  const projection: Projection = {
    sessions: () => [aSession({ id: 's1', cwd: '/work/s1' })],
    uiState: unused,
    dispatch: () => undefined,
    updateUiState: unused,
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    overlay: () => ({ ...overlay, watches }),
    updateOverlay: (mutate) => mutate({ ...overlay, watches }),
    subscribeOverlay: () => () => undefined,
    placementOf: unused,
  };
  const deps: WatchesDeps = { projection, git: { remoteUrl } };
  const app = createApp();
  app.register((instance) => watchRoutes(instance, deps));
  return app;
}

const origin = () => Promise.resolve('git@github.com:acme/widgets.git');

describe('GET /sessions/:id/watches', () => {
  it('lists the session watches', async () => {
    const response = await buildApp(origin).inject({ method: 'GET', url: '/sessions/s1/watches' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ watches: [] });
  });

  it('answers 404 for an unknown session', async () => {
    const response = await buildApp(origin).inject({
      method: 'GET',
      url: '/sessions/nope/watches',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /sessions/:id/watches', () => {
  it('adds a watch with the repo defaulted from origin', async () => {
    const response = await buildApp(origin).inject({
      method: 'POST',
      url: '/sessions/s1/watches',
      payload: { pr: 7 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ watch: { repo: 'acme/widgets', pr: 7 } });
  });

  it.each([
    ['no pr', {}],
    ['a non-integer pr', { pr: 1.5 }],
    ['a zero pr', { pr: 0 }],
    ['a pr that is a string', { pr: '7' }],
    ['a malformed repo', { pr: 7, repo: 'nope' }],
    ['kinds that are not an array', { pr: 7, kinds: 'review' }],
    ['an unknown kind', { pr: 7, kinds: ['review', 'bogus'] }],
    ['ignoreChecks that is not an array', { pr: 7, ignoreChecks: 'build' }],
    ['an empty ignoreChecks name', { pr: 7, ignoreChecks: [''] }],
    ['unignoreChecks with a non-string', { pr: 7, unignoreChecks: [1] }],
  ])('rejects %s with 400 before reaching the use case', async (_name, payload) => {
    const response = await buildApp(() => {
      throw new Error('git must not be asked');
    }).inject({ method: 'POST', url: '/sessions/s1/watches', payload });
    expect(response.statusCode).toBe(400);
  });

  it('forwards ignoreChecks to the watch', async () => {
    const response = await buildApp(origin).inject({
      method: 'POST',
      url: '/sessions/s1/watches',
      payload: { pr: 7, ignoreChecks: ['cve-scan'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ watch: { ignoredChecks: ['cve-scan'] } });
  });

  it('maps an unresolvable repo to 400', async () => {
    const response = await buildApp(() => Promise.resolve(null)).inject({
      method: 'POST',
      url: '/sessions/s1/watches',
      payload: { pr: 7 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /sessions/:id/watches', () => {
  const watch = (repo: string) => ({
    id: repo,
    sessionId: 's1',
    repo,
    pr: 7,
    kinds: ['closed' as const],
    createdAt: 1,
    cursor: null,
    pendingDigest: null,
    status: 'active' as const,
  });

  it.each([
    ['no pr', ''],
    ['a non-numeric pr', '?pr=abc'],
    ['a zero pr', '?pr=0'],
    ['a malformed repo', '?pr=7&repo=x'],
  ])('rejects %s with 400', async (_name, query) => {
    const response = await buildApp(origin).inject({
      method: 'DELETE',
      url: `/sessions/s1/watches${query}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('removes a watch', async () => {
    const response = await buildApp(origin, [watch('acme/widgets')]).inject({
      method: 'DELETE',
      url: '/sessions/s1/watches?pr=7',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('maps a missing watch to 404', async () => {
    const response = await buildApp(origin).inject({
      method: 'DELETE',
      url: '/sessions/s1/watches?pr=7',
    });
    expect(response.statusCode).toBe(404);
  });

  it('maps a pr watched in two repos to 400', async () => {
    const response = await buildApp(origin, [watch('acme/widgets'), watch('other/repo')]).inject({
      method: 'DELETE',
      url: '/sessions/s1/watches?pr=7',
    });
    expect(response.statusCode).toBe(400);
  });
});
