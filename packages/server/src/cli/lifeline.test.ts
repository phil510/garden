import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLifeline } from './lifeline.js';

// Under the test runner fd 1 is itself a socket, so pretend it is a terminal or a pipeline.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  fstatSync: () => ({ isSocket: () => false }),
}));

describe('openLifeline', () => {
  const before = process.stdout.listeners('error') as ((error: Error) => void)[];

  afterEach(() => {
    for (const listener of process.stdout.listeners('error') as ((error: Error) => void)[])
      if (!before.includes(listener)) process.stdout.removeListener('error', listener);
  });

  it('survives a write error on a stdout that is not a socket', () => {
    const { out } = openLifeline();

    expect(out).toBe(process.stdout);
    expect(() => process.stdout.emit('error', new Error('write EPIPE'))).not.toThrow();
  });
});
