import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { filterBySwarm, mergePlacements } from './placements.js';

describe('mergePlacements', () => {
  it('merges parent/swarmId onto a placed session', () => {
    const session = aSession({ id: 'a' });
    const [merged] = mergePlacements([session], { a: { swarmId: 'swarm-1' } });

    expect(merged).toEqual({ ...session, swarmId: 'swarm-1' });
  });

  it('leaves an unplaced session untouched, with the fields absent rather than undefined', () => {
    const session = aSession({ id: 'a' });
    const [merged] = mergePlacements([session], {});

    expect(merged).toEqual(session);
    expect(merged && 'parent' in merged).toBe(false);
  });

  it('merges a parent field onto a placed session', () => {
    const session = aSession({ id: 'a' });
    const [merged] = mergePlacements([session], { a: { parent: 'b' } });

    expect(merged).toEqual({ ...session, parent: 'b' });
  });
});

describe('filterBySwarm', () => {
  it('keeps a top-level member of the swarm', () => {
    const session = aSession({ id: 'a' });
    const result = filterBySwarm([session], { a: { swarmId: 'swarm-1' } }, 'swarm-1');

    expect(result.map((s) => s.id)).toEqual(['a']);
  });

  it('keeps a descendant of a top-level member', () => {
    const orchestrator = aSession({ id: 'orchestrator' });
    const child = aSession({ id: 'child' });
    const placements = {
      orchestrator: { swarmId: 'swarm-1' },
      child: { parent: 'orchestrator' },
    };

    const result = filterBySwarm([orchestrator, child], placements, 'swarm-1');

    expect(result.map((s) => s.id)).toEqual(['orchestrator', 'child']);
  });

  it('drops a session belonging to a different swarm', () => {
    const a = aSession({ id: 'a' });
    const b = aSession({ id: 'b' });
    const placements = { a: { swarmId: 'swarm-1' }, b: { swarmId: 'swarm-2' } };

    const result = filterBySwarm([a, b], placements, 'swarm-1');

    expect(result.map((s) => s.id)).toEqual(['a']);
  });

  it('drops a solo session', () => {
    const solo = aSession({ id: 'solo' });

    expect(filterBySwarm([solo], {}, 'swarm-1')).toEqual([]);
  });

  // A live child of a dead, filtered-out orchestrator still resolves its swarm membership
  // correctly, even though the ancestor's own SessionState is absent from `sessions` — the
  // placements map is what resolveSwarmId walks, not the session list.
  it("resolves a live descendant's swarm through an ancestor absent from the session list", () => {
    const child = aSession({ id: 'child', liveness: 'live' });
    const placements = {
      orchestrator: { swarmId: 'swarm-1' },
      child: { parent: 'orchestrator' },
    };

    // `orchestrator` (dead, already filtered out) is not in the list being filtered.
    const result = filterBySwarm([child], placements, 'swarm-1');

    expect(result.map((s) => s.id)).toEqual(['child']);
  });
});
