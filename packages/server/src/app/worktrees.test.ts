import { describe, expect, it, vi } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import type { GitPort, OverlayState, StorePort } from './ports.js';
import { createProjection, type Projection } from './projection.js';
import { watchWorktrees } from './worktrees.js';

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
function harness(worktree: (cwd: string) => ReturnType<GitPort['worktree']>) {
  const store: StorePort = {
    read: () => emptyOverlay,
    write: () => undefined,
  };
  const asked: string[] = [];
  const git: Pick<GitPort, 'worktree'> = {
    worktree: (cwd) => {
      asked.push(cwd);
      return worktree(cwd);
    },
  };
  const projection = createProjection(store);
  return { projection, git, asked, stop: watchWorktrees({ git, projection }) };
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

describe('watchWorktrees', () => {
  it('names the worktree git resolved for a session discovered from a transcript', async () => {
    const worktreeDir = '/Users/dev/repo/.worktrees/feat/x';
    const { projection, asked, stop } = harness(() =>
      Promise.resolve({ path: worktreeDir, name: 'x' }),
    );
    try {
      projection.dispatch(transcript(worktreeDir));
      await vi.waitFor(() => {
        expect(sessionOf(projection, 'sid-1')?.worktree).toBe('x');
      });
      expect(asked).toEqual([worktreeDir]);
    } finally {
      stop();
    }
  });

  it('resolves a session registered by a use case as well as one read from a transcript', async () => {
    const { projection, stop } = harness(() =>
      Promise.resolve({ path: '/Users/dev/repo/.worktrees/feat/x', name: 'x' }),
    );
    try {
      projection.dispatch({
        type: 'session-registered',
        id: 'sid-2',
        tmuxName: 'repo',
        cwd: '/Users/dev/repo/.worktrees/feat/x',
      });
      await vi.waitFor(() => {
        expect(sessionOf(projection, 'sid-2')?.worktree).toBe('x');
      });
    } finally {
      stop();
    }
  });

  it('leaves a session at the main checkout worktree-less, and otherwise intact', async () => {
    const { projection, asked, stop } = harness(() => Promise.resolve(null));
    try {
      projection.dispatch(transcript('/Users/dev/repo'));
      await vi.waitFor(() => {
        expect(asked).toEqual(['/Users/dev/repo']);
      });
      expect(sessionOf(projection, 'sid-1')).toMatchObject({
        cwd: '/Users/dev/repo',
        worktree: null,
        title: 'A session',
      });
    } finally {
      stop();
    }
  });

  it('leaves a session outside any repo worktree-less, and otherwise intact', async () => {
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
        worktree: null,
        title: 'A session',
      });
    } finally {
      stop();
    }
  });

  it('asks git once per directory however many sessions appear in it', async () => {
    const { projection, asked, stop } = harness(() =>
      Promise.resolve({ path: '/Users/dev/repo/.worktrees/feat/x', name: 'x' }),
    );
    try {
      projection.dispatch(transcript('/Users/dev/repo/.worktrees/feat/x', 'sid-1'));
      projection.dispatch(transcript('/Users/dev/repo/.worktrees/feat/x', 'sid-2'));
      await vi.waitFor(() => {
        expect(sessionOf(projection, 'sid-2')?.worktree).toBe('x');
      });
      expect(asked).toEqual(['/Users/dev/repo/.worktrees/feat/x']);
      expect(sessionOf(projection, 'sid-1')?.worktree).toBe('x');
    } finally {
      stop();
    }
  });

  it('stops asking once unsubscribed', async () => {
    const { projection, asked, stop } = harness(() => Promise.resolve(null));
    stop();
    projection.dispatch(transcript('/Users/dev/repo'));
    await Promise.resolve();
    expect(asked).toEqual([]);
  });
});
