import type { FileResponse } from '@garden/shared';
import type { FsScope } from '../../api/client';

/** A file the viewer can show: root-relative inside a listed project, or session-cwd-relative. */
export type ViewerSource =
  | { kind: 'root'; root: string; path: string }
  | { kind: 'session'; sessionId: string; path: string };

/** A session-sourced file shown on top of the persisted one. It lives only while the panel's
 *  root and open file are what they were when it opened. */
export interface TransientFile {
  sessionId: string;
  path: string;
  root: string | null;
  openFile: string | null;
}

/** The transient file if the panel's root and open file are still the ones it opened against,
 *  else null — the caller stores the result, so a change drops it for good. */
export function liveTransient(
  root: string | null,
  openFile: string | null,
  transient: TransientFile | null,
): TransientFile | null {
  return transient !== null && transient.root === root && transient.openFile === openFile
    ? transient
    : null;
}

/** The file the viewer should show: a live transient file, else the root's open file. */
export function activeSource(
  root: string | null,
  openFile: string | null,
  transient: TransientFile | null,
): ViewerSource | null {
  const live = liveTransient(root, openFile, transient);
  if (live !== null) return { kind: 'session', sessionId: live.sessionId, path: live.path };
  if (root !== null && openFile !== null) return { kind: 'root', root, path: openFile };
  return null;
}

export function sourceKey(source: ViewerSource): string {
  return source.kind === 'root'
    ? `root ${source.root} ${source.path}`
    : `session ${source.sessionId} ${source.path}`;
}

export function sourceScope(source: ViewerSource): FsScope {
  return source.kind === 'root' ? { root: source.root } : { sessionId: source.sessionId };
}

/** Whether a refetch brought nothing new, so the viewer can keep its view mode and scroll. */
export function sameFileContent(a: FileResponse, b: FileResponse): boolean {
  if (a.kind !== b.kind || a.path !== b.path) return false;
  switch (a.kind) {
    case 'text':
      return b.kind === 'text' && a.text === b.text && a.truncated === b.truncated;
    case 'image':
      return (
        b.kind === 'image' &&
        a.mimeType === b.mimeType &&
        a.truncated === b.truncated &&
        (a.truncated || (!b.truncated && a.data === b.data))
      );
    case 'binary':
      return true;
  }
}

/** The outcome of the viewer's last fetch for `key`: the file, or why it couldn't be loaded. */
export interface LoadedFile {
  key: string;
  result: { kind: 'file'; file: FileResponse } | { kind: 'error'; message: string };
}

/** The value to store after a fetch for `key` resolves. Keeps `current` by reference only when
 *  both are the same file for the same key with nothing new, so a refresh doesn't reset the
 *  view mode or re-tokenize; an error always replaces stale content, and vice versa. */
export function nextLoaded(
  current: LoadedFile | null,
  key: string,
  result: LoadedFile['result'],
): LoadedFile {
  if (
    current !== null &&
    current.key === key &&
    current.result.kind === 'file' &&
    result.kind === 'file' &&
    sameFileContent(current.result.file, result.file)
  ) {
    return current;
  }
  return { key, result };
}
