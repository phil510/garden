import { DEFAULT_UI_STATE } from '@garden/shared';
import type { ReviewItem } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { TmuxNewSessionRequest } from '../../app/ports.js';
import type { Projection } from '../../app/projection.js';
import { createReviewSessions } from '../../app/reviewSessions.js';
import { createReviewStore } from '../../app/reviews.js';
import { memoryOverlay } from '../../app/reviews.fixture.js';
import { createApp } from '../server.js';
import { reviewRoutes } from './reviews.js';

const aReview = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  key: 'acme/widgets#7',
  repo: 'acme/widgets',
  number: 7,
  title: 'Add widgets',
  author: 'octocat',
  url: 'https://github.com/acme/widgets/pull/7',
  draft: false,
  updatedAt: '2026-01-10T00:00:00Z',
  clonePath: '/r/widgets',
  sessionId: null,
  ...overrides,
});

function buildApp(items: ReviewItem[]) {
  const spawned: TmuxNewSessionRequest[] = [];
  const unused = () => {
    throw new Error('not used by this test');
  };
  const projection: Projection = {
    sessions: () => [],
    uiState: () => DEFAULT_UI_STATE,
    dispatch: () => undefined,
    updateUiState: unused,
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    overlay: unused,
    updateOverlay: unused,
    subscribeOverlay: () => () => undefined,
    placementOf: () => undefined,
  };
  const reviews = createReviewStore({ overlay: memoryOverlay() });
  reviews.complete(items, '2026-01-10T00:05:00Z');
  const sessions = createReviewSessions({
    tmux: {
      listPanes: () => Promise.resolve([]),
      newSession: (request) => {
        spawned.push(request);
        return Promise.resolve();
      },
      respawnPane: () => Promise.reject(new Error('not used by this test')),
      killSession: () => Promise.reject(new Error('not used by this test')),
    },
    projection,
    serverPort: 4310,
    settingsPath: '/home/.garden/claude-settings.json',
    readClaudeCommand: () => ['claude'],
    reviews,
  });
  const app = createApp();
  app.register((instance) => reviewRoutes(instance, sessions));
  return { app, spawned };
}

const post = (app: ReturnType<typeof buildApp>['app'], url: string, payload?: object) =>
  app.inject({ method: 'POST', url, ...(payload === undefined ? {} : { payload }) });

describe('POST /reviews/:owner/:name/:number/session', () => {
  it('starts a session and answers with its id', async () => {
    const { app, spawned } = buildApp([aReview()]);
    const response = await post(app, '/reviews/acme/widgets/7/session');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ sessionId: string }>().sessionId).toBe(spawned[0]?.sessionId);
  });

  it('answers 404 for a request that is not queued', async () => {
    const { app } = buildApp([aReview()]);
    expect((await post(app, '/reviews/acme/widgets/8/session')).statusCode).toBe(404);
  });

  it('answers 409 and starts nothing when there is no local clone', async () => {
    const { app, spawned } = buildApp([aReview({ clonePath: null })]);
    expect((await post(app, '/reviews/acme/widgets/7/session')).statusCode).toBe(409);
    expect(spawned).toEqual([]);
  });

  it('answers 400 for a number that is not a positive integer', async () => {
    const { app } = buildApp([aReview()]);
    for (const number of ['abc', '0', '-1', '7.5'])
      expect((await post(app, `/reviews/acme/widgets/${number}/session`)).statusCode).toBe(400);
  });

  it('ignores a cwd in the body', async () => {
    const { app, spawned } = buildApp([aReview()]);
    await post(app, '/reviews/acme/widgets/7/session', { cwd: '/etc' });
    expect(spawned.map((request) => request.cwd)).toEqual(['/r/widgets']);
  });
});
