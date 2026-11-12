import { DEFAULT_UI_STATE } from '@garden/shared';
import { aSession } from '@garden/shared/fixtures';
import type { ReviewItem } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { DismissReviewOutcome, ReviewDismisser } from '../../app/reviewDismiss.js';
import type { TmuxNewSessionRequest } from '../../app/ports.js';
import type { Projection } from '../../app/projection.js';
import { createReviewSessions, type ReviewSessions } from '../../app/reviewSessions.js';
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

function buildApp(items: ReviewItem[], sessionIds: string[] = []) {
  const spawned: TmuxNewSessionRequest[] = [];
  const unused = () => {
    throw new Error('not used by this test');
  };
  const known = sessionIds.map((id) => aSession({ id }));
  const projection: Projection = {
    sessions: () => known,
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
  const reviews = createReviewStore({ overlay: memoryOverlay({}, known) });
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
  const reviewDismisser: ReviewDismisser = {
    dismiss: () => Promise.reject(new Error('not used by this test')),
  };
  app.register((instance) => reviewRoutes(instance, { sessions, reviewDismisser, reviews }));
  return { app, spawned, reviews };
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

describe('GET /reviews', () => {
  it('answers 200 with the queue, its fault and polledAt', async () => {
    const { app, reviews } = buildApp([aReview()]);
    reviews.fail('error');
    const response = await app.inject({ method: 'GET', url: '/reviews' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ key: 'acme/widgets#7' }],
      fault: 'error',
      polledAt: '2026-01-10T00:05:00Z',
    });
  });
});

describe('POST /reviews/:owner/:name/:number/claim', () => {
  it('links the session and answers with it', async () => {
    const { app, reviews } = buildApp([aReview()], ['s1']);
    const response = await post(app, '/reviews/acme/widgets/7/claim', { sessionId: 's1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessionId: 's1', previousSessionId: null });
    expect(reviews.item('acme/widgets#7')?.sessionId).toBe('s1');
  });

  it('answers 404 for an unknown session or a request that is not queued', async () => {
    const { app, reviews } = buildApp([aReview()], ['s1']);
    expect(
      (await post(app, '/reviews/acme/widgets/7/claim', { sessionId: 'nope' })).statusCode,
    ).toBe(404);
    expect((await post(app, '/reviews/acme/widgets/8/claim', { sessionId: 's1' })).statusCode).toBe(
      404,
    );
    expect(reviews.item('acme/widgets#7')?.sessionId).toBeNull();
  });

  it('answers 400 for a number that is not a positive integer', async () => {
    const { app } = buildApp([aReview()], ['s1']);
    expect((await post(app, '/reviews/acme/widgets/0/claim', { sessionId: 's1' })).statusCode).toBe(
      400,
    );
  });

  it.each([undefined, {}, { sessionId: '' }, { sessionId: 3 }])(
    'answers 400 for the body %j',
    async (payload) => {
      const { app } = buildApp([aReview()], ['s1']);
      expect((await post(app, '/reviews/acme/widgets/7/claim', payload)).statusCode).toBe(400);
    },
  );
});

function postDismiss(url: string, outcome: DismissReviewOutcome) {
  const calls: [string, number][] = [];
  const reviewDismisser: ReviewDismisser = {
    dismiss(repo, number) {
      calls.push([repo, number]);
      return Promise.resolve(outcome);
    },
  };
  const sessions: ReviewSessions = {
    start: () => Promise.reject(new Error('not used by this test')),
    claim: () => {
      throw new Error('not used by this test');
    },
  };
  const reviews = { queue: () => createReviewStore({ overlay: memoryOverlay() }).queue() };
  const app = createApp();
  app.register((instance) => reviewRoutes(instance, { sessions, reviewDismisser, reviews }));
  return app.inject({ method: 'POST', url }).then((response) => ({ response, calls }));
}

describe('POST /reviews/:owner/:name/:number/dismiss', () => {
  it('answers 204 and hands the use case the repo and the number', async () => {
    const { response, calls } = await postDismiss('/reviews/Acme/Widgets/7/dismiss', {
      kind: 'dismissed',
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(calls).toEqual([['Acme/Widgets', 7]]);
  });

  it('answers 404 when the pull request is not in the queue', async () => {
    const { response } = await postDismiss('/reviews/acme/widgets/7/dismiss', {
      kind: 'not-found',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error');
  });

  it('answers 502 with the failure, including GitHub status when there is one', async () => {
    const { response } = await postDismiss('/reviews/acme/widgets/7/dismiss', {
      kind: 'failed',
      failure: { kind: 'error', status: 422 },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ kind: 'error', status: 422 });
  });

  it.each(['abc', '0', '-3', '1.5', '1e3'])('answers 400 for the number %s', async (number) => {
    const { response, calls } = await postDismiss(`/reviews/acme/widgets/${number}/dismiss`, {
      kind: 'dismissed',
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 400 when the use case finds the repo invalid', async () => {
    const { response } = await postDismiss('/reviews/acme/wid%20gets/7/dismiss', {
      kind: 'invalid-repo',
    });

    expect(response.statusCode).toBe(400);
  });
});
