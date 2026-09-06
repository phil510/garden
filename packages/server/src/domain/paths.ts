/**
 * Collapses `.`, `..` and repeated separators in an absolute POSIX path. A `..` that would climb
 * past the root is dropped rather than escaping, which is how the kernel resolves `/..`.
 */
function normalize(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/**
 * Decides whether a path is the root or a descendant of it. Both arguments must already have
 * their symlinks resolved — that is I/O and belongs to the caller — because a lexical `..` walk
 * over an unresolved path lands somewhere the kernel would not.
 *
 * The comparison is separator-aware on purpose: `/foo/barbaz` shares a string prefix with
 * `/foo/bar` without being inside it. A relative argument is rejected outright, since anchoring
 * one to guess at its meaning is how a scoping check ends up permitting the path it was given.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  if (!root.startsWith('/') || !candidate.startsWith('/')) return false;
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(normalizedRoot === '/' ? '/' : `${normalizedRoot}/`);
}
