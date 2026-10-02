import type { RepoEntry } from '@garden/shared';

/**
 * A read-through cache of the `/repos` list, kept across mounts of `NewSessionModal` so
 * reopening the picker renders instantly instead of repaying the fetch, and read by the file
 * panel's project dropdown and the terminal `path:line` lookup. Not
 * one of the zustand stores in `state/`: this caches server-fetched data (the same for any
 * browser hitting this host), not per-browser UI state — `docs/architecture.md` §5 scopes
 * `localStore.ts` to the latter only. Each reader refetches regardless, so a stale
 * value here is only ever a placeholder, never the final answer.
 */
let cached: RepoEntry[] | null = null;

export function getCachedRepoList(): RepoEntry[] | null {
  return cached;
}

export function setCachedRepoList(repos: RepoEntry[]): void {
  cached = repos;
}
