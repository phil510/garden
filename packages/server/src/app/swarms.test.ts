import { aSession } from '@garden/shared/fixtures';
import type { SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { OverlayState } from './ports.js';
import type { Projection } from './projection.js';
import { SessionNotFoundError } from './sessions.js';
import {
  archiveSwarm,
  createSwarm,
  deleteSwarm,
  placeSession,
  pruneKnownSessions,
  recordSpawn,
  renameSwarm,
  SwarmCycleError,
  SwarmNotFoundError,
  unarchiveSwarm,
} from './swarms.js';

const emptyOverlay: OverlayState = {
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
  pipes: {},
};

/** In-memory: `app/swarms.ts`'s whole contract with the store is through
 *  `projection.updateOverlay`, so the fake tracks every write and returns the same `base`
 *  reference back to the caller when `mutate` itself does, mirroring the real projection's
 *  no-op-skip behavior (`app/projection.ts`). */
function fakeProjection(overlay: OverlayState, sessions: SessionState[] = []) {
  let current = overlay;
  const writes: OverlayState[] = [];
  const projection: Projection = {
    sessions: () => sessions,
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: () => {
      throw new Error('not used by this test');
    },
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    updateOverlay: (mutate) => {
      const next = mutate(current);
      if (next !== current) {
        current = next;
        writes.push(next);
      }
      return next;
    },
    overlay: () => {
      throw new Error('not used by this test');
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => {
      throw new Error('not used by this test');
    },
  };
  return { projection, writes, current: () => current };
}

describe('createSwarm', () => {
  it('adds a new, unarchived swarm record and returns its id', () => {
    const { projection, current } = fakeProjection(emptyOverlay);

    const { id } = createSwarm({ projection }, { name: 'My swarm' });

    expect(current().swarms).toEqual([{ id, name: 'My swarm', archived: false }]);
  });
});

describe('renameSwarm', () => {
  it('renames an existing swarm', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'Old', archived: false }],
    };
    const { projection, current } = fakeProjection(overlay);

    renameSwarm({ projection }, { id: 's1', name: 'New' });

    expect(current().swarms).toEqual([{ id: 's1', name: 'New', archived: false }]);
  });

  it('throws SwarmNotFoundError and performs no write for an unknown swarm', () => {
    const { projection, writes } = fakeProjection(emptyOverlay);

    expect(() => renameSwarm({ projection }, { id: 'nope', name: 'New' })).toThrow(
      SwarmNotFoundError,
    );
    expect(writes).toEqual([]);
  });
});

describe('archiveSwarm / unarchiveSwarm', () => {
  it('toggles the archived flag', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'A', archived: false }],
    };
    const { projection, current } = fakeProjection(overlay);

    archiveSwarm({ projection }, { id: 's1' });
    expect(current().swarms).toEqual([{ id: 's1', name: 'A', archived: true }]);

    unarchiveSwarm({ projection }, { id: 's1' });
    expect(current().swarms).toEqual([{ id: 's1', name: 'A', archived: false }]);
  });

  it('throws SwarmNotFoundError and performs no write for an unknown swarm', () => {
    const { projection, writes } = fakeProjection(emptyOverlay);

    expect(() => archiveSwarm({ projection }, { id: 'nope' })).toThrow(SwarmNotFoundError);
    expect(writes).toEqual([]);
  });
});

describe('deleteSwarm', () => {
  it('removes the swarm record and clears swarmId on its members, keeping their parent edges', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'A', archived: false }],
      placements: {
        top: { swarmId: 's1' },
        child: { parent: 'top' },
      },
    };
    const { projection, current } = fakeProjection(overlay);

    deleteSwarm({ projection }, { id: 's1' });

    expect(current().swarms).toEqual([]);
    expect(current().placements).toEqual({ top: {}, child: { parent: 'top' } });
  });

  it('throws SwarmNotFoundError and performs no write for an unknown swarm', () => {
    const { projection, writes } = fakeProjection(emptyOverlay);

    expect(() => deleteSwarm({ projection }, { id: 'nope' })).toThrow(SwarmNotFoundError);
    expect(writes).toEqual([]);
  });
});

describe('placeSession', () => {
  it('throws SessionNotFoundError and performs no write for an unknown sessionId', () => {
    const { projection, writes } = fakeProjection(emptyOverlay);

    expect(() =>
      placeSession({ projection }, { sessionId: 'ghost', placement: { type: 'none' } }),
    ).toThrow(SessionNotFoundError);
    expect(writes).toEqual([]);
  });

  it('throws SessionNotFoundError and performs no write for an unknown parentId', () => {
    const { projection, writes } = fakeProjection(emptyOverlay, [aSession({ id: 'a' })]);

    expect(() =>
      placeSession(
        { projection },
        { sessionId: 'a', placement: { type: 'parent', parentId: 'ghost' } },
      ),
    ).toThrow(SessionNotFoundError);
    expect(writes).toEqual([]);
  });

  it('throws SwarmNotFoundError and performs no write for an unknown swarmId', () => {
    const { projection, writes } = fakeProjection(emptyOverlay, [aSession({ id: 'a' })]);

    expect(() =>
      placeSession(
        { projection },
        { sessionId: 'a', placement: { type: 'swarm', swarmId: 'ghost' } },
      ),
    ).toThrow(SwarmNotFoundError);
    expect(writes).toEqual([]);
  });

  it('throws SwarmCycleError and performs no write for a parent cycle', () => {
    const overlay: OverlayState = { ...emptyOverlay, placements: { child: { parent: 'a' } } };
    const { projection, writes } = fakeProjection(overlay, [
      aSession({ id: 'a' }),
      aSession({ id: 'child' }),
    ]);

    expect(() =>
      placeSession(
        { projection },
        { sessionId: 'a', placement: { type: 'parent', parentId: 'child' } },
      ),
    ).toThrow(SwarmCycleError);
    expect(writes).toEqual([]);
  });

  it('recognizes a target known only via tmuxNames (no projection.sessions() entry yet)', () => {
    const overlay: OverlayState = { ...emptyOverlay, tmuxNames: { a: 'garden-a', b: 'garden-b' } };
    const { projection, current } = fakeProjection(overlay, []);

    placeSession({ projection }, { sessionId: 'a', placement: { type: 'parent', parentId: 'b' } });

    expect(current().placements['a']).toEqual({ parent: 'b' });
  });

  it('sets exactly the swarm placement, replacing any prior parent', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'A', archived: false }],
      placements: { a: { parent: 'orchestrator' } },
    };
    const { projection, current } = fakeProjection(overlay, [
      aSession({ id: 'a' }),
      aSession({ id: 'orchestrator' }),
    ]);

    placeSession({ projection }, { sessionId: 'a', placement: { type: 'swarm', swarmId: 's1' } });

    expect(current().placements['a']).toEqual({ swarmId: 's1' });
  });
});

