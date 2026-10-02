import type { RepoEntry } from '@garden/shared';

/** Where a clicked `path:line` opens: a listed project root, or the clicking session's own cwd. */
export type PathLineTarget =
  | { kind: 'root'; root: string; path: string; line: number | null }
  | { kind: 'session'; sessionId: string; path: string; line: number | null };

/** Collapses `.`, `..` and repeated separators in an absolute POSIX path, lexically. */
export function normalizePath(abs: string): string {
  const segments: string[] = [];
  for (const segment of abs.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/** An absolute path as-is, a relative one joined to `cwd`; normalized either way. */
export function resolveAgainst(cwd: string, clicked: string): string {
  return normalizePath(clicked.startsWith('/') ? clicked : `${cwd}/${clicked}`);
}

/** Separator-aware containment: `/a/foo` contains itself and `/a/foo/x`, not `/a/foobar`. */
export function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(normalizedRoot === '/' ? '/' : `${normalizedRoot}/`);
}

/** The entry containing `absPath` with the longest path, so a worktree beats the repo holding it. */
export function mostSpecificEntry(repos: readonly RepoEntry[], absPath: string): RepoEntry | null {
  let best: RepoEntry | null = null;
  let bestLength = -1;
  for (const repo of repos) {
    if (!isWithin(repo.path, absPath)) continue;
    const length = normalizePath(repo.path).length;
    if (length > bestLength) {
      best = repo;
      bestLength = length;
    }
  }
  return best;
}

/** `root`-relative `/`-joined path ('' for the root itself). Call only after `isWithin`. */
export function relativeTo(root: string, abs: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedAbs = normalizePath(abs);
  if (normalizedAbs === normalizedRoot) return '';
  return normalizedAbs.slice(normalizedRoot === '/' ? 1 : normalizedRoot.length + 1);
}

/** Decides where a terminal `path:line` click opens; null when no route can reach the file. */
export function resolvePathLineTarget(
  repos: readonly RepoEntry[],
  sessionCwd: string,
  sessionId: string,
  clicked: string,
  line: number | null,
): PathLineTarget | null {
  const abs = resolveAgainst(sessionCwd, clicked);
  const entry = mostSpecificEntry(repos, abs);
  if (entry) return { kind: 'root', root: entry.path, path: relativeTo(entry.path, abs), line };
  if (isWithin(sessionCwd, abs)) {
    return { kind: 'session', sessionId, path: relativeTo(sessionCwd, abs), line };
  }
  return null;
}
