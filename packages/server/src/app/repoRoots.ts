// One-shot node:fs reads are allowed in app/; see the dependency rules in docs/architecture.md.
import { realpath } from 'node:fs/promises';
import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';

export interface RepoRootsDeps {
  readonly git: Pick<GitPort, 'repoRoot'>;
  readonly projection: Projection;
  /** The configured roots, absolute. */
  readonly roots: readonly string[];
}

/**
 * Supplies the one session fact the fold cannot derive on its own: a cwd's repo root has to
 * be asked of git, and `reduce` runs no I/O. So this watches the projection for cwds it has
 * not asked about yet, asks, and dispatches the answer back as a fact — the same shape as
 * every other adapter-sourced event, which is what keeps the fold pure.
 *
 * Watching state rather than hooking each way a cwd can arrive is deliberate: a cwd reaches
 * the projection from a registered session, a transcript slice and a hook payload alike, and
 * a boot replay dispatches dozens of them before any client connects. One sweep over the
 * sessions covers all of those, with no resolution site to forget.
 *
 * Each cwd is asked about once. A directory in no repo makes git fail, and that failure is
 * the answer rather than something to retry: no fact is dispatched, so the session keeps the
 * null root it started with and works without a sidebar group. The one exception is a cwd that
 * is itself a configured root (a coordinator started in `~/src`, say): it is its own root, so
 * it gets a group of its own rather than none.
 */
export function watchRepoRoots(deps: RepoRootsDeps): () => void {
  const asked = new Set<string>();

  /** Compared by realpath, as git reports a root, so a trailing slash or a symlink in the
   *  configured root does not hide the match. */
  async function asConfiguredRoot(cwd: string): Promise<string> {
    const real = await realpath(cwd);
    const roots = await Promise.all(deps.roots.map((root) => realpath(root).catch(() => root)));
    if (!roots.includes(real)) throw new Error(`not a configured root: ${cwd}`);
    return real;
  }

  function resolve(cwd: string): void {
    if (cwd === '' || asked.has(cwd)) return;
    asked.add(cwd);
    void deps.git
      .repoRoot(cwd)
      .catch(() => asConfiguredRoot(cwd))
      .then((repoRoot) => {
        deps.projection.dispatch({ type: 'repo-root-resolved', cwd, repoRoot });
      })
      .catch(() => undefined);
  }

  function sweep(): void {
    for (const session of deps.projection.sessions()) resolve(session.cwd);
  }

  const unsubscribe = deps.projection.subscribe(sweep);
  sweep();
  return unsubscribe;
}
