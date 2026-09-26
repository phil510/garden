import { aSession } from '@garden/shared/fixtures';
import type { SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { OverlayState } from './ports.js';
import type { Projection } from './projection.js';
import { SessionNotFoundError } from './sessions.js';
import {
  archiveSwarm,
  createSwarm,
  CrossSwarmHandoffError,
  deleteSwarm,
  handoffSession,
  placeSession,
  pruneKnownSessions,
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

  it('preserves an existing successor field on the entry being placed', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 's1', name: 'A', archived: false }],
      placements: { a: { swarmId: 's1', successor: 'b' } },
    };
    const { projection, current } = fakeProjection(overlay, [
      aSession({ id: 'a' }),
      aSession({ id: 'b' }),
    ]);

    placeSession({ projection }, { sessionId: 'a', placement: { type: 'none' } });

    expect(current().placements['a']).toEqual({ successor: 'b' });
  });
});

describe('handoffSession', () => {
  it('throws SessionNotFoundError and performs no write for an unknown fromId or toId', () => {
    const { projection, writes } = fakeProjection(emptyOverlay, [aSession({ id: 'a' })]);

    expect(() => handoffSession({ projection }, { fromId: 'ghost', toId: 'a' })).toThrow(
      SessionNotFoundError,
    );
    expect(() => handoffSession({ projection }, { fromId: 'a', toId: 'ghost' })).toThrow(
      SessionNotFoundError,
    );
    expect(writes).toEqual([]);
  });

  it('throws CrossSwarmHandoffError and performs no write for a cross-swarm handoff', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      placements: { a: { swarmId: 's1' }, b: { swarmId: 's2' } },
    };
    const { projection, writes } = fakeProjection(overlay, [
      aSession({ id: 'a' }),
      aSession({ id: 'b' }),
    ]);

    expect(() => handoffSession({ projection }, { fromId: 'a', toId: 'b' })).toThrow(
      CrossSwarmHandoffError,
    );
    expect(writes).toEqual([]);
  });

  it('throws SwarmCycleError and performs no write for a handoff to a descendant', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      placements: { mid: { parent: 'a' }, b: { parent: 'mid' } },
    };
    const { projection, writes } = fakeProjection(overlay, [
      aSession({ id: 'a' }),
      aSession({ id: 'mid' }),
      aSession({ id: 'b' }),
    ]);

    expect(() => handoffSession({ projection }, { fromId: 'a', toId: 'b' })).toThrow(
      SwarmCycleError,
    );
    expect(writes).toEqual([]);
  });

  it('applies the three-edge placements computeHandoff returns on success', () => {
    const overlay: OverlayState = {
      ...emptyOverlay,
      placements: { a: { swarmId: 's1' }, childOfA: { parent: 'a' } },
    };
    const { projection, current } = fakeProjection(overlay, [
      aSession({ id: 'a' }),
      aSession({ id: 'b' }),
      aSession({ id: 'childOfA' }),
    ]);

    handoffSession({ projection }, { fromId: 'a', toId: 'b' });

    expect(current().placements).toEqual({
      a: { parent: 'b', successor: 'b' },
      b: { swarmId: 's1' },
      childOfA: { parent: 'b' },
    });
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
