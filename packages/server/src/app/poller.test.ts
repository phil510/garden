import { describe, expect, it } from 'vitest';
import type { GhResult } from '../domain/github.js';
import type { Watch } from '../domain/watches.js';
import type { GhPort } from './ports.js';
import { fetchWatch } from './poller.js';
import { emptyTally } from '../domain/pollCursor.js';
import type { Cursor, Observation } from '../domain/pollCursor.js';

const T0 = Date.parse('2026-01-10T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const watch: Watch = {
  id: 'w1',
  sessionId: 's1',
  repo: 'acme/widgets',
  pr: 7,
  kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
  createdAt: T0,
  cursor: null,
  pendingDigest: null,
  status: 'active',
};

/** A GitHub that answers by path and honours ETags: it replies 304 when the request's ETag is the
 *  resource's current one. Every call is recorded with its outcome. */
function fakeGh() {
  const resources = new Map<string, { etag: string; body: unknown }>();
  const failures = new Map<string, GhResult>();
  const calls: { path: string; etag: string | null; kind: GhResult['kind'] }[] = [];
  let version = 0;
  const gh: GhPort = {
    get(path, etag) {
      const failure = failures.get(path);
      const resource = resources.get(path);
      const result: GhResult =
        failure ??
        (resource === undefined
          ? { kind: 'inaccessible', status: 404 }
          : etag === resource.etag
            ? { kind: 'not-modified' }
            : { kind: 'ok', etag: resource.etag, body: resource.body });
      calls.push({ path, etag, kind: result.kind });
      return Promise.resolve(result);
    },
  };
  return {
    gh,
    calls,
    failures,
    set(path: string, body: unknown) {
      version += 1;
      resources.set(path, { etag: `W/"${String(version)}"`, body });
    },
    clearCalls() {
      calls.length = 0;
    },
  };
}

const PR = 'repos/acme/widgets/pulls/7';
const page = (base: string, n: number) => `${base}?per_page=100&page=${String(n)}`;
const pr = (extra: Record<string, unknown> = {}) => ({
  state: 'open',
  mergeable: true,
  head: { sha: 'sha1' },
  ...extra,
});
const comment = (id: number, at: number) => ({
  id,
  user: { login: 'alice' },
  created_at: iso(at),
});

function seedQuiet(github: ReturnType<typeof fakeGh>, body: Record<string, unknown> = pr()) {
  github.set(PR, body);
  github.set(page(`${PR}/reviews`, 1), []);
  github.set(page('repos/acme/widgets/issues/7/comments', 1), []);
  github.set(page(`${PR}/comments`, 1), []);
  github.set(page('repos/acme/widgets/commits/sha1/check-runs', 1), { check_runs: [] });
  github.set('repos/acme/widgets/commits/sha1/status?per_page=100', { statuses: [] });
}

async function fetchObserved(github: ReturnType<typeof fakeGh>, cursor: Cursor | null) {
  const outcome = await fetchWatch(github.gh, watch, cursor);
  if (outcome.kind !== 'observed') throw new Error(`unexpected ${outcome.kind}`);
  return outcome.observation;
}

