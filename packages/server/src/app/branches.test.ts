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

  it('lands a branch that changed between two ticks, not a one-shot cached answer', async () => {
    let current = 'main';
    const { projection, sweeper } = harness(() => Promise.resolve(current));
    projection.dispatch(transcript('/Users/dev/repo'));

    await sweeper.tick();
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('main');

    current = 'feat/x';
    await sweeper.tick();
    expect(sessionOf(projection, 'sid-1')?.branch).toBe('feat/x');
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
});
