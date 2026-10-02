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
const listeners = new Set<() => void>();

export function getCachedRepoList(): RepoEntry[] | null {
  return cached;
}

/** Calls `listener` whenever the cached list is replaced, so a long-mounted reader (the file
 *  panel) tracks refreshes triggered elsewhere. Returns the unsubscribe function. */
export function subscribeRepoList(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCachedRepoList(repos: RepoEntry[]): void {
  cached = repos;
  for (const listener of listeners) listener();
}

/** Fetches the list fresh and caches it; on failure returns the cached list, or null. */
export async function refreshRepoList(
  fetchRepos: () => Promise<ReposResponse> = listRepos,
): Promise<RepoEntry[] | null> {
  try {
    const { repos } = await fetchRepos();
    setCachedRepoList(repos);
    return repos;
  } catch {
    return cached;
  }
}
