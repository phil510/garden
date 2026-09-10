/**
 * The folder name a path ends in, used wherever the UI labels a directory: sidebar repo group
 * headers, a session row whose transcript has not yielded a title yet, and a stage pane's
 * project/worktree subheader lines. A path that is all separators has no segment to show, so
 * it stands in for itself.
 */
export function lastPathSegment(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}
