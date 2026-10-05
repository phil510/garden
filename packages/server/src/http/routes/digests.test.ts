import type { DigestDetail } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { DigestsDeps } from '../../app/digests.js';
import type { Projection } from '../../app/projection.js';
import { createApp } from '../server.js';
import { digestRoutes } from './digests.js';

const detail: DigestDetail = {
  id: 'abc123',
  repo: 'acme/widgets',
  pr: 7,
  line: '#7 acme/widgets: [digest abc123] 1 comment',
  createdAt: '2026-01-01T00:00:00.000Z',
  replaces: null,
  atMint: { headSha: 'sha1', mergeable: true },
  closed: null,
  items: {
    reviews: [],
    issueComments: [{ id: 1, author: 'alice', at: '2026-01-01T00:00:00.000Z' }],
    reviewComments: [],
    checkRuns: [],
    statuses: [],
    conflicts: [],
  },
};

function buildApp() {
  const deps: DigestsDeps = {
    projection: {
      overlay: () => ({ digests: [{ sessionId: 's1', detail }] }),
    } as unknown as Pick<Projection, 'overlay'>,
  };
  const app = createApp();
  app.register((instance) => digestRoutes(instance, deps));
  return app;
}

describe('GET /digests/:id', () => {
  it('returns the archived detail', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/digests/abc123' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ digest: detail });
  });

  it('answers 404 for an id that is not archived', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/digests/nope' });

    expect(response.statusCode).toBe(404);
  });
});
