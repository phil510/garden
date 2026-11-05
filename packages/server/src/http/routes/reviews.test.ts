import { describe, expect, it } from 'vitest';
import type { DismissReviewOutcome, ReviewDismisser } from '../../app/reviewDismiss.js';
import { createApp } from '../server.js';
import { reviewRoutes } from './reviews.js';

function post(url: string, outcome: DismissReviewOutcome) {
  const calls: [string, number][] = [];
  const reviewDismisser: ReviewDismisser = {
    dismiss(repo, number) {
      calls.push([repo, number]);
      return Promise.resolve(outcome);
    },
  };
  const app = createApp();
  app.register((instance) => reviewRoutes(instance, { reviewDismisser }));
  return app.inject({ method: 'POST', url }).then((response) => ({ response, calls }));
}

describe('POST /reviews/:owner/:name/:number/dismiss', () => {
  it('answers 204 and hands the use case the repo and the number', async () => {
    const { response, calls } = await post('/reviews/Acme/Widgets/7/dismiss', {
      kind: 'dismissed',
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(calls).toEqual([['Acme/Widgets', 7]]);
  });

  it('answers 404 when the pull request is not in the queue', async () => {
    const { response } = await post('/reviews/acme/widgets/7/dismiss', { kind: 'not-found' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error');
  });

  it('answers 502 with the failure, including GitHub status when there is one', async () => {
    const { response } = await post('/reviews/acme/widgets/7/dismiss', {
      kind: 'failed',
      failure: { kind: 'error', status: 422 },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ kind: 'error', status: 422 });
  });

  it.each(['abc', '0', '-3', '1.5', '1e3'])('answers 400 for the number %s', async (number) => {
    const { response, calls } = await post(`/reviews/acme/widgets/${number}/dismiss`, {
      kind: 'dismissed',
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 400 when the use case finds the repo invalid', async () => {
    const { response } = await post('/reviews/acme/wid%20gets/7/dismiss', {
      kind: 'invalid-repo',
    });

    expect(response.statusCode).toBe(400);
  });
});
