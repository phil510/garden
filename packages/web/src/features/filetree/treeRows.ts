import type { TreeEntry } from '@garden/shared';

/** `git status --porcelain --ignored=matching`'s code for a path excluded by `.gitignore`. */
const IGNORED_STATUS = '!!';

export interface FlatTreeRow {
  readonly entry: TreeEntry;
  readonly depth: number;
  readonly expanded: boolean;
}

/**
 * Flattens a lazily-fetched tree into the rows a list should render, in the order a nested
 * tree view shows them: each directory immediately followed by its children when expanded.
 * A directory not yet fetched (absent from `childrenByPath`) renders as a collapsed leaf
 * until its children arrive. A gitignored entry — and everything nested under it, since git
 * reports a fully-ignored directory as a single ignored path rather than one per file inside
 * it — is skipped unless `showGitignored` is set.
 */
export function visibleTreeRows(
  root: readonly TreeEntry[] | undefined,
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>,
  expandedPaths: ReadonlySet<string>,
  showGitignored: boolean,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];

  function walk(entries: readonly TreeEntry[] | undefined, depth: number): void {
    if (entries === undefined) return;
    for (const entry of entries) {
      if (!showGitignored && entry.gitStatus === IGNORED_STATUS) continue;
      const expanded = entry.kind === 'dir' && expandedPaths.has(entry.path);
      rows.push({ entry, depth, expanded });
      if (expanded) walk(childrenByPath[entry.path], depth + 1);
    }
  }

  walk(root, 0);
  return rows;
}
