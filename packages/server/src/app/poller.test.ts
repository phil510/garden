import { describe, expect, it } from 'vitest';
import type { GhResult } from '../domain/github.js';
import { dropSessionWatches, type Watch } from '../domain/watches.js';
import type { GhPort } from './ports.js';
import { createPoller, fetchWatch } from './poller.js';
import { createProjection } from './projection.js';
import { DEFAULT_CONFIG_FILE } from '../config.js';
import type { ConfigFile } from '../config.js';
import { listWatches, replayWatches, updateWatches } from './watches.js';
import type { OverlayState, StorePort } from './ports.js';
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
  let beforeNextGet: (() => void) | null = null;
  const gh: GhPort = {
    get(path, etag) {
      const hook = beforeNextGet;
      beforeNextGet = null;
      hook?.();
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
    beforeNextGet(hook: () => void) {
      beforeNextGet = hook;
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

    expect(first.activity.issueComments).toHaveLength(201);
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
    expect(second.activity.issueComments).toEqual([]);
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

    expect(observation.activity.issueComments).toEqual([{ id: 2, login: 'alice', at: T0 + 5000 }]);
    expect(observation.tracking.issueComments.seen).toEqual([1, 2]);
  });

  it('reports a comment inside a review submitted after a later-id review, and not the empty wrapper', async () => {
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

    expect(second.activity.reviews).toEqual([]);
    expect(second.activity.reviewComments).toEqual([
      { id: 40, login: 'bob', reviewId: 3, at: T0 + 9000 },
    ]);
  });

  it('counts an empty approval or change request and a commented review with a body', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const submitted = (id: number, state: string, body: string) => ({
      id,
      user: { login: `u${String(id)}` },
      body,
      state,
      submitted_at: iso(T0 + id * 1000),
    });
    github.set(page(`${PR}/reviews`, 1), [
      submitted(1, 'APPROVED', ''),
      submitted(2, 'CHANGES_REQUESTED', ''),
      submitted(3, 'COMMENTED', 'looks odd'),
      submitted(4, 'COMMENTED', ''),
    ]);

    const observation = await fetchObserved(github, null);

    expect(observation.activity.reviews.map((r) => r.login)).toEqual(['u1', 'u2', 'u3']);
    expect(observation.activity.reviews.map((r) => [r.id, r.state])).toEqual([
      [1, 'APPROVED'],
      [2, 'CHANGES_REQUESTED'],
      [3, 'COMMENTED'],
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

    expect(second.activity.checks).toEqual([
      {
        kind: 'check-run',
        id: 1,
        name: 'build',
        conclusion: 'failure',
        outcome: 'failed',
        at: T0 + 5000,
        headSha: 'sha1',
      },
      {
        kind: 'status',
        name: 'ci/x',
        state: 'error',
        outcome: 'failed',
        at: T0 + 6000,
        headSha: 'sha1',
      },
    ]);
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

  it('does not report a conflict when a PR closes with mergeable false', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const first = await fetchObserved(github, null);
    github.set(PR, pr({ state: 'closed', merged: true, mergeable: false }));

    const second = await fetchObserved(github, cursorAfter(first));

    expect(second.activity).toMatchObject({ conflict: null, closed: { merged: true } });
  });

  it('stamps a reply on an old review with its own creation time', async () => {
    const github = fakeGh();
    seedQuiet(github);
    const review = {
      id: 3,
      user: { login: 'bob' },
      body: 'x',
      state: 'COMMENTED',
      submitted_at: iso(T0 + 1000),
    };
    github.set(page(`${PR}/reviews`, 1), [review]);
    const first = await fetchObserved(github, null);
    github.set(page(`${PR}/comments`, 1), [
      { id: 40, user: { login: 'alice' }, created_at: iso(T0 + 90_000), pull_request_review_id: 3 },
    ]);

    const second = await fetchObserved(github, cursorAfter(first));

    expect(second.activity.reviewComments).toEqual([
      { id: 40, login: 'alice', reviewId: 3, at: T0 + 90_000 },
    ]);
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
      null,
      { headSha: 'sha1' },
      null,
    ]);
  });
});

function cursorAfter(observation: Observation): Cursor {
  return { ...observation.tracking, written: emptyTally(), fresh: emptyTally() };
}

