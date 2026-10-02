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
    expect(visibleTreeRows(root, {}, new Set(), {})).toEqual([
      { kind: 'entry', entry: root[0], depth: 0, expanded: false, ignored: false },
      { kind: 'entry', entry: root[1], depth: 0, expanded: false, ignored: false },
    ]);
  });

  it('inserts a directory’s fetched children directly after it once expanded', () => {
    const dir = entry({ name: 'src', path: 'src', kind: 'dir' });
    const child = entry({ name: 'index.ts', path: 'src/index.ts' });
    const childrenByPath = { src: [child] };
    const rows = visibleTreeRows([dir], childrenByPath, new Set(['src']), {});
    expect(rows).toEqual([
      { kind: 'entry', entry: dir, depth: 0, expanded: true, ignored: false },
      { kind: 'entry', entry: child, depth: 1, expanded: false, ignored: false },
    ]);
  });

  it('renders an expanded directory as a leaf until its children have been fetched', () => {
    const dir = entry({ name: 'src', path: 'src', kind: 'dir' });
    const rows = visibleTreeRows([dir], {}, new Set(['src']), {});
    expect(rows).toEqual([{ kind: 'entry', entry: dir, depth: 0, expanded: true, ignored: false }]);
  });

  it('keeps gitignored entries, and the untagged contents of an ignored directory', () => {
    const ignoredDir = entry({ name: 'dist', path: 'dist', kind: 'dir', gitStatus: '!!' });
    const untaggedChild = entry({ name: 'bundle.js', path: 'dist/bundle.js' });
    const tracked = entry({ name: 'a.ts', path: 'a.ts' });
    const rows = visibleTreeRows(
      [ignoredDir, tracked],
      { dist: [untaggedChild] },
      new Set(['dist']),
      {},
    );
    expect(rows).toEqual([
      { kind: 'entry', entry: ignoredDir, depth: 0, expanded: true, ignored: true },
      { kind: 'entry', entry: untaggedChild, depth: 1, expanded: false, ignored: true },
      { kind: 'entry', entry: tracked, depth: 0, expanded: false, ignored: false },
    ]);
  });

  it('marks every row at any depth under an ignored directory as ignored, but not its siblings', () => {
    const ignoredDir = entry({ name: 'dist', path: 'dist', kind: 'dir', gitStatus: '!!' });
    const subDir = entry({ name: 'assets', path: 'dist/assets', kind: 'dir' });
    const grandchild = entry({ name: 'a.png', path: 'dist/assets/a.png' });
    const tracked = entry({ name: 'a.ts', path: 'a.ts' });
    const rows = visibleTreeRows(
      [ignoredDir, tracked],
      { dist: [subDir], 'dist/assets': [grandchild] },
      new Set(['dist', 'dist/assets']),
      {},
    );
    expect(rows.map((r) => r.kind === 'entry' && [r.entry.path, r.ignored])).toEqual([
      ['dist', true],
      ['dist/assets', true],
      ['dist/assets/a.png', true],
      ['a.ts', false],
    ]);
  });

  describe('load errors', () => {
    const dir = entry({ name: 'src', path: 'src', kind: 'dir' });
    const sibling = entry({ name: 'z.ts', path: 'z.ts' });

    it('puts one error row at depth+1 directly after an expanded directory that failed to load', () => {
      const rows = visibleTreeRows([dir, sibling], {}, new Set(['src']), { src: 'denied' });
      expect(rows).toEqual([
        { kind: 'entry', entry: dir, depth: 0, expanded: true, ignored: false },
        { kind: 'error', path: 'src', depth: 1, message: 'denied' },
        { kind: 'entry', entry: sibling, depth: 0, expanded: false, ignored: false },
      ]);
    });

    it('shows no error row for a collapsed directory', () => {
      const rows = visibleTreeRows([dir], {}, new Set(), { src: 'denied' });
      expect(rows).toEqual([
        { kind: 'entry', entry: dir, depth: 0, expanded: false, ignored: false },
      ]);
    });

    it('replaces the whole list with a single depth-zero row when the root failed to load', () => {
      const rows = visibleTreeRows(undefined, {}, new Set(), { '': 'server down' });
      expect(rows).toEqual([{ kind: 'error', path: '', depth: 0, message: 'server down' }]);
    });
  });
});