describe('recordSpawn', () => {
  it('places the child under an already-swarmed caller, with one write and no new swarm', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'Existing', archived: false }],
      placements: { caller: { swarmId: 's1' } },
    };
    const { projection, writes, current } = fakeProjection(overlay, [
      aSession({ id: 'caller' }),
      aSession({ id: 'child' }),
    ]);

    recordSpawn({ projection }, { callerId: 'caller', childId: 'child', callerTitle: 'Caller' });

    expect(writes).toHaveLength(1);
    expect(current().swarms).toEqual([{ id: 's1', name: 'Existing', archived: false }]);
    expect(current().placements).toEqual({
      caller: { swarmId: 's1' },
      child: { parent: 'caller' },
    });
  });

  it('mints a swarm named after the caller, places the caller top-level, and records the child, atomically', () => {
    const { projection, writes, current } = fakeProjection(emptyOverlay, [
      aSession({ id: 'caller' }),
      aSession({ id: 'child' }),
    ]);

    recordSpawn({ projection }, { callerId: 'caller', childId: 'child', callerTitle: 'Caller' });

    expect(writes).toHaveLength(1);
    expect(current().swarms).toHaveLength(1);
    const swarm = current().swarms[0]!;
    expect(swarm.name).toBe('Caller');
    expect(swarm.archived).toBe(false);
    expect(current().placements).toEqual({
      caller: { swarmId: swarm.id },
      child: { parent: 'caller' },
    });
  });

  it("preserves a caller's pre-existing parent placement instead of minting a swarm over it", () => {
    // `caller` was placed under `other-top-level` via the placement endpoint independently
    // of any swarm — `other-top-level` has no placement entry of its own, so
    // `resolveSwarmId` walks off the end and returns undefined, same as a genuinely
    // unplaced caller. Minting a swarm here would silently drop the `parent` edge.
    const overlay: OverlayState = {
      ...emptyOverlay,
      placements: { caller: { parent: 'other-top-level' } },
    };
    const { projection, writes, current } = fakeProjection(overlay, [
      aSession({ id: 'caller' }),
      aSession({ id: 'child' }),
    ]);

    recordSpawn({ projection }, { callerId: 'caller', childId: 'child', callerTitle: 'Caller' });

    expect(writes).toHaveLength(1);
    expect(current().swarms).toEqual([]);
    expect(current().placements).toEqual({
      caller: { parent: 'other-top-level' },
      child: { parent: 'caller' },
    });
  });

  it('falls back to "Untitled swarm" when the caller has no title', () => {
    const { projection, current } = fakeProjection(emptyOverlay, [
      aSession({ id: 'caller' }),
      aSession({ id: 'child' }),
    ]);

    recordSpawn({ projection }, { callerId: 'caller', childId: 'child', callerTitle: null });

    expect(current().swarms[0]?.name).toBe('Untitled swarm');
  });

  it('throws SessionNotFoundError and performs no write for an unknown caller', () => {
    const { projection, writes } = fakeProjection(emptyOverlay, [aSession({ id: 'child' })]);

    expect(() =>
      recordSpawn({ projection }, { callerId: 'ghost', childId: 'child', callerTitle: null }),
    ).toThrow(SessionNotFoundError);
    expect(writes).toEqual([]);
  });
});

describe('pruneKnownSessions', () => {
  it('drops placements for unknown sessions and writes the result', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      placements: { known: {}, gone: { swarmId: 's1' } },
    };
    const { projection, current, writes } = fakeProjection(overlay, [aSession({ id: 'known' })]);

    pruneKnownSessions({ projection });

    expect(current().placements).toEqual({ known: {} });
    expect(writes).toHaveLength(1);
  });

  it('performs no write when nothing needs pruning', () => {
    const overlay: OverlayState = { ...emptyOverlay, placements: { known: {} } };
    const { projection, writes } = fakeProjection(overlay, [aSession({ id: 'known' })]);

    pruneKnownSessions({ projection });

    expect(writes).toEqual([]);
  });

  it('treats a session known only via tmuxNames as known, not pruned', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      tmuxNames: { child: 'garden-child' },
      placements: { child: {} },
    };
    const { projection, writes } = fakeProjection(overlay, []);

    pruneKnownSessions({ projection });

    expect(writes).toEqual([]);
  });
});
