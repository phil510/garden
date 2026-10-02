import { describe, expect, it, vi } from 'vitest';
import {
  getCachedRepoList,
  refreshRepoList,
  setCachedRepoList,
  subscribeRepoList,
} from './repoListCache';

describe('repoListCache', () => {
  it('starts with no cached repo list', () => {
    expect(getCachedRepoList()).toBeNull();
  });

  it('replaces the cached repo list wholesale', () => {
    const repos = [{ path: '/repo-a', name: 'repo-a', branch: 'main', isWorktree: false }];
    setCachedRepoList(repos);
    expect(getCachedRepoList()).toEqual(repos);

    const nextRepos = [{ path: '/repo-b', name: 'repo-b', branch: 'main', isWorktree: false }];
    setCachedRepoList(nextRepos);
    expect(getCachedRepoList()).toEqual(nextRepos);
  });

  it('refreshRepoList returns and caches the freshly fetched list', async () => {
    const repos = [{ path: '/repo-c', name: 'repo-c', branch: 'main', isWorktree: true }];
    await expect(refreshRepoList(() => Promise.resolve({ repos }))).resolves.toEqual(repos);
    expect(getCachedRepoList()).toEqual(repos);
  });

  it('refreshRepoList falls back to the cached list when the fetch fails', async () => {
    const repos = [{ path: '/repo-d', name: 'repo-d', branch: 'main', isWorktree: false }];
    setCachedRepoList(repos);
    await expect(refreshRepoList(() => Promise.reject(new Error('down')))).resolves.toEqual(repos);
    expect(getCachedRepoList()).toEqual(repos);
  });

  it('notifies subscribers when a refresh replaces the list, until they unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRepoList(listener);
    const repos = [{ path: '/repo-e', name: 'repo-e', branch: 'main', isWorktree: false }];
    await refreshRepoList(() => Promise.resolve({ repos }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setCachedRepoList(repos);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
