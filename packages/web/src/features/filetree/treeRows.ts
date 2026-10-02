import type { TreeEntry } from '@garden/shared';

/** `git status --porcelain --ignored=matching`'s code for a path excluded by `.gitignore`. */
const IGNORED_STATUS = '!!';

export interface FlatTreeRow {
  readonly entry: TreeEntry;
  readonly depth: number;
  readonly expanded: boolean;
}

/** What a directory shows in place of its children when its load failed. */
export interface TreeErrorRow {
  readonly kind: 'error';
  readonly path: string;
  readonly depth: number;
  readonly message: string;
}

export type TreeListRow = ({ readonly kind: 'entry' } & FlatTreeRow) | TreeErrorRow;

/**
 * Flattens a lazily-fetched tree into the rows a list should render, in the order a nested
 * tree view shows them: each directory immediately followed by its children when expanded.
 * A directory not yet fetched (absent from `childrenByPath`) renders as a collapsed leaf
 * until its children arrive. A gitignored entry — and everything nested under it, since git
 * reports a fully-ignored directory as a single ignored path rather than one per file inside
 * it — is skipped unless `showGitignored` is set. An expanded directory (or the root) whose load
 * failed gets one error row where its children would be.
 */
export function visibleTreeRows(
  root: readonly TreeEntry[] | undefined,
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>,
  expandedPaths: ReadonlySet<string>,
  showGitignored: boolean,
  errorByPath: Readonly<Record<string, string>>,
): TreeListRow[] {
  const rows: TreeListRow[] = [];

  function pushError(path: string, depth: number): boolean {
    const message = errorByPath[path];
    if (message === undefined) return false;
    rows.push({ kind: 'error', path, depth, message });
    return true;
  }

  function walk(entries: readonly TreeEntry[] | undefined, depth: number): void {
    if (entries === undefined) return;
    for (const entry of entries) {
      if (!showGitignored && entry.gitStatus === IGNORED_STATUS) continue;
      const expanded = entry.kind === 'dir' && expandedPaths.has(entry.path);
      rows.push({ kind: 'entry', entry, depth, expanded });
      if (expanded && !pushError(entry.path, depth + 1)) {
        walk(childrenByPath[entry.path], depth + 1);
      }
    }
  }

  if (!pushError('', 0)) walk(root, 0);
  return rows;
}
