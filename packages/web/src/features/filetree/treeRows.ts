import type { TreeEntry } from '@garden/shared';

export interface FlatTreeRow {
  readonly entry: TreeEntry;
  readonly depth: number;
  readonly expanded: boolean;
  /** The entry is gitignored, or sits under a gitignored directory (git tags only the topmost). */
  readonly ignored: boolean;
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
 * until its children arrive. An expanded directory (or the root) whose load failed gets one
 * error row where its children would be.
 */
export function visibleTreeRows(
  root: readonly TreeEntry[] | undefined,
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>,
  expandedPaths: ReadonlySet<string>,
  errorByPath: Readonly<Record<string, string>>,
): TreeListRow[] {
  const rows: TreeListRow[] = [];

  function pushError(path: string, depth: number): boolean {
    const message = errorByPath[path];
    if (message === undefined) return false;
    rows.push({ kind: 'error', path, depth, message });
    return true;
  }

  function walk(
    entries: readonly TreeEntry[] | undefined,
    depth: number,
    underIgnored: boolean,
  ): void {
    if (entries === undefined) return;
    for (const entry of entries) {
      const expanded = entry.kind === 'dir' && expandedPaths.has(entry.path);
      const ignored = underIgnored || entry.gitStatus === '!!';
      rows.push({ kind: 'entry', entry, depth, expanded, ignored });
      if (expanded && !pushError(entry.path, depth + 1)) {
        walk(childrenByPath[entry.path], depth + 1, ignored);
      }
    }
  }

  if (!pushError('', 0)) walk(root, 0, false);
  return rows;
}
