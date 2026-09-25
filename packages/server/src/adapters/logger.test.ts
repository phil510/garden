import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'garden-logger-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('redirectToFile', () => {
  it('moves subsequent info/warn/error calls into the target file', () => {
    const path = join(dir, 'server.log');
    const logger = createLogger();

    logger.redirectToFile(path);
    logger.info('booted');
    logger.warn('careful');
    logger.error('boom');

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/ info booted$/);
    expect(lines[1]).toMatch(/ warn careful$/);
    expect(lines[2]).toMatch(/ error boom$/);
  });

  it('appends across multiple calls rather than truncating', () => {
    const path = join(dir, 'server.log');
    const logger = createLogger();

    logger.redirectToFile(path);
    logger.info('first');
    logger.info('second');

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/ info first$/);
    expect(lines[1]).toMatch(/ info second$/);
  });

  it('leaves the file untouched by anything logged before the redirect', () => {
    const path = join(dir, 'server.log');
    const logger = createLogger();

    logger.info('before redirect, goes to console');
    logger.redirectToFile(path);
    logger.info('after redirect, goes to file');

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ info after redirect, goes to file$/);
  });
});
