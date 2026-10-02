import type { TreeEntry } from '@garden/shared';

/** What the tree knows about its directories: loaded children, the last failure per path, and
 *  the newest fetch sequence applied per path. */
export interface DirLoadState {
  readonly childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>;
  readonly errorByPath: Readonly<Record<string, string>>;
  readonly appliedSeq: Readonly<Record<string, number>>;
}

export type DirOutcome =
  | { readonly ok: true; readonly entries: readonly TreeEntry[] }
  | { readonly ok: false; readonly message: string };

export const emptyDirLoads: DirLoadState = { childrenByPath: {}, errorByPath: {}, appliedSeq: {} };

/** Records a fetch's outcome unless a newer one for the same path was already applied. A failure
 *  drops the path's stale children, so a refetch that fails shows the error, not old entries. */
export function applyDirResult(
  state: DirLoadState,
  path: string,
  seq: number,
  outcome: DirOutcome,
): DirLoadState {
  if (seq < (state.appliedSeq[path] ?? 0)) return state;
  const appliedSeq = { ...state.appliedSeq, [path]: seq };
  if (outcome.ok) {
    return {
      childrenByPath: { ...state.childrenByPath, [path]: outcome.entries },
      errorByPath: without(state.errorByPath, path),
      appliedSeq,
    };
  }
  return {
    childrenByPath: without(state.childrenByPath, path),
    errorByPath: { ...state.errorByPath, [path]: outcome.message },
    appliedSeq,
  };
}

/** The paths a refresh round refetches: every loaded path, plus errored ones still reachable —
 *  the root, or a directory its loaded parent still lists. An errored path its parent no longer
 *  lists (a deleted folder left in the persisted expanded list) isn't retried forever. */
export function refreshPaths(state: DirLoadState): string[] {
  const paths = Object.keys(state.childrenByPath);
  for (const path of Object.keys(state.errorByPath)) {
    if (path === '' || isListedDir(state.childrenByPath, path)) paths.push(path);
  }
  return paths;
}

function isListedDir(
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>,
  path: string,
): boolean {
  const slash = path.lastIndexOf('/');
  const parent = slash === -1 ? '' : path.slice(0, slash);
  return childrenByPath[parent]?.some((e) => e.path === path && e.kind === 'dir') ?? false;
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}
