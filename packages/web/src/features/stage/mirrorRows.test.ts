import type { SerializedDockview } from 'dockview-core';
import { describe, expect, it } from 'vitest';
import { groupIdsFromAppliedGrid2x2, resolveRowMirror } from './mirrorRows';

type GridNode = SerializedDockview['grid']['root'];

function leaf(id: string): GridNode {
  return { type: 'leaf', size: 500, data: { id, views: [id] } };
}

function branch(children: GridNode[]): GridNode {
  return { type: 'branch', size: 1000, data: children };
}

describe('resolveRowMirror', () => {
  it('returns null when neither row changed since the last observation', () => {
    expect(resolveRowMirror([300, 700], [400, 600], [300, 700], [400, 600])).toBeNull();
  });

  it('mirrors the top row onto the bottom when only the top row changed', () => {
    expect(resolveRowMirror([300, 700], [400, 600], [400, 600], [400, 600])).toEqual({
      target: 'bottom',
      widths: [300, 700],
    });
  });

  it('mirrors the bottom row onto the top when only the bottom row changed', () => {
    expect(resolveRowMirror([400, 600], [250, 750], [400, 600], [400, 600])).toEqual({
      target: 'top',
      widths: [250, 750],
    });
  });

  it('does nothing when both rows changed at once', () => {
    expect(resolveRowMirror([300, 700], [200, 800], [400, 600], [400, 600])).toBeNull();
  });

  it('does nothing for a height-only change that leaves a lopsided legacy layout untouched', () => {
    // The rows already differ here (a pre-fix persisted layout), but neither row's own widths
    // moved since the last observation — e.g. the row-height divider was dragged instead. See
    // `resolveRowMirror`'s doc comment for why that stays inert.
    expect(resolveRowMirror([300, 700], [500, 500], [300, 700], [500, 500])).toBeNull();
  });
});

describe('groupIdsFromAppliedGrid2x2', () => {
  it('reads the four leaf ids in [top-left, top-right, bottom-left, bottom-right] order', () => {
    const root = branch([branch([leaf('a'), leaf('b')]), branch([leaf('c'), leaf('d')])]);

    expect(groupIdsFromAppliedGrid2x2(root)).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([
    ['a lone leaf root', leaf('a')],
    [
      'three rows instead of two',
      branch([
        branch([leaf('a'), leaf('b')]),
        branch([leaf('c'), leaf('d')]),
        branch([leaf('e'), leaf('f')]),
      ]),
    ],
    [
      'a row with three leaves',
      branch([branch([leaf('a'), leaf('b'), leaf('c')]), branch([leaf('d'), leaf('e')])]),
    ],
    ['a row that is itself a leaf', branch([leaf('a'), branch([leaf('c'), leaf('d')])])],
  ])('returns null for %s', (_description, root) => {
    expect(groupIdsFromAppliedGrid2x2(root)).toBeNull();
  });
});
