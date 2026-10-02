import type { RepoEntry, ReposResponse } from '@garden/shared';
import { listRepos } from '../../api/client';

/**
 * The last `/repos` list fetched, kept across mounts of `NewSessionModal` so reopening the
 * picker renders instantly instead of repaying the fetch. The file panel and the terminal
 * `path:line` lookup also read it, the latter through `refreshRepoList`, which fetches anew and
 * falls back to this value. Not one of the zustand stores in `state/`: this caches
 * server-fetched data (the same for any browser hitting this host), not per-browser UI state —
 * `docs/architecture.md` §5 scopes `localStore.ts` to the latter only.
 */
let cached: RepoEntry[] | null = null;

export function getCachedRepoList(): RepoEntry[] | null {
  return cached;
}

export function setCachedRepoList(repos: RepoEntry[]): void {
  cached = repos;
}

/** Fetches the list fresh and caches it; on failure returns the cached list, or null. */
export async function refreshRepoList(
  fetchRepos: () => Promise<ReposResponse> = listRepos,
): Promise<RepoEntry[] | null> {
  try {
    const { repos } = await fetchRepos();
    cached = repos;
    return repos;
  } catch {
    return cached;
  }
}
