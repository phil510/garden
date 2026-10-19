import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import type { SwarmTreeNode } from './groupSwarms';
import { capDeadForest, capDeadSessions, hiddenOldDeadCount, visibleSessions } from './visibility';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 20 * DAY_MS;

describe('visibleSessions', () => {
  it('always shows live sessions regardless of age', () => {
    const session = aSession({ liveness: 'live', lastActivity: 0 });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([
      session,
    ]);
  });

  it('shows a dead session active within the last 14 days', () => {
    const session = aSession({ liveness: 'dead', lastActivity: NOW - 5 * DAY_MS });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([
      session,
    ]);
  });

  it('hides a dead session last active more than 14 days ago', () => {
    const session = aSession({ liveness: 'dead', lastActivity: NOW - 15 * DAY_MS });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([]);
  });

  it('hides a session reporting lastActivity 0 — outside the 14-day window by design, not an accident', () => {
    const session = aSession({ liveness: 'dead', lastActivity: 0 });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([]);
  });

  it('hides every dead session when hideDead is set, regardless of age', () => {
    const recent = aSession({ id: 'recent', liveness: 'dead', lastActivity: NOW - DAY_MS });
    const old = aSession({ id: 'old', liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(visibleSessions([recent, old], { hideDead: true, showOlder: false }, NOW)).toEqual([]);
  });

  it('reveals an old dead session when showOlder is set', () => {
    const session = aSession({ liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(visibleSessions([session], { hideDead: false, showOlder: true }, NOW)).toEqual([
      session,
    ]);
  });
});

describe('hiddenOldDeadCount', () => {
  it('counts dead sessions older than 14 days', () => {
    const recent = aSession({ id: 'recent', liveness: 'dead', lastActivity: NOW - DAY_MS });
    const old = aSession({ id: 'old', liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(hiddenOldDeadCount([recent, old], false, NOW)).toBe(1);
  });

  it('is zero once hideDead already hides every dead session', () => {
    const old = aSession({ liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(hiddenOldDeadCount([old], true, NOW)).toBe(0);
  });
});

describe('capDeadSessions', () => {
  it('keeps every dead session when there are fewer than the cap', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 10).sessions).toEqual(sessions);
  });

  it('keeps only the first 10 dead sessions, in their original order, when collapsed', () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 10).sessions).toEqual(sessions.slice(0, 10));
  });

  it('never drops a live session, even past the dead-session cap boundary', () => {
    const deadSessions = Array.from({ length: 12 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    const live = aSession({ id: 'live', liveness: 'live' });
    const sessions = [...deadSessions, live];
    const capped = capDeadSessions(sessions, 10).sessions;
    expect(capped).toContainEqual(live);
    expect(capped).toHaveLength(11);
  });

  it('keeps exactly 10 dead sessions when the cap is not exceeded', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 10).sessions).toEqual(sessions);
  });

  it('drops exactly the 11th dead session when one over the cap', () => {
    const sessions = Array.from({ length: 11 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 10).sessions).toEqual(sessions.slice(0, 10));
  });
});

describe('capDeadSessions with a configured cap', () => {
  it('keeps only that many dead sessions when collapsed', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 3).sessions).toEqual(sessions.slice(0, 3));
  });
});

describe('capDeadSessions hiddenDeadCount', () => {
  it('returns the count of dead sessions past the cap', () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 10).hiddenDeadCount).toBe(5);
  });

  it('is zero when dead sessions are at or under the cap', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 10).hiddenDeadCount).toBe(0);
  });

  it('ignores live sessions when counting the remainder', () => {
    const deadSessions = Array.from({ length: 12 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    const live = aSession({ id: 'live', liveness: 'live' });
    expect(capDeadSessions([...deadSessions, live], 10).hiddenDeadCount).toBe(2);
  });
});

describe('capDeadSessions hiddenDeadCount with a configured cap', () => {
  it('counts dead sessions past that cap', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, 3).hiddenDeadCount).toBe(5);
  });
});

function node(sessionId: string, ...children: SwarmTreeNode[]): SwarmTreeNode {
  return { sessionId, children };
}

function ids(nodes: readonly SwarmTreeNode[]): unknown[] {
  return nodes.map((n) => (n.children.length === 0 ? n.sessionId : [n.sessionId, ids(n.children)]));
}

describe('capDeadForest', () => {
  const deadSet = (...dead: string[]) => {
    const set = new Set(dead);
    return (id: string) => set.has(id);
  };

  it('counts nested dead nodes toward the cap', () => {
    const forest = [node('root', node('a'), node('b'))];
    const result = capDeadForest(forest, deadSet('root', 'a', 'b'), 2);
    expect(ids(result.nodes)).toEqual([['root', ['a']]]);
    expect(result.hiddenDeadCount).toBe(1);
  });

  it('counts in display order across roots, a node before its children', () => {
    const forest = [node('A', node('B')), node('C')];
    const result = capDeadForest(forest, deadSet('A', 'B', 'C'), 1);
    expect(ids(result.nodes)).toEqual(['A']);
    expect(result.hiddenDeadCount).toBe(2);
  });

  it('keeps a dead ancestor past the cap when a live descendant survives', () => {
    const forest = [node('A'), node('B', node('C'))];
    const result = capDeadForest(forest, deadSet('A', 'B'), 1);
    expect(ids(result.nodes)).toEqual(['A', ['B', ['C']]]);
    expect(result.hiddenDeadCount).toBe(0);
  });

  it('never drops a live node at any depth, however far past the cap', () => {
    const forest = [node('d1'), node('d2', node('live-child')), node('live-root', node('d3'))];
    const result = capDeadForest(forest, deadSet('d1', 'd2', 'd3'), 0);
    expect(ids(result.nodes)).toEqual([['d2', ['live-child']], 'live-root']);
  });

  it('leaves a forest at or under the cap unchanged', () => {
    const forest = [node('A', node('B')), node('C')];
    const result = capDeadForest(forest, deadSet('A', 'B', 'C'), 3);
    expect(result.nodes).toEqual(forest);
    expect(result.hiddenDeadCount).toBe(0);
  });

  it('hides nothing in a forest whose every dead node already has a live descendant', () => {
    const forest = [node('A', node('B', node('live')))];
    const result = capDeadForest(forest, deadSet('A', 'B'), 1);
    expect(result.nodes).toEqual(forest);
    expect(result.hiddenDeadCount).toBe(0);
  });

  it('counts only the rows hidden when a scaffold survives past the cap', () => {
    const forest = [node('A'), node('B', node('X'), node('C'))];
    const result = capDeadForest(forest, deadSet('A', 'B', 'X'), 1);
    expect(ids(result.nodes)).toEqual(['A', ['B', ['C']]]);
    expect(result.hiddenDeadCount).toBe(1);
  });
});