const MIN = 60_000;

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
  watches: [],
  pipes: {},
};

/** A real projection over an in-memory store, a fake GitHub and an injected clock. */
function setupPoller(watches: readonly Watch[] = [watch]) {
  const github = fakeGh();
  seedQuiet(github);
  let overlay: OverlayState = { ...emptyOverlay, watches };
  let writes = 0;
  const store: StorePort = {
    read: () => overlay,
    write: (state) => {
      overlay = state;
      writes += 1;
    },
  };
  const projection = createProjection(store);
  projection.dispatch({ type: 'session-registered', id: 's1', tmuxName: 's1', cwd: '/work/s1' });
  const watchDeps = { projection, git: { remoteUrl: () => Promise.resolve(null) } };
  replayWatches(watchDeps, T0);
  const config: ConfigFile = { ...DEFAULT_CONFIG_FILE };
  const log: string[] = [];
  let clock = T0;
  let ids = 0;
  const poller = createPoller({
    watches: watchDeps,
    gh: github.gh,
    config: { read: () => config },
    logger: { warn: (m) => log.push(m), error: (m) => log.push(m) },
    now: () => clock,
    mintId: () => `digest-${String(++ids)}`,
  });
  return {
    github,
    poller,
    watchDeps,
    config,
    log,
    writes: () => writes,
    state: () => listWatches(watchDeps, 's1'),
    stored: () => overlay.watches,
    at(ms: number) {
      clock = ms;
    },
  };
}

