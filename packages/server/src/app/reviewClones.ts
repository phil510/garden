import { parseGitHubRepo } from '../domain/watches.js';
import { pickClone } from '../domain/reviews.js';
import { createLimiter } from './limiter.js';
import type { GitPort } from './ports.js';
import type { RepoCatalog } from './repoCatalog.js';

const MAX_CONCURRENT_GIT_INSPECTIONS = 8;

export interface CloneResolverDeps {
  readonly git: Pick<GitPort, 'isBareRepository' | 'remoteUrl'>;
  readonly catalog: Pick<RepoCatalog, 'list'>;
}

export interface CloneResolver {
  /** For each `owner/name` in `repos`, the path of the local main checkout whose `origin` is
   *  that repo, or null. */
  resolve(repos: readonly string[]): Promise<Map<string, string | null>>;
}

/** What git said about a path: `repo` is null for a bare clone and for a path with no GitHub origin. */
interface Seen {
  readonly repo: string | null;
}

/**
 * Matches review requests to local clones through the repo catalog. Worktrees are skipped, and so
 * are bare clones: the catalog lists a bare clone's directory as a repo, but nothing is checked
 * out there to start a session in. Git runs once per path; the catalog's own TTL is what notices
 * new and removed paths. A path whose git call fails is left out of this call and retried on the
 * next, and a catalog failure resolves every repo to null, so a local scan problem never faults
 * the GitHub queue.
 */
export function createCloneResolver(deps: CloneResolverDeps): CloneResolver {
  const seen = new Map<string, Seen>();
  // The first resolve inspects every catalog path; unbounded, that is one git subprocess per repo at once.
  const limit = createLimiter(MAX_CONCURRENT_GIT_INSPECTIONS);

  async function inspect(path: string): Promise<Seen | null> {
    try {
      if (await deps.git.isBareRepository(path)) return { repo: null };
      const url = await deps.git.remoteUrl(path);
      return { repo: url === null ? null : parseGitHubRepo(url) };
    } catch {
      return null;
    }
  }

  return {
    async resolve(repos) {
      const resolved = new Map<string, string | null>(repos.map((repo) => [repo, null]));
      let entries;
      try {
        entries = await deps.catalog.list();
      } catch {
        return resolved;
      }
      const paths = entries.filter((entry) => !entry.isWorktree).map((entry) => entry.path);
      await Promise.all(
        paths
          .filter((path) => !seen.has(path))
          .map(async (path) => {
            const result = await limit(() => inspect(path));
            if (result !== null) seen.set(path, result);
          }),
      );
      const candidates = paths.flatMap((path) => {
        const known = seen.get(path);
        return known === undefined ? [] : [{ path, repo: known.repo }];
      });
      for (const repo of repos) resolved.set(repo, pickClone(candidates, repo));
      return resolved;
    },
  };
}
