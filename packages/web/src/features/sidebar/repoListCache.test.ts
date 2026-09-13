import { describe, expect, it } from 'vitest';
import { getCachedRepoList, setCachedRepoList } from './repoListCache';

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
});