describe('createPoller', () => {
  const COMMENTS = 'repos/acme/widgets/issues/7/comments';

  it('publishes a digest on the first tick past the quiet window, visible in SessionState', async () => {
    const t = setupPoller();
    t.github.set(page(COMMENTS, 1), [comment(1, T0 + 1000)]);

    t.at(T0 + MIN);
    await t.poller.tick();
    expect(t.state()).toMatchObject([{ pr: 7, pendingDigest: false, status: 'active' }]);

    t.at(T0 + 5 * MIN);
    await t.poller.tick();

    expect(t.state()).toMatchObject([{ pendingDigest: true }]);
    expect(t.stored()[0]?.pendingDigest?.line).toBe('#7 acme/widgets: [digest digest-1] 1 comment');
  });

  it('writes nothing when every call is a 304', async () => {
    const t = setupPoller();
    t.at(T0 + MIN);
    await t.poller.tick();
    const writes = t.writes();

    t.at(T0 + 2 * MIN);
    await t.poller.tick();

    expect(t.writes()).toBe(writes);
  });

  it('counts only new activity when an acknowledgement lands between fetch and merge', async () => {
    const t = setupPoller();
    t.github.set(page(COMMENTS, 1), [comment(1, T0 + 1000)]);
    t.at(T0 + 5 * MIN);
    await t.poller.tick();
    const first = t.stored()[0]?.pendingDigest;
    expect(first?.line).toBe('#7 acme/widgets: [digest digest-1] 1 comment');
    t.github.set(page(`${PR}/reviews`, 1), [
      {
        id: 9,
        user: { login: 'bob' },
        body: 'x',
        state: 'COMMENTED',
        submitted_at: iso(T0 + 2000),
      },
    ]);
    t.github.beforeNextGet(() => {
      updateWatches(
        t.watchDeps,
        (ws) => ws.map((w) => ({ ...w, pendingDigest: null })),
        T0 + 6 * MIN,
      );
    });

    t.at(T0 + 10 * MIN);
    await t.poller.tick();

    const next = t.stored()[0]?.pendingDigest;
    expect(next?.line).toBe('#7 acme/widgets: [digest digest-2] 1 review (bob)');
    expect(next?.id).not.toBe(first?.id);
  });

  it('does not bring a watch back when it is removed between fetch and merge', async () => {
    const t = setupPoller();
    t.github.set(page(COMMENTS, 1), [comment(1, T0 + 1000)]);
    t.github.beforeNextGet(() => {
      updateWatches(t.watchDeps, (ws) => dropSessionWatches(ws, watch.sessionId), T0 + 6 * MIN);
    });

    t.at(T0 + 10 * MIN);
    await t.poller.tick();

    expect(t.stored()).toEqual([]);
    expect(t.state()).toEqual([]);
  });

  it('marks every watch as error when gh is unavailable, and recovers on a later tick', async () => {
    const other: Watch = { ...watch, id: 'w2', pr: 8 };
    const t = setupPoller([watch, other]);
    t.github.failures.set(PR, { kind: 'unavailable', reason: 'logged-out' });

    t.at(T0 + MIN);
    await t.poller.tick();

    expect(t.state().map((w) => w.status)).toEqual(['error', 'error']);
    expect(t.stored().every((w) => w.pendingDigest === null)).toBe(true);
    expect(t.state().map((w) => w.errorReason)).toEqual([
      'gh is not logged in. Run `gh auth login`.',
      'gh is not logged in. Run `gh auth login`.',
    ]);

    t.github.failures.clear();
    t.github.set('repos/acme/widgets/pulls/8', pr());
    for (const suffix of ['reviews', 'comments'])
      t.github.set(page(`repos/acme/widgets/pulls/8/${suffix}`, 1), []);
    t.github.set(page('repos/acme/widgets/issues/8/comments', 1), []);
    t.at(T0 + 6 * MIN);
    await t.poller.tick();

    const recovered = t.state().find((w) => w.pr === 7);
    expect(recovered?.status).toBe('active');
    expect(recovered?.errorReason).toBeUndefined();
  });

  it('names a missing gh differently from a logged-out one', async () => {
    const t = setupPoller();
    t.github.failures.set(PR, { kind: 'unavailable', reason: 'missing' });

    t.at(T0 + MIN);
    await t.poller.tick();

    expect(t.state()[0]?.errorReason).toBe('The gh CLI is not installed.');
  });

  it('marks only the watch whose repo answered 404', async () => {
    const other: Watch = { ...watch, id: 'w2', pr: 8 };
    const t = setupPoller([watch, other]);

    t.at(T0 + MIN);
    await t.poller.tick();

    expect(t.state().map((w) => [w.pr, w.status])).toEqual([
      [7, 'active'],
      [8, 'error'],
    ]);
    expect(t.state()[1]?.errorReason).toBe('No access to this repo or PR.');
    expect(t.state()[0]?.errorReason).toBeUndefined();
  });

  it('pauses every call until the rate limit resets', async () => {
    const t = setupPoller();
    t.github.failures.set(PR, { kind: 'rate-limited', resumeAt: T0 + 10 * MIN });

    t.at(T0 + MIN);
    await t.poller.tick();
    expect(t.github.calls).toHaveLength(1);
    expect(t.state()[0]?.status).toBe('active');

    t.at(T0 + 5 * MIN);
    await t.poller.tick();
    expect(t.github.calls).toHaveLength(1);

    t.github.failures.clear();
    t.at(T0 + 11 * MIN);
    await t.poller.tick();
    expect(t.github.calls.length).toBeGreaterThan(1);
  });

  it('closes a merged PR with a final digest and stops fetching it', async () => {
    const t = setupPoller();
    t.github.set(PR, pr({ state: 'closed', merged: true }));

    t.at(T0 + MIN);
    await t.poller.tick();

    expect(t.state()).toMatchObject([{ status: 'closed', pendingDigest: true }]);
    expect(t.stored()[0]?.pendingDigest?.line).toBe('#7 acme/widgets: [digest digest-1] merged');
    t.github.clearCalls();

    t.at(T0 + 10 * MIN);
    await t.poller.tick();

    expect(t.github.calls).toEqual([]);
  });

  it('logs and carries on when a fetch fails for another reason', async () => {
    const t = setupPoller();
    t.github.failures.set(PR, { kind: 'ok', etag: null, body: 'not a PR' });

    await t.poller.tick();

    expect(t.log.join('\n')).toMatch(/unexpected PR response/);
    expect(t.state()[0]?.status).toBe('active');
  });

  it('runs the writer even with nothing to fetch, so expired watches are pruned', async () => {
    const closed: Watch = {
      ...watch,
      status: 'closed',
      pendingDigest: { id: 'd', line: 'x', createdAt: T0 - 8 * 24 * 60 * MIN },
    };
    const t = setupPoller([closed]);

    await t.poller.tick();

    expect(t.stored()).toEqual([]);
  });
});