describe('fetchWatch', () => {
  it('makes only 304 calls for an unchanged PR on the second fetch', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const first = await fetchObserved(github, null);
    github.clearCalls();

    const second = await fetchObserved(github, cursorAfter(first));

    expect(github.calls.length).toBeGreaterThan(5);
    expect(github.calls.map((call) => call.kind)).toEqual(github.calls.map(() => 'not-modified'));
    expect(github.calls.every((call) => call.etag !== null)).toBe(true);
    expect(second.tracking).toEqual(first.tracking);
  });

  it('reports every comment of a three-page catch-up after creation, then makes three 304 calls', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const path = 'repos/acme/widgets/issues/7/comments';
    const full = (from: number) =>
      Array.from({ length: 100 }, (_, i) => comment(from + i, T0 + from + i));
    github.set(page(path, 1), full(1));
    github.set(page(path, 2), full(101));
    github.set(page(path, 3), [comment(201, T0 + 201)]);

    const first = await fetchObserved(github, null);

    expect(first.activity.comments).toHaveLength(201);
    expect(first.tracking.issueComments.etags).toHaveLength(3);
    github.clearCalls();

    const cursor = cursorAfter(first);
    const second = await fetchObserved(github, cursor);

    const issueCalls = github.calls.filter((call) => call.path.includes('/issues/'));
    expect(issueCalls.map((call) => call.kind)).toEqual([
      'not-modified',
      'not-modified',
      'not-modified',
    ]);
    expect(second.activity.comments).toEqual([]);
  });

  it('stops after one call when the PR is not found', async () => {
    const github = fakeGh();

    const outcome = await fetchWatch(github.gh, watch, null);

    expect(outcome).toEqual({ kind: 'inaccessible', status: 404 });
    expect(github.calls).toHaveLength(1);
  });

  it('returns a rate limit from a later call without further calls', async () => {
    const github = fakeGh();
    seedQuiet(github);
    github.failures.set(page(`${PR}/reviews`, 1), { kind: 'rate-limited', resumeAt: 5 });

    const outcome = await fetchWatch(github.gh, watch, null);

    expect(outcome).toEqual({ kind: 'rate-limited', resumeAt: 5 });
    expect(github.calls).toHaveLength(2);
  });

  it('treats activity before creation as baseline and after creation as new', async () => {
    const github = fakeGh();
    seedQuiet(github);
    github.set(page('repos/acme/widgets/issues/7/comments', 1), [
      comment(1, T0 - 5000),
      comment(2, T0 + 5000),
    ]);

    const observation = await fetchObserved(github, null);

    expect(observation.activity.comments).toEqual([{ login: 'alice', at: T0 + 5000 }]);
    expect(observation.tracking.issueComments.seen).toEqual([1, 2]);
  });

  it('reports a review submitted after a later-id review, with its inline comment', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const submitted = (id: number, at: number) => ({
      id,
      user: { login: 'bob' },
      body: '',
      state: 'COMMENTED',
      submitted_at: iso(at),
    });
    github.set(page(`${PR}/reviews`, 1), [submitted(7, T0 + 1000)]);
    const first = await fetchObserved(github, null);
    const cursor = cursorAfter(first);
    github.set(page(`${PR}/reviews`, 1), [submitted(7, T0 + 1000), submitted(3, T0 + 9000)]);
    github.set(page(`${PR}/comments`, 1), [
      { id: 40, user: { login: 'bob' }, created_at: iso(T0 + 100), pull_request_review_id: 3 },
    ]);

    const second = await fetchObserved(github, cursor);

    expect(second.activity.reviews).toEqual([
      { login: 'bob', at: T0 + 9000, hasBody: false, hasInlineComments: true },
    ]);
  });

  it('reports a check run first seen in progress that later fails, and a status going to error', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const runs = 'repos/acme/widgets/commits/sha1/check-runs';
    const statusPath = 'repos/acme/widgets/commits/sha1/status?per_page=100';
    github.set(page(runs, 1), {
      check_runs: [{ id: 1, name: 'build', status: 'in_progress', conclusion: null }],
    });
    github.set(statusPath, {
      statuses: [{ context: 'ci/x', state: 'pending', updated_at: iso(T0 + 1) }],
    });
    const first = await fetchObserved(github, null);
    const cursor = cursorAfter(first);
    github.set(page(runs, 1), {
      check_runs: [
        {
          id: 1,
          name: 'build',
          status: 'completed',
          conclusion: 'failure',
          completed_at: iso(T0 + 5000),
        },
      ],
    });
    github.set(statusPath, {
      statuses: [{ context: 'ci/x', state: 'error', updated_at: iso(T0 + 6000) }],
    });

    const second = await fetchObserved(github, cursor);

    expect(second.activity.checks.map((check) => check.name)).toEqual(['build', 'ci/x']);
    expect(first.activity.checks).toEqual([]);
  });

  it('resets check tracking when the head sha changes', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const first = await fetchObserved(github, null);
    const cursor = cursorAfter(first);
    github.set(PR, pr({ head: { sha: 'sha2' } }));
    github.set(page('repos/acme/widgets/commits/sha2/check-runs', 1), { check_runs: [] });
    github.set('repos/acme/widgets/commits/sha2/status?per_page=100', { statuses: [] });

    const second = await fetchObserved(github, cursor);

    expect(second.tracking.checkRuns).toMatchObject({ sha: 'sha2' });
    const sha2Calls = github.calls.filter((call) => call.path.includes('sha2'));
    expect(sha2Calls.every((call) => call.etag === null)).toBe(true);
  });

  it('reads the lists but not the checks for a merged PR, and reports it closed', async () => {
    const github = fakeGh();
    seedQuiet(github, pr({ state: 'closed', merged: true }));

    const observation = await fetchObserved(github, null);

    expect(observation.activity.closed).toEqual({ merged: true });
    expect(github.calls.some((call) => call.path.includes('/commits/'))).toBe(false);
    expect(github.calls.some((call) => call.path.includes('/reviews'))).toBe(true);
  });

  it('reports a PR becoming conflicting once, not again while GitHub recomputes', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const first = await fetchObserved(github, null);
    const cursor = cursorAfter(first);
    github.set(PR, pr({ mergeable: false }));
    const second = await fetchObserved(github, cursor);
    const cursor2 = cursorAfter(second);
    github.set(PR, pr({ mergeable: null }));
    const third = await fetchObserved(github, cursor2);

    expect([first.activity.conflict, second.activity.conflict, third.activity.conflict]).toEqual([
      false,
      true,
      false,
    ]);
  });
});

function cursorAfter(observation: Observation): Cursor {
  return { ...observation.tracking, written: emptyTally(), fresh: emptyTally(), digestId: null };
}
