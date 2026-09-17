import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import { createBranchSweeper } from './branches.js';
import type { GitPort, OverlayState, StorePort } from './ports.js';
import { createProjection, type Projection } from './projection.js';

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
};

/** A real projection, so these tests exercise the same fold production runs — same rationale
 *  as `repoRoots.test.ts`. */
function harness(branch: (cwd: string) => Promise<string>) {
  const store: StorePort = {
    read: () => emptyOverlay,
    write: () => undefined,
  };
  const asked: string[] = [];
  const git: Pick<GitPort, 'branch'> = {
    branch: (cwd) => {
      asked.push(cwd);
      return branch(cwd);
    },
  };
  const projection = createProjection(store);
  const sweeper = createBranchSweeper({ git, projection });
  return { projection, asked, sweeper };
}

const transcript = (cwd: string, sessionId = 'sid-1'): GardenEvent => ({
  type: 'transcript-changed',
  path: `/t-${sessionId}.jsonl`,
  record: {
    sessionId,
    cwd,
    title: 'A session',
    lastPrompt: null,
    recap: null,
    lastActivity: 1_700_000_000_000,
  },
});

/** Registers a session under a tmux name and reports that pane as running, the two facts
 *  `deriveLiveness` needs to call a session live. `transcript()` alone never does — a session
 *  with only a transcript slice and no tmux fact is dead, which is what most of these tests
 *  want: the dead-cwd, cache-and-stop-asking path is the common case a real garden instance
 *  hits, since most cwds it has ever seen belong to sessions that ended long ago. */
const live = (id: string, cwd: string): GardenEvent[] => [
  { type: 'session-registered', id, tmuxName: id, cwd },
  { type: 'tmux-snapshot', sessions: [{ name: id, paneDead: false, exitCode: null }] },
];

const sessionOf = (projection: Projection, id: string) =>
  projection.sessions().find((session) => session.id === id);

/** A promise the test controls the resolution of, for exercising in-flight overlap. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createBranchSweeper', () => {
  it('dispatches branch-resolved per distinct cwd and lands it on the session', async () => {
    const { projection, sweeper } = harness(() => Promise.resolve('feat/x'));
    projection.dispatch(transcript('/Users/dev/repo'));

    await sweeper.tick();

    expect(sessionOf(projection, 'sid-1')?.branch).toBe('feat/x');
  });

  it('asks git once per directory however many sessions share it', async () => {
    const { projection, asked, sweeper } = harness(() => Promise.resolve('feat/x'));
    projection.dispatch(transcript('/Users/dev/repo', 'sid-1'));
    projection.dispatch(transcript('/Users/dev/repo', 'sid-2'));

    await sweeper.tick();

    expect(asked).toEqual(['/Users/dev/repo']);
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('feat/x');
    expect(sessionOf(projection, 'sid-2')?.branch).toBe('feat/x');
  });

  it('resolves a failed cwd to null without affecting another cwd in the same tick', async () => {
    const { projection, sweeper } = harness((cwd) =>
      cwd === '/tmp/gone' ? Promise.reject(new Error('not a repository')) : Promise.resolve('main'),
    );
    projection.dispatch(transcript('/tmp/gone', 'sid-1'));
    projection.dispatch(transcript('/Users/dev/repo', 'sid-2'));

    await sweeper.tick();

    expect(sessionOf(projection, 'sid-1')?.branch).toBeNull();
    expect(sessionOf(projection, 'sid-2')?.branch).toBe('main');
  });

  it('lands a branch that changed between two ticks for a live session, not a one-shot cached answer', async () => {
    let current = 'main';
    const { projection, sweeper } = harness(() => Promise.resolve(current));
    for (const event of live('sid-1', '/Users/dev/repo')) projection.dispatch(event);

    await sweeper.tick();
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('main');

    current = 'feat/x';
    await sweeper.tick();
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('feat/x');
  });

  it('resolves a dead session once and then reuses that answer, without asking git again', async () => {
    let current = 'main';
    const { projection, asked, sweeper } = harness(() => Promise.resolve(current));
    projection.dispatch(transcript('/Users/dev/repo'));

    await sweeper.tick();
    expect(asked).toEqual(['/Users/dev/repo']);
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('main');

    // Nothing but a live process moves a checked-out branch, so a dead cwd's answer is final —
    // this change must never be seen.
    current = 'feat/x';
    await sweeper.tick();
    await sweeper.tick();

    expect(asked).toEqual(['/Users/dev/repo']);
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('main');
  });

  it('resumes re-resolving a cwd once a new session goes live there, after an earlier dead one cached it', async () => {
    let current = 'main';
    const { projection, asked, sweeper } = harness(() => Promise.resolve(current));
    projection.dispatch(transcript('/Users/dev/repo', 'sid-1'));
    await sweeper.tick();
    expect(asked).toEqual(['/Users/dev/repo']);

    current = 'feat/x';
    for (const event of live('sid-2', '/Users/dev/repo')) projection.dispatch(event);
    await sweeper.tick();

    expect(asked).toEqual(['/Users/dev/repo', '/Users/dev/repo']);
    expect(sessionOf(projection, 'sid-2')?.branch).toBe('feat/x');
  });

  it('no-ops a tick that overlaps one still in flight, rather than double-spawning git', async () => {
    const gate = deferred<string>();
    let calls = 0;
    const { projection, sweeper } = harness(() => {
      calls += 1;
      return gate.promise;
    });
    projection.dispatch(transcript('/Users/dev/repo'));

    const first = sweeper.tick();
    const second = sweeper.tick();
    gate.resolve('main');
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('main');
  });

  it('dispatches nothing once stopped, even for a tick already in flight', async () => {
    const gate = deferred<string>();
    const { projection, sweeper } = harness(() => gate.promise);
    projection.dispatch(transcript('/Users/dev/repo'));

    const inFlight = sweeper.tick();
    sweeper.stop();
    gate.resolve('main');
    await inFlight;

    expect(sessionOf(projection, 'sid-1')?.branch).toBeNull();
  });

  it('never runs more than the concurrency cap worth of git calls at once', async () => {
    const cwdCount = 20;
    let concurrent = 0;
    let peak = 0;
    const { projection, sweeper } = harness(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrent -= 1;
      return 'main';
    });
    for (let i = 0; i < cwdCount; i += 1) {
      projection.dispatch(transcript(`/Users/dev/repo-${String(i)}`, `sid-${String(i)}`));
    }

    await sweeper.tick();

    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(0);
  });
});
