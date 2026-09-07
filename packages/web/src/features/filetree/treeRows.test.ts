import type { TreeEntry } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { visibleTreeRows } from './treeRows';

function entry(overrides: Partial<TreeEntry> & Pick<TreeEntry, 'name' | 'path'>): TreeEntry {
  return { kind: 'file', gitStatus: null, ...overrides };
}

describe('visibleTreeRows', () => {
  it('renders the root entries at depth zero without expanding anything', () => {
    const root = [
      entry({ name: 'a.ts', path: 'a.ts' }),
      entry({ name: 'src', path: 'src', kind: 'dir' }),
    ];
    expect(visibleTreeRows(root, {}, new Set(), false)).toEqual([
      { entry: root[0], depth: 0, expanded: false },
      { entry: root[1], depth: 0, expanded: false },
    ]);
  });

  it('inserts a directory’s fetched children directly after it once expanded', () => {
    const dir = entry({ name: 'src', path: 'src', kind: 'dir' });
    const child = entry({ name: 'index.ts', path: 'src/index.ts' });
    const childrenByPath = { src: [child] };
    const rows = visibleTreeRows([dir], childrenByPath, new Set(['src']), false);
    expect(rows).toEqual([
      { entry: dir, depth: 0, expanded: true },
      { entry: child, depth: 1, expanded: false },
    ]);
  });

  it('renders an expanded directory as a leaf until its children have been fetched', () => {
    const dir = entry({ name: 'src', path: 'src', kind: 'dir' });
    const rows = visibleTreeRows([dir], {}, new Set(['src']), false);
    expect(rows).toEqual([{ entry: dir, depth: 0, expanded: true }]);
  });

  it('hides a gitignored entry by default and shows it once the toggle is on', () => {
    const ignored = entry({ name: 'dist', path: 'dist', kind: 'dir', gitStatus: '!!' });
    const tracked = entry({ name: 'a.ts', path: 'a.ts' });
    const root = [ignored, tracked];
    expect(visibleTreeRows(root, {}, new Set(), false)).toEqual([
      { entry: tracked, depth: 0, expanded: false },
    ]);
    expect(visibleTreeRows(root, {}, new Set(), true)).toEqual([
      { entry: ignored, depth: 0, expanded: false },
      { entry: tracked, depth: 0, expanded: false },
    ]);
  });

  it('hides every descendant of an ignored directory even if individually untagged', () => {
    const ignoredDir = entry({ name: 'dist', path: 'dist', kind: 'dir', gitStatus: '!!' });
    const untaggedChild = entry({ name: 'bundle.js', path: 'dist/bundle.js' });
    const childrenByPath = { dist: [untaggedChild] };
    const rows = visibleTreeRows([ignoredDir], childrenByPath, new Set(['dist']), false);
    expect(rows).toEqual([]);
  });
});
