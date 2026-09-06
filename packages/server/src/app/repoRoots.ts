import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';

export interface RepoRootsDeps {
  readonly git: Pick<GitPort, 'repoRoot'>;
  readonly projection: Projection;
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
 * null root it started with and works without a sidebar group.
 */
export function watchRepoRoots(deps: RepoRootsDeps): () => void {
  const asked = new Set<string>();

  function resolve(cwd: string): void {
    if (cwd === '' || asked.has(cwd)) return;
    asked.add(cwd);
    void deps.git
      .repoRoot(cwd)
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
