import { describe, expect, it } from 'vitest';
import { reorderGroups } from './reorderGroups';

describe('reorderGroups', () => {
  it('reorders two already-pinned groups', () => {
    const result = reorderGroups(['x', 'y', 'z'], ['x', 'y'], 'y', 'x');
    expect(result).toEqual({ groupOrder: ['y', 'x'], pinnedRepos: ['y', 'x'] });
  });

  it('pins an unpinned group dropped between two pinned groups, preserving their order', () => {
    const result = reorderGroups(['x', 'y', 'z'], ['x', 'y'], 'z', 'y');
    expect(result).toEqual({ groupOrder: ['x', 'z', 'y'], pinnedRepos: ['x', 'z', 'y'] });
  });

  it('pins only the dragged group when dropped among unpinned groups', () => {
    const result = reorderGroups(['a', 'b', 'c'], [], 'a', 'c');
    expect(result).toEqual({ groupOrder: ['a'], pinnedRepos: ['a'] });
  });

  it('drops a stale pinned repo that no longer has a visible group', () => {
    const result = reorderGroups(['x', 'y'], ['x', 'stale'], 'y', 'x');
    expect(result).toEqual({ groupOrder: ['y', 'x'], pinnedRepos: ['y', 'x'] });
  });
});
