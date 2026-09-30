import { describe, expect, it } from 'vitest';
import type { Logger } from '../app/ports.js';
import { SwarmCycleError } from '../app/swarms.js';
import { createApp } from './server.js';

function spyLogger(): { logger: Logger; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      warn: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
    warnings,
    errors,
  };
}

describe('errorHandler', () => {
  it('maps an unhandled throw to a 500 ErrorResponse and logs its stack', async () => {
    const { logger, errors } = spyLogger();
    const app = createApp(logger);
    app.register((instance) => {
      instance.get('/boom', () => {
        throw new Error('boom');
      });
      return Promise.resolve();
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'boom' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Error: boom\n/);
  });

  it('gives a new route the mapped status for a known error class without restating it', async () => {
    const { logger, warnings, errors } = spyLogger();
    const app = createApp(logger);
    app.register((instance) => {
      instance.get('/cycle', () => {
        throw new SwarmCycleError('would create a cycle');
      });
      return Promise.resolve();
    });

    const response = await app.inject({ method: 'GET', url: '/cycle' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'would create a cycle' });
    expect(warnings).toEqual(['would create a cycle']);
    expect(errors).toEqual([]);
  });

  it("keeps Fastify's own 4xx status but returns an ErrorResponse body", async () => {
    const app = createApp();
    app.register((instance) => {
      instance.post('/echo', () => ({ ok: true }));
      return Promise.resolve();
    });

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<Record<string, unknown>>();
    expect(Object.keys(body)).toEqual(['error']);
    expect(typeof body.error).toBe('string');
  });
});
