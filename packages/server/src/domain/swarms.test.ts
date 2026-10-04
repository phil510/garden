import type { SwarmRecord } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { OverlayState } from './overlay.js';
import {
  pruneOverlay,
  resolveSwarmId,
  validatePlacement,
  wouldCreateParentCycle,
} from './swarms.js';

function anOverlay(overrides: Partial<OverlayState> = {}): OverlayState {
  return {
    version: 1,
    tmuxNames: {},
    groups: {},
    stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
    swarms: [],
    placements: {},
    swarmOrder: [],
    collapsedSwarms: [],
    hideDeadSwarms: [],
    watches: [],
    ...overrides,
  };
}

const swarm = (overrides: Partial<SwarmRecord> = {}): SwarmRecord => ({
  id: 'swarm-1',
  name: 'A swarm',
  archived: false,
  ...overrides,
});

describe('resolveSwarmId', () => {
  it('resolves solo for a session with no placement entry at all', () => {
    expect(resolveSwarmId({}, 'a')).toBeUndefined();
  });

  it('resolves solo for an entry with neither parent nor swarmId set', () => {
    expect(resolveSwarmId({ a: {} }, 'a')).toBeUndefined();
  });

  it('resolves the swarm directly for a top-level member', () => {
    expect(resolveSwarmId({ a: { swarmId: 'swarm-1' } }, 'a')).toBe('swarm-1');
  });

  it('walks parent up to the top-level ancestor', () => {
    const placements = {
      grandchild: { parent: 'child' },
      child: { parent: 'orchestrator' },
      orchestrator: { swarmId: 'swarm-1' },
    };
    expect(resolveSwarmId(placements, 'grandchild')).toBe('swarm-1');
  });

  it('resolves solo when the parent chain ends at a dangling (unknown) parent', () => {
    expect(resolveSwarmId({ a: { parent: 'ghost' } }, 'a')).toBeUndefined();
  });

  it('resolves the same swarm for several top-level members with no orchestrator', () => {
    const placements = {
      a: { swarmId: 'swarm-1' },
      b: { swarmId: 'swarm-1' },
    };
    expect(resolveSwarmId(placements, 'a')).toBe('swarm-1');
    expect(resolveSwarmId(placements, 'b')).toBe('swarm-1');
  });
});

describe('wouldCreateParentCycle', () => {
  it('rejects a session adopting itself', () => {
    expect(wouldCreateParentCycle({}, 'a', 'a')).toBe(true);
  });

  it('rejects a session adopting its own ancestor', () => {
    const placements = { child: { parent: 'a' }, a: {} };
    expect(wouldCreateParentCycle(placements, 'a', 'child')).toBe(true);
  });

  it('allows adopting an unrelated session', () => {
    const placements = { a: {}, b: {} };
    expect(wouldCreateParentCycle(placements, 'a', 'b')).toBe(false);
  });

  it('allows adopting a dangling (unplaced) session', () => {
    expect(wouldCreateParentCycle({}, 'a', 'ghost')).toBe(false);
  });
});

describe('validatePlacement', () => {
  it('rejects a swarm target that does not exist', () => {
    const overlay = anOverlay();
    expect(validatePlacement(overlay, 'a', { type: 'swarm', swarmId: 'swarm-1' })).toMatchObject({
      ok: false,
    });
  });

  it('accepts a swarm target that exists', () => {
    const overlay = anOverlay({ swarms: [swarm()] });
    expect(validatePlacement(overlay, 'a', { type: 'swarm', swarmId: 'swarm-1' })).toEqual({
      ok: true,
    });
  });

  it('rejects a parent target that would create a cycle', () => {
    const overlay = anOverlay({ placements: { child: { parent: 'a' } } });
    expect(validatePlacement(overlay, 'a', { type: 'parent', parentId: 'child' })).toMatchObject({
      ok: false,
    });
  });

  it('accepts a parent target with no cycle', () => {
    const overlay = anOverlay();
    expect(validatePlacement(overlay, 'a', { type: 'parent', parentId: 'b' })).toEqual({
      ok: true,
    });
  });

  it('accepts placement type none unconditionally', () => {
    const overlay = anOverlay();
    expect(validatePlacement(overlay, 'a', { type: 'none' })).toEqual({ ok: true });
  });
});

describe('pruneOverlay', () => {
  it('drops placements for unknown session ids', () => {
    const overlay = anOverlay({ placements: { known: {}, gone: { swarmId: 'swarm-1' } } });

    const result = pruneOverlay(overlay, new Set(['known']));

    expect(result.placements).toEqual({ known: {} });
  });

  it('splices around a pruned ancestor so its surviving descendant keeps its swarm', () => {
    const overlay = anOverlay({
      swarms: [swarm()],
      placements: {
        orchestrator: { swarmId: 'swarm-1' },
        child: { parent: 'orchestrator' },
      },
    });

    const result = pruneOverlay(overlay, new Set(['child']));

    expect(result.placements).toEqual({ child: { swarmId: 'swarm-1' } });
    expect(result.swarms).toEqual([swarm()]);
  });

  it('splices through a chain of several dropped ancestors', () => {
    const overlay = anOverlay({
      placements: {
        top: { swarmId: 'swarm-1' },
        mid1: { parent: 'top' },
        mid2: { parent: 'mid1' },
        survivor: { parent: 'mid2' },
      },
    });

    const result = pruneOverlay(overlay, new Set(['survivor']));

    expect(result.placements).toEqual({ survivor: { swarmId: 'swarm-1' } });
  });

  it('deletes a swarm left with zero resolving members', () => {
    const overlay = anOverlay({
      swarms: [swarm(), swarm({ id: 'swarm-2', name: 'Still has members' })],
      placements: {
        gone: { swarmId: 'swarm-1' },
        stays: { swarmId: 'swarm-2' },
      },
    });

    const result = pruneOverlay(overlay, new Set(['stays']));

    expect(result.swarms).toEqual([swarm({ id: 'swarm-2', name: 'Still has members' })]);
  });

  it('clears a parent reference once the parent stops being known, even though it never had its own entry', () => {
    // The everyday unplaced-parent case (resolveSwarmId treats it as solo) becomes stale once
    // the parent itself is no longer known — nothing else ever cleans this up, since 'gone'
    // was never a key of `placements` for `pruneOverlay`'s own-entry pass to catch.
    const overlay = anOverlay({ placements: { a: { parent: 'gone' } } });

    const result = pruneOverlay(overlay, new Set(['a']));

    expect(result.placements).toEqual({ a: {} });
  });

  it('does not hang on a hand-corrupted cyclic parent reference between two unknown ids', () => {
    const overlay = anOverlay({
      placements: {
        x: { parent: 'y' },
        y: { parent: 'x' },
        k: { parent: 'x' },
      },
    });

    const result = pruneOverlay(overlay, new Set(['k']));

    // Whatever it resolves to, it must terminate and drop the unknown x/y entries.
    expect(Object.keys(result.placements)).toEqual(['k']);
  });

  it('returns the same overlay reference when nothing needs dropping', () => {
    const overlay = anOverlay({ placements: { a: {} } });
    expect(pruneOverlay(overlay, new Set(['a']))).toBe(overlay);
  });

  it('treats a session known via tmuxNames-derived ids the same as one in the projection', () => {
    // pruneKnownSessions (app/swarms.ts) is what unions the two sources; this only asserts
    // pruneOverlay itself does not distinguish where a known id came from.
    const overlay = anOverlay({ placements: { a: {}, b: {} } });
    const result = pruneOverlay(overlay, new Set(['a', 'b']));
    expect(result.placements).toEqual({ a: {}, b: {} });
  });
});
