import { describe, expect, it, vi } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import type { GitPort, OverlayState, StorePort } from './ports.js';
import { createProjection, type Projection } from './projection.js';
import { watchRepoRoots } from './repoRoots.js';

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

/**
 * A real projection, so these tests exercise the same fold production runs. Nothing here
 * seeds a session state: every session starts from a dispatched event, which is the only way
 * to catch a field the fold never fills in.
 */
function harness(repoRoot: (cwd: string) => Promise<string>) {
  const store: StorePort = {
    read: () => emptyOverlay,
    write: () => undefined,
  };
  const asked: string[] = [];
  const git: Pick<GitPort, 'repoRoot'> = {
    repoRoot: (cwd) => {
      asked.push(cwd);
      return repoRoot(cwd);
    },
  };
  const projection = createProjection(store);
  return { projection, git, asked, stop: watchRepoRoots({ git, projection }) };
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

describe('watchRepoRoots', () => {
  it('gives a session discovered from a transcript the root git resolved for its cwd', async () => {
    const worktree = '/Users/dev/repo/.worktrees/feat/x';
    const { projection, asked, stop } = harness(() => Promise.resolve('/Users/dev/repo'));
    try {
      projection.dispatch(transcript(worktree));
      await vi.waitFor(() => {
        expect(sessionOf(projection, 'sid-1')?.repoRoot).toBe('/Users/dev/repo');
      });
      expect(asked).toEqual([worktree]);
    } finally {
      stop();
    }
  });

  it('resolves a session registered by a use case as well as one read from a transcript', async () => {
    const { projection, stop } = harness(() => Promise.resolve('/Users/dev/repo'));
    try {
      projection.dispatch({
        type: 'session-registered',
        id: 'sid-2',
        tmuxName: 'repo',
        cwd: '/Users/dev/repo',
      });
      await vi.waitFor(() => {
        expect(sessionOf(projection, 'sid-2')?.repoRoot).toBe('/Users/dev/repo');
      });
    } finally {
      stop();
    }
  });

  it('leaves a session outside any repo with no root, and otherwise intact', async () => {
    const { projection, asked, stop } = harness(() =>
      Promise.reject(new Error('not a repository')),
    );
    try {
      projection.dispatch(transcript('/tmp/scratch'));
      await vi.waitFor(() => {
        expect(asked).toEqual(['/tmp/scratch']);
      });
      expect(sessionOf(projection, 'sid-1')).toMatchObject({
        cwd: '/tmp/scratch',
        repoRoot: null,
        title: 'A session',
      });
    } finally {
      stop();
    }
  });

  it('asks git once per directory however many sessions appear in it', async () => {
    const { projection, asked, stop } = harness(() => Promise.resolve('/Users/dev/repo'));
    try {
      projection.dispatch(transcript('/Users/dev/repo', 'sid-1'));
      projection.dispatch(transcript('/Users/dev/repo', 'sid-2'));
      await vi.waitFor(() => {
        expect(sessionOf(projection, 'sid-2')?.repoRoot).toBe('/Users/dev/repo');
      });
      expect(asked).toEqual(['/Users/dev/repo']);
      expect(sessionOf(projection, 'sid-1')?.repoRoot).toBe('/Users/dev/repo');
    } finally {
      stop();
    }
  });

  it('stops asking once unsubscribed', async () => {
    const { projection, asked, stop } = harness(() => Promise.resolve('/Users/dev/repo'));
    stop();
    projection.dispatch(transcript('/Users/dev/repo'));
    await Promise.resolve();
    expect(asked).toEqual([]);
  });
});
