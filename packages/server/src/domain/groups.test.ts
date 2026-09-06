import { aSession } from '@garden/shared/fixtures';
import type { SessionMap, UiState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { buildGroups } from './groups.js';

const uiState: Pick<UiState, 'groupOrder' | 'pinnedRepos' | 'collapsedRepos'> = {
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
};

const asMap = (...sessions: ReturnType<typeof aSession>[]): SessionMap =>
  Object.fromEntries(sessions.map((s) => [s.id, s]));

describe('buildGroups', () => {
  it('folds two worktrees of one repo into a single group', () => {
    const repo = aSession({ id: 'sid-1', cwd: '/Users/dev/repo', repoRoot: '/Users/dev/repo' });
    const worktree = aSession({
      id: 'sid-2',
      cwd: '/Users/dev/repo/.worktrees/feat',
      repoRoot: '/Users/dev/repo',
    });
    const groups = buildGroups(asMap(repo, worktree), uiState);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.repoRoot).toBe('/Users/dev/repo');
    expect(groups[0]?.sessionIds.sort()).toEqual(['sid-1', 'sid-2']);
  });

  it('omits a session with no known repo root from every group', () => {
    const session = aSession({ id: 'sid-1', repoRoot: null });
    expect(buildGroups(asMap(session), uiState)).toEqual([]);
  });

  it('counts only live sessions towards liveCount', () => {
    const live = aSession({ id: 'sid-1', repoRoot: '/repo', liveness: 'live' });
    const dead = aSession({ id: 'sid-2', repoRoot: '/repo', liveness: 'dead' });
    const [group] = buildGroups(asMap(live, dead), uiState);
    expect(group?.liveCount).toBe(1);
  });

  it('flags attention when any session needs approval or is waiting', () => {
    const waiting = aSession({ id: 'sid-1', repoRoot: '/repo', status: 'waiting' });
    const [group] = buildGroups(asMap(waiting), uiState);
    expect(group?.attention).toBe(true);
  });

  it('does not flag attention for a group with no needs-approval or waiting session', () => {
    const working = aSession({ id: 'sid-1', repoRoot: '/repo', status: 'working' });
    const [group] = buildGroups(asMap(working), uiState);
    expect(group?.attention).toBe(false);
  });

  it('reports collapsed from the overlay state', () => {
    const session = aSession({ id: 'sid-1', repoRoot: '/repo' });
    const groups = buildGroups(asMap(session), { ...uiState, collapsedRepos: ['/repo'] });
    expect(groups[0]?.collapsed).toBe(true);
  });

  it('orders unpinned groups by most recent activity, newest first', () => {
    const stale = aSession({ id: 'sid-1', repoRoot: '/stale', lastActivity: 1000 });
    const fresh = aSession({ id: 'sid-2', repoRoot: '/fresh', lastActivity: 2000 });
    const groups = buildGroups(asMap(stale, fresh), uiState);
    expect(groups.map((g) => g.repoRoot)).toEqual(['/fresh', '/stale']);
  });

  it('orders every pinned group before every unpinned group regardless of activity', () => {
    const unpinnedFresh = aSession({ id: 'sid-1', repoRoot: '/unpinned', lastActivity: 9000 });
    const pinnedStale = aSession({ id: 'sid-2', repoRoot: '/pinned', lastActivity: 100 });
    const groups = buildGroups(asMap(unpinnedFresh, pinnedStale), {
      ...uiState,
      pinnedRepos: ['/pinned'],
    });
    expect(groups.map((g) => g.repoRoot)).toEqual(['/pinned', '/unpinned']);
  });

  it('orders pinned groups by the user drag order rather than activity', () => {
    const first = aSession({ id: 'sid-1', repoRoot: '/first', lastActivity: 100 });
    const second = aSession({ id: 'sid-2', repoRoot: '/second', lastActivity: 9000 });
    const groups = buildGroups(asMap(first, second), {
      ...uiState,
      pinnedRepos: ['/first', '/second'],
      groupOrder: ['/first', '/second'],
    });
    expect(groups.map((g) => g.repoRoot)).toEqual(['/first', '/second']);
  });

  it('falls back to activity to order a pinned group absent from groupOrder', () => {
    const ordered = aSession({ id: 'sid-1', repoRoot: '/ordered', lastActivity: 100 });
    const unordered = aSession({ id: 'sid-2', repoRoot: '/unordered', lastActivity: 9000 });
    const groups = buildGroups(asMap(ordered, unordered), {
      ...uiState,
      pinnedRepos: ['/ordered', '/unordered'],
      groupOrder: ['/ordered'],
    });
    expect(groups.map((g) => g.repoRoot)).toEqual(['/ordered', '/unordered']);
  });
});
