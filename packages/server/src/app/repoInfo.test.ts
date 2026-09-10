import { describe, expect, it, vi } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import type { GitPort, OverlayState, StorePort } from './ports.js';
import { createProjection, type Projection } from './projection.js';
import { watchRepoInfo } from './repoInfo.js';

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  hideDead: false,
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
};

/**
 * A real projection, so these tests exercise the same fold production runs. Nothing here
 * seeds a session state: every session starts from a dispatched event, which is the only way
 * to catch a field the fold never fills in.
 */
function harness(repoInfo: (cwd: string) => ReturnType<GitPort['repoInfo']>) {
  const store: StorePort = {
    read: () => emptyOverlay,
    write: () => undefined,
  };
  const asked: string[] = [];
  const git: Pick<GitPort, 'repoInfo'> = {
    repoInfo: (cwd) => {
      asked.push(cwd);
      return repoInfo(cwd);
    },
  };
  const projection = createProjection(store);
  return { projection, git, asked, stop: watchRepoInfo({ git, projection }) };
}

const transcript = (cwd: string, sessionId = 'sid-1'): GardenEvent => ({
  type: 'transcript-changed',
  path: `/t-${sessionId}.jsonl`,
  record: {
    sessionId,
    cwd,
    gitBranch: 'feat/x',
    title: 'A session',
    lastPrompt: null,
    recap: null,
    lastActivity: 1_700_000_000_000,
  },
});

const sessionOf = (projection: Projection, id: string) =>
  projection.sessions().find((session) => session.id === id);

describe('watchRepoInfo', () => {
  it('gives a session the root and worktree git resolved for its cwd, from one call', async () => {
    const worktreeDir = '/Users/dev/repo/.worktrees/feat/x';
    const { projection, asked, stop } = harness(() =>
      Promise.resolve({ repoRoot: '/Users/dev/repo', worktree: 'x' }),
    );
    try {
      projection.dispatch(transcript(worktreeDir));
      await vi.waitFor(() => {
        expect(sessionOf(projection, 'sid-1')?.repoRoot).toBe('/Users/dev/repo');
      });
      expect(sessionOf(projection, 'sid-1')?.worktree).toBe('x');
      expect(asked).toEqual([worktreeDir]);
    } finally {
      stop();
    }
  });

  it('resolves a session registered by a use case as well as one read from a transcript', async () => {
    const { projection, stop } = harness(() =>
      Promise.resolve({ repoRoot: '/Users/dev/repo', worktree: null }),
    );
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

  it('leaves a session at the main checkout worktree-less but rooted, and otherwise intact', async () => {
    const { projection, asked, stop } = harness(() =>
      Promise.resolve({ repoRoot: '/Users/dev/repo', worktree: null }),
    );
    try {
      projection.dispatch(transcript('/Users/dev/repo'));
      await vi.waitFor(() => {
        expect(asked).toEqual(['/Users/dev/repo']);
      });
      expect(sessionOf(projection, 'sid-1')).toMatchObject({
        cwd: '/Users/dev/repo',
        repoRoot: '/Users/dev/repo',
        worktree: null,
        title: 'A session',
      });
    } finally {
      stop();
    }
  });

  it('leaves a session outside any repo with no root and no worktree, and otherwise intact', async () => {
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
        worktree: null,
        title: 'A session',
      });
    } finally {
      stop();
    }
  });

  it('asks git once per directory however many sessions appear in it', async () => {
    const { projection, asked, stop } = harness(() =>
      Promise.resolve({ repoRoot: '/Users/dev/repo', worktree: null }),
    );
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
    const { projection, asked, stop } = harness(() =>
      Promise.resolve({ repoRoot: '/Users/dev/repo', worktree: null }),
    );
    stop();
    projection.dispatch(transcript('/Users/dev/repo'));
    await Promise.resolve();
    expect(asked).toEqual([]);
  });
});
