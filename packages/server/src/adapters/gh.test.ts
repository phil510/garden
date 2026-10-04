import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ghGet } from './gh.js';

/** A stand-in `gh` that records its argv and prints a canned `--include` response, because the
 *  real one needs network and credentials. It still runs as a real subprocess, so the argument
 *  array and the reading of stdout on a non-zero exit are the real thing. */
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'garden-gh-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stubGh(output: string, exitCode: number): string {
  const script = join(dir, 'gh');
  writeFileSync(join(dir, 'out'), output);
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(dir, 'argv')}'\ncat '${join(dir, 'out')}'\nexit ${String(exitCode)}\n`,
  );
  chmodSync(script, 0o755);
  return script;
}

const argv = () => readFileSync(join(dir, 'argv'), 'utf8').trim().split('\n');

describe('ghGet', () => {
  it('returns the parsed body and ETag of a 200', async () => {
    const gh = stubGh('HTTP/2.0 200 OK\r\nEtag: W/"v1"\r\n\r\n{"state":"open"}', 0);

    const result = await ghGet(gh, 'repos/a/b/pulls/1', null, 0);

    expect(result).toEqual({ kind: 'ok', etag: 'W/"v1"', body: { state: 'open' } });
    expect(argv()).toEqual(['api', '--include', 'repos/a/b/pulls/1']);
  });

  it('sends the stored ETag as If-None-Match and reads a 304 although gh exits 1', async () => {
    const gh = stubGh('HTTP/2.0 304 Not Modified\r\nEtag: W/"v1"\r\n\r\n', 1);

    const result = await ghGet(gh, 'repos/a/b/pulls/1', 'W/"v1"', 0);

    expect(result).toEqual({ kind: 'not-modified' });
    expect(argv()).toEqual([
      'api',
      '--include',
      '-H',
      'If-None-Match: W/"v1"',
      'repos/a/b/pulls/1',
    ]);
  });

  it.each([403, 404] as const)('reports an inaccessible repo for a %i', async (status) => {
    const gh = stubGh(`HTTP/2.0 ${String(status)} X\r\n\r\n{"message":"nope"}`, 1);

    expect(await ghGet(gh, 'repos/a/b', null, 0)).toEqual({ kind: 'inaccessible', status });
  });

  it('reports a rate limit rather than an inaccessible repo for a 403 with no calls left', async () => {
    const gh = stubGh(
      'HTTP/2.0 403 Forbidden\r\nX-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 2000\r\n\r\n{}',
      1,
    );

    expect(await ghGet(gh, 'repos/a/b', null, 0)).toEqual({
      kind: 'rate-limited',
      resumeAt: 2_000_000,
    });
  });

  it('honours Retry-After for a secondary limit', async () => {
    const gh = stubGh('HTTP/2.0 429 Too Many Requests\r\nRetry-After: 30\r\n\r\n{}', 1);

    expect(await ghGet(gh, 'repos/a/b', null, 1000)).toEqual({
      kind: 'rate-limited',
      resumeAt: 31_000,
    });
  });

  it('reports logged out for exit 4 and for a 401', async () => {
    const noToken = stubGh('', 4);
    expect(await ghGet(noToken, 'repos/a/b', null, 0)).toEqual({
      kind: 'unavailable',
      reason: 'logged-out',
    });

    const badToken = stubGh('HTTP/2.0 401 Unauthorized\r\n\r\n{}', 1);
    expect(await ghGet(badToken, 'repos/a/b', null, 0)).toEqual({
      kind: 'unavailable',
      reason: 'logged-out',
    });
  });

  it('reports a missing binary', async () => {
    expect(await ghGet(join(dir, 'no-such-gh'), 'repos/a/b', null, 0)).toEqual({
      kind: 'unavailable',
      reason: 'missing',
    });
  });

  it('throws on output that is not a response', async () => {
    await expect(ghGet(stubGh('boom', 1), 'repos/a/b', null, 0)).rejects.toThrow(
      /no HTTP response/,
    );
  });
});
