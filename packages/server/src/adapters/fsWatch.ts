import { watch } from 'node:fs';

/** The slice of `Logger` this adapter needs, declared locally rather than imported —
 *  one adapter per external system, composed together only in main.ts. */
export interface FsWatchLogger {
  warn(message: string): void;
}

export interface RootWatch {
  close(): void;
}

/** One `onChange` per quiet period; a burst of writes (a checkout, a build) is one signal. */
export const FS_CHANGE_DEBOUNCE_MS = 200;

/** Whether a change at `filename` (relative to the watched root) is worth a signal. */
export function countsAsChange(filename: string | null): boolean {
  // `null` means the platform could not say what changed, so assume it was something.
  if (filename === null) return true;
  const segments = filename.split(/[\\/]/);
  if (!segments.includes('.git')) return true;
  // Only the root's own index and HEAD move git status; in a worktree they live under the
  // main repo's `.git/worktrees/<name>/`, so pure index/HEAD changes there only reach the
  // client on backstop refetches.
  return (
    segments.length === 2 && segments[0] === '.git' && ['index', 'HEAD'].includes(segments[1]!)
  );
}

/** A native recursive watch on `root`. A watcher that errors (the Linux recursive watcher
 *  does when a directory vanishes mid-scan) is closed rather than restarted: the client's
 *  backstop refetches cover what it would have signalled. */
export function watchFsRoot(root: string, onChange: () => void, logger: FsWatchLogger): RootWatch {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!countsAsChange(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, FS_CHANGE_DEBOUNCE_MS);
  });
  const close = () => {
    clearTimeout(timer);
    watcher.close();
  };
  watcher.on('error', (error) => {
    logger.warn(`fs watch on ${root} failed: ${error.message}`);
    close();
  });
  return { close };
}
