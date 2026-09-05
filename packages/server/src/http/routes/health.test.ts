import { describe, expect, it } from 'vitest';
import type { Projection } from '../../app/projection.js';
import { createServer } from '../server.js';

function fakeProjection(): Projection {
  return {
    sessions: () => [],
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: () => undefined,
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
  };
}

describe('GET /health', () => {
  it('is mounted and answers 200 with an ok status', async () => {
    const app = createServer({ projection: fakeProjection() });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
