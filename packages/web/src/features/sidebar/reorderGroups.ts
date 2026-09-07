import { arrayMove } from '@dnd-kit/sortable';

/**
 * Dragging a group pins it and sets its order. `visibleOrder` is the repo roots in the
 * sequence they were rendered (pinned groups first in drag order, then unpinned by activity).
 * Moving `activeRepoRoot` to `overRepoRoot`'s position yields the new visible sequence; the
 * pinned subsequence of that sequence, in order, becomes the new `groupOrder`. An unpinned
 * group dropped among other unpinned groups becomes the sole pinned group rather than keeping
 * its dropped position — pinned groups always render before unpinned ones, so a drop position
 * with no other pinned group nearby has no unpinned reference point to place it against.
 */
export function reorderGroups(
  visibleOrder: string[],
  pinnedRepos: string[],
  activeRepoRoot: string,
  overRepoRoot: string,
): { groupOrder: string[]; pinnedRepos: string[] } {
  const moved = arrayMove(
    visibleOrder,
    visibleOrder.indexOf(activeRepoRoot),
    visibleOrder.indexOf(overRepoRoot),
  );
  const nowPinned = new Set(pinnedRepos);
  nowPinned.add(activeRepoRoot);

  const pinnedOrder = moved.filter((root) => nowPinned.has(root));
  return { groupOrder: pinnedOrder, pinnedRepos: pinnedOrder };
}
