import type { ReviewItem } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { GhResult, GhWriteResult } from '../domain/github.js';
import { createReviewDismisser } from './reviewDismiss.js';
import { createReviewStore } from './reviews.js';
import { memoryOverlay } from './reviews.fixture.js';

const item = (number: number): ReviewItem => ({
  key: `acme/widgets#${String(number)}`,
  repo: 'acme/widgets',
  number,
  title: `PR ${String(number)}`,
  author: 'octocat',
  url: `https://github.com/acme/widgets/pull/${String(number)}`,
  draft: false,
  updatedAt: '2026-01-10T00:00:00Z',
  clonePath: null,
  sessionId: null,
});

const user = (login: string): GhResult => ({ kind: 'ok', etag: null, body: { login } });
const removed: GhWriteResult = { kind: 'ok', body: { requested_reviewers: [] } };

/** A GitHub whose `/user` and DELETE answers the test sets, recording every call. */
function setup(answers: { user?: GhResult; remove?: GhWriteResult | (() => never) } = {}) {
  const calls: string[] = [];
  const store = createReviewStore({ overlay: memoryOverlay() });
  store.complete([item(1), item(2)], '2026-01-10T00:05:00Z');
  const errors: string[] = [];
  const dismisser = createReviewDismisser({
    gh: {
      get(path) {
        calls.push(`GET ${path}`);
        return Promise.resolve(answers.user ?? user('me'));
      },
      removeReviewRequest(repo, number, login) {
        calls.push(`DELETE ${repo}#${String(number)} ${login}`);
        const answer = answers.remove ?? removed;
        return typeof answer === 'function'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(answer);
      },
    },
    store,
    logger: { error: (message) => errors.push(message) },
  });
  return { calls, store, errors, dismisser };
}

describe('review dismisser', () => {
  it('answers not-found without calling GitHub for a pull request that is not queued', async () => {
    const { dismisser, calls } = setup();

    expect(await dismisser.dismiss('acme/widgets', 99)).toEqual({ kind: 'not-found' });
    expect(calls).toEqual([]);
  });

  it('answers invalid-repo without calling GitHub for a name that is not a repo', async () => {
    const { dismisser, calls } = setup();

    expect(await dismisser.dismiss('acme/wid gets', 1)).toEqual({ kind: 'invalid-repo' });
    expect(calls).toEqual([]);
  });

  it('matches the queue whatever the spelling of the owner and repo', async () => {
    const { dismisser, calls } = setup();

    expect(await dismisser.dismiss('Acme/Widgets', 1)).toEqual({ kind: 'dismissed' });
    expect(calls).toContain('DELETE acme/widgets#1 me');
  });

  it('removes the request as the authenticated user and drops the item', async () => {
    const { dismisser, calls, store } = setup();

    expect(await dismisser.dismiss('acme/widgets', 1)).toEqual({ kind: 'dismissed' });
    expect(calls).toEqual(['GET user', 'DELETE acme/widgets#1 me']);
    expect(store.queue().items).toEqual([item(2)]);
  });

  it('looks the login up once for the life of the dismisser', async () => {
    const { dismisser, calls } = setup();

    await dismisser.dismiss('acme/widgets', 1);
    await dismisser.dismiss('acme/widgets', 2);

    expect(calls.filter((call) => call === 'GET user')).toHaveLength(1);
  });

  it('keeps the item when the response still lists the user as requested', async () => {
    const { dismisser, store } = setup({
      remove: { kind: 'ok', body: { requested_reviewers: [{ login: 'ME' }] } },
    });

    expect(await dismisser.dismiss('acme/widgets', 1)).toEqual({
      kind: 'failed',
      failure: { kind: 'error' },
    });
    expect(store.queue().items).toEqual([item(1), item(2)]);
  });

  it('fails with GitHub status and keeps the item when GitHub refuses', async () => {
    const { dismisser, store } = setup({ remove: { kind: 'inaccessible', status: 422 } });

    expect(await dismisser.dismiss('acme/widgets', 1)).toEqual({
      kind: 'failed',
      failure: { kind: 'error', status: 422 },
    });
    expect(store.queue().items).toEqual([item(1), item(2)]);
  });

  it('reports a failed /user lookup as a plain error and sends no DELETE', async () => {
    const { dismisser, calls } = setup({ user: { kind: 'inaccessible', status: 404 } });

    expect(await dismisser.dismiss('acme/widgets', 1)).toEqual({
      kind: 'failed',
      failure: { kind: 'error' },
    });
    expect(calls).toEqual(['GET user']);
  });

  it('reports a /user body without a login as a plain error and retries the lookup next time', async () => {
    const { dismisser, calls } = setup({ user: { kind: 'ok', etag: null, body: {} } });

    await dismisser.dismiss('acme/widgets', 1);
    await dismisser.dismiss('acme/widgets', 1);

    expect(calls).toEqual(['GET user', 'GET user']);
  });

  it.each([
    [{ kind: 'unavailable', reason: 'missing' }, { kind: 'gh-missing' }],
    [{ kind: 'unavailable', reason: 'logged-out' }, { kind: 'logged-out' }],
    [{ kind: 'rate-limited', resumeAt: 5 }, { kind: 'rate-limited' }],
  ] as const)('maps a %j DELETE answer to %j', async (answer, failure) => {
    const { dismisser, store } = setup({ remove: answer });

    expect(await dismisser.dismiss('acme/widgets', 1)).toEqual({ kind: 'failed', failure });
    expect(store.queue().items).toHaveLength(2);
  });

  it('maps an unavailable gh on the /user lookup to the same kinds', async () => {
    const { dismisser } = setup({ user: { kind: 'unavailable', reason: 'logged-out' } });

    expect(await dismisser.dismiss('acme/widgets', 1)).toEqual({
      kind: 'failed',
      failure: { kind: 'logged-out' },
    });
  });

  it('logs a thrown error and fails with a plain error', async () => {
    const { dismisser, errors, store } = setup({
      remove: () => {
        throw new Error('unused');
      },
    });

    expect(await dismisser.dismiss('acme/widgets', 1)).toEqual({
      kind: 'failed',
      failure: { kind: 'error' },
    });
    expect(errors).toEqual([expect.stringContaining('acme/widgets#1')]);
    expect(store.queue().items).toHaveLength(2);
  });
});
