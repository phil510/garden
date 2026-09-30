import { describe, expect, it } from 'vitest';
import { fastifyLogger } from './logger.js';

function recording() {
  const warnings: string[] = [];
  const errors: string[] = [];
  const log = fastifyLogger({
    warn: (message) => warnings.push(message),
    error: (message) => errors.push(message),
  });
  return { log, warnings, errors };
}

describe('fastifyLogger', () => {
  it('logs the stack of an error passed without a message', () => {
    const { log, warnings } = recording();

    log.warn({ err: new Error('reply failed') });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Error: reply failed\n/);
  });

  it('logs the stack of a bare error', () => {
    const { log, errors } = recording();

    log.error(new Error('boom'));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Error: boom\n/);
  });
});
