// One-shot node:fs reads are allowed in app/; see the dependency rules in docs/architecture.md.
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { RepoEntry } from '@garden/shared';
import { listRepos } from './repos.js';
import type { ReposDeps } from './repos.js';

/** How long a scan's realpath set may vouch for a root. A repo that stops qualifying (its
 *  `.git` removed) is rejected at most this long after the scan that last listed it began. */
export const REPO_CACHE_TTL_MS = 10_000;

/** The requested root is not (the realpath of) an entry in the repo list — including a path
 *  that doesn't exist, so the response doesn't reveal whether it does. */
export class RootNotListedError extends Error {}

export interface RepoCatalog {
  /** The configured roots' repos from the TTL-bounded snapshot `resolveRoot` checks, rescanned
   *  only when it is stale or absent. A repo created within the TTL may be missing. */
  list(): Promise<RepoEntry[]>;
  /** The realpath of `requested` if it is the realpath of a listed repo entry, else throws
   *  `RootNotListedError`. Equality, not containment: a subdirectory of a repo is not a root. */
  resolveRoot(requested: string): Promise<string>;
}

interface Snapshot {
  readonly entries: RepoEntry[];
  readonly realpaths: ReadonlySet<string>;
  readonly fetchedAt: number;
}

export function createRepoCatalog(deps: ReposDeps): RepoCatalog {
  let snapshot: Snapshot | undefined;
  let inFlight: Promise<Snapshot> | undefined;

  /** Concurrent callers share one scan. `fetchedAt` is the scan's start, so a repo removed
   *  mid-scan is still bounded by the TTL. A failed scan leaves the stored snapshot alone and
   *  rejects every caller; nothing past its TTL is ever served as a fallback. */
  function refresh(): Promise<Snapshot> {
    inFlight ??= (async () => {
      const fetchedAt = Date.now();
      try {
        const entries = await listRepos(deps);
        const realpaths = new Set<string>();
        await Promise.all(
          entries.map(async (entry) => {
            const real = await realpath(entry.path).catch(() => undefined);
            if (real !== undefined) realpaths.add(real);
          }),
        );
        snapshot = { entries, realpaths, fetchedAt };
        return snapshot;
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  }

  async function fresh(): Promise<Snapshot> {
    if (snapshot !== undefined && Date.now() - snapshot.fetchedAt < REPO_CACHE_TTL_MS)
      return snapshot;
    return refresh();
  }

  return {
    async list() {
      return (await fresh()).entries;
    },

    async resolveRoot(requested) {
      // realpath resolves a relative path against the server's cwd, so it never gets one.
      if (!isAbsolute(requested)) throw new RootNotListedError(`root is not listed: ${requested}`);
      const real = await realpath(requested).catch(() => {
        throw new RootNotListedError(`root is not listed: ${requested}`);
      });
      if ((await fresh()).realpaths.has(real)) return real;
      if ((await refresh()).realpaths.has(real)) return real;
      throw new RootNotListedError(`root is not listed: ${requested}`);
    },
  };
}
