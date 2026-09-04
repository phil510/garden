import { describe, expect, it } from 'vitest';
import { createServer } from '../server.js';

describe('GET /health', () => {
  it('is mounted and answers 200 with an ok status', async () => {
    const app = createServer();
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
