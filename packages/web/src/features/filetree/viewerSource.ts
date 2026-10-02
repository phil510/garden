import type { FileResponse } from '@garden/shared';
import type { FsScope } from '../../api/client';

/** A file the viewer can show: root-relative inside a listed project, or session-cwd-relative. */
export type ViewerSource =
  | { kind: 'root'; root: string; path: string }
  | { kind: 'session'; sessionId: string; path: string };

/** A session-sourced file shown on top of the persisted one. It stays active only while the
 *  panel's root and open file are what they were when it opened. */
export interface TransientFile {
  sessionId: string;
  path: string;
  root: string | null;
  openFile: string | null;
}

/** The file the viewer should show: a still-valid transient file, else the root's open file. */
export function activeSource(
  root: string | null,
  openFile: string | null,
  transient: TransientFile | null,
): ViewerSource | null {
  if (transient !== null && transient.root === root && transient.openFile === openFile) {
    return { kind: 'session', sessionId: transient.sessionId, path: transient.path };
  }
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
