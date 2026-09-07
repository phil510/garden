/** The last non-empty path segment, so a trailing slash does not turn into an empty name. */
function folderName(cwd: string): string {
  const segments = cwd.split('/').filter((segment) => segment !== '');
  return segments[segments.length - 1] ?? '';
}

/** tmux reads a leading `-` as a flag, and `:` and `.` as the session:window.pane
 *  separators — a name containing `.` is silently stored with `_` in its place and can
 *  then never be targeted, attached or killed. Every other character is fine. */
function sanitize(name: string): string {
  const cleaned = name.replace(/:/g, '-').replace(/\./g, '-').replace(/^-+/, '');
  return cleaned === '' ? 'session' : cleaned;
}

/**
 * Derives a tmux session name from a cwd's folder name, unique against the names
 * already taken. Pure so the collision-suffixing decision is testable without tmux.
 */
export function deriveTmuxName(cwd: string, takenNames: readonly string[]): string {
  const base = sanitize(folderName(cwd));
  if (!takenNames.includes(base)) return base;
  let suffix = 2;
  while (takenNames.includes(`${base}-${String(suffix)}`)) suffix++;
  return `${base}-${String(suffix)}`;
}
