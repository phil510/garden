import { aSession } from '@garden/shared/fixtures';
import type { SessionMap, SessionPlacement, SwarmRecord, UiState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import {
  activeSwarmsByRecency,
  groupSwarms,
  type SwarmGroup,
  type SwarmTreeNode,
} from './groupSwarms';

type SwarmsUiState = Pick<
  UiState,
  'swarms' | 'placements' | 'swarmOrder' | 'collapsedSwarms' | 'hideDeadSwarms'
>;

function anUiState(overrides: Partial<SwarmsUiState> = {}): SwarmsUiState {
  return {
    swarms: [],
    placements: {},
    swarmOrder: [],
    collapsedSwarms: [],
    hideDeadSwarms: [],
    ...overrides,
  };
}

const asMap = (...sessions: ReturnType<typeof aSession>[]): SessionMap =>
  Object.fromEntries(sessions.map((s) => [s.id, s]));

function ids(node: SwarmTreeNode): unknown {
  return node.children.length === 0
    ? node.sessionId
    : { id: node.sessionId, children: node.children.map(ids) };
}

const swarmRecord = (overrides: Partial<SwarmRecord> = {}): SwarmRecord => ({
  id: 'swarm-1',
  name: 'A swarm',
  archived: false,
  ...overrides,
});

describe('groupSwarms', () => {
  it('resolves a child two levels deep to its top-level swarm', () => {
    const root = aSession({ id: 'root', lastActivity: 3 });
    const mid = aSession({ id: 'mid', lastActivity: 2 });
    const leaf = aSession({ id: 'leaf', lastActivity: 1 });
    const sessions = asMap(root, mid, leaf);
    const placements: Record<string, SessionPlacement> = {
      root: { swarmId: 'swarm-1' },
      mid: { parent: 'root' },
      leaf: { parent: 'mid' },
    };
    const uiState = anUiState({ swarms: [swarmRecord()], placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms).toHaveLength(1);
    expect(ids(swarms[0]!.roots[0]!)).toEqual({
      id: 'root',
      children: [{ id: 'mid', children: ['leaf'] }],
    });
  });

  it('is cycle-safe: a placements cycle resolves to no swarm rather than looping', () => {
    // The server's own validatePlacement (wouldCreateParentCycle) never lets this be
    // written via the API; this only guards resolveTopLevelSwarmId's walk against a
    // hand-edited state.json, matching the server-side walk's own cycle guard.
    const a = aSession({ id: 'a' });
    const b = aSession({ id: 'b' });
    const sessions = asMap(a, b);
    const placements: Record<string, SessionPlacement> = {
      a: { parent: 'b' },
      b: { parent: 'a' },
    };
    const uiState = anUiState({ placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms).toEqual([]);
  });

  it('counts attention across every session resolving to the swarm', () => {
    const root = aSession({ id: 'root', status: 'working' });
    const child1 = aSession({ id: 'child1', status: 'needs-approval' });
    const child2 = aSession({ id: 'child2', status: 'waiting' });
    const sessions = asMap(root, child1, child2);
    const placements: Record<string, SessionPlacement> = {
      root: { swarmId: 'swarm-1' },
      child1: { parent: 'root' },
      child2: { parent: 'root' },
    };
    const uiState = anUiState({ swarms: [swarmRecord()], placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms[0]!.attention).toBe(2);
  });

  it('counts distinct repo roots across the swarm, ignoring a null repoRoot', () => {
    const root = aSession({ id: 'root', repoRoot: '/repo-a' });
    const child1 = aSession({ id: 'child1', repoRoot: '/repo-b' });
    const child2 = aSession({ id: 'child2', repoRoot: '/repo-a' });
    const child3 = aSession({ id: 'child3', repoRoot: null });
    const sessions = asMap(root, child1, child2, child3);
    const placements: Record<string, SessionPlacement> = {
      root: { swarmId: 'swarm-1' },
      child1: { parent: 'root' },
      child2: { parent: 'root' },
      child3: { parent: 'root' },
    };
    const uiState = anUiState({ swarms: [swarmRecord()], placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms[0]!.repoCount).toBe(2);
  });

  it('is finished when archived, regardless of liveness', () => {
    const root = aSession({ id: 'root', liveness: 'live' });
    const sessions = asMap(root);
    const placements: Record<string, SessionPlacement> = { root: { swarmId: 'swarm-1' } };
    const uiState = anUiState({ swarms: [swarmRecord({ archived: true })], placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms[0]!.finished).toBe(true);
  });

  it('exposes the record’s raw archived flag distinctly from finished', () => {
    // A swarm can be `finished` (every member dead) without being `archived` — the header
    // menu's Archive/Unarchive label and dispatch need the raw flag, not the conflated one.
    const dead = aSession({ id: 'root', liveness: 'dead' });
    const sessions = asMap(dead);
    const placements: Record<string, SessionPlacement> = { root: { swarmId: 'swarm-1' } };
    const uiState = anUiState({ swarms: [swarmRecord({ archived: false })], placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms[0]!.finished).toBe(true);
    expect(swarms[0]!.archived).toBe(false);
  });

  it('is finished when every resolving session is dead', () => {
    const root = aSession({ id: 'root', liveness: 'dead' });
    const child = aSession({ id: 'child', liveness: 'dead' });
    const sessions = asMap(root, child);
    const placements: Record<string, SessionPlacement> = {
      root: { swarmId: 'swarm-1' },
      child: { parent: 'root' },
    };
    const uiState = anUiState({ swarms: [swarmRecord()], placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms[0]!.finished).toBe(true);
  });

  it('is not finished when it has no members at all', () => {
    const uiState = anUiState({ swarms: [swarmRecord()] });

    const { swarms } = groupSwarms({}, uiState);

    expect(swarms[0]!.finished).toBe(false);
  });

  it('a swarm transitions out of Finished when a member goes from dead to live', () => {
    const dead = aSession({ id: 'root', liveness: 'dead' });
    const placements: Record<string, SessionPlacement> = { root: { swarmId: 'swarm-1' } };
    const uiState = anUiState({ swarms: [swarmRecord()], placements });

    const before = groupSwarms(asMap(dead), uiState);
    expect(before.swarms[0]!.finished).toBe(true);

    const live = aSession({ id: 'root', liveness: 'live' });
    const after = groupSwarms(asMap(live), uiState);
    expect(after.swarms[0]!.finished).toBe(false);
  });

  it('defaults to collapsed and orders by recency when swarmOrder and collapsedSwarms are empty', () => {
    const older = aSession({ id: 'older-root', lastActivity: 1 });
    const newer = aSession({ id: 'newer-root', lastActivity: 2 });
    const sessions = asMap(older, newer);
    const placements: Record<string, SessionPlacement> = {
      'older-root': { swarmId: 'swarm-old' },
      'newer-root': { swarmId: 'swarm-new' },
    };
    const uiState = anUiState({
      swarms: [
        swarmRecord({ id: 'swarm-old', name: 'Old' }),
        swarmRecord({ id: 'swarm-new', name: 'New' }),
      ],
      placements,
    });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms.every((s) => s.collapsed)).toBe(true);
    expect(swarms.map((s) => s.swarmId)).toEqual(['swarm-new', 'swarm-old']);
  });

  it('exposes recency as the max member lastActivity, 0 for a swarm with no members', () => {
    const a = aSession({ id: 'a', lastActivity: 5 });
    const b = aSession({ id: 'b', lastActivity: 9 });
    const sessions = asMap(a, b);
    const placements: Record<string, SessionPlacement> = {
      a: { swarmId: 'swarm-1' },
      b: { parent: 'a' },
    };
    const uiState = anUiState({
      swarms: [swarmRecord({ id: 'swarm-1' }), swarmRecord({ id: 'swarm-empty' })],
      placements,
    });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms.find((s) => s.swarmId === 'swarm-1')!.recency).toBe(9);
    expect(swarms.find((s) => s.swarmId === 'swarm-empty')!.recency).toBe(0);
  });

  it('membership in collapsedSwarms marks a swarm expanded, toggling back to collapsed on removal', () => {
    const root = aSession({ id: 'root' });
    const placements: Record<string, SessionPlacement> = { root: { swarmId: 'swarm-1' } };

    const expanded = groupSwarms(
      asMap(root),
      anUiState({ swarms: [swarmRecord()], placements, collapsedSwarms: ['swarm-1'] }),
    );
    expect(expanded.swarms[0]!.collapsed).toBe(false);

    const collapsed = groupSwarms(
      asMap(root),
      anUiState({ swarms: [swarmRecord()], placements, collapsedSwarms: [] }),
    );
    expect(collapsed.swarms[0]!.collapsed).toBe(true);
  });

  it('orders swarms by swarmOrder ahead of recency', () => {
    const newer = aSession({ id: 'newer-root', lastActivity: 2 });
    const older = aSession({ id: 'older-root', lastActivity: 1 });
    const sessions = asMap(newer, older);
    const placements: Record<string, SessionPlacement> = {
      'newer-root': { swarmId: 'swarm-new' },
      'older-root': { swarmId: 'swarm-old' },
    };
    const uiState = anUiState({
      swarms: [
        swarmRecord({ id: 'swarm-old', name: 'Old' }),
        swarmRecord({ id: 'swarm-new', name: 'New' }),
      ],
      placements,
      swarmOrder: ['swarm-old', 'swarm-new'],
    });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms.map((s) => s.swarmId)).toEqual(['swarm-old', 'swarm-new']);
  });

  it('puts a session with no resolvable swarm in Solo, as its own tree with descendants', () => {
    const root = aSession({ id: 'root', lastActivity: 2 });
    const child = aSession({ id: 'child', lastActivity: 1 });
    const other = aSession({ id: 'other', lastActivity: 3 });
    const sessions = asMap(root, child, other);
    const placements: Record<string, SessionPlacement> = { child: { parent: 'root' } };
    const uiState = anUiState({ placements });

    const { swarms, solo } = groupSwarms(sessions, uiState);

    expect(swarms).toEqual([]);
    expect(solo.map(ids)).toEqual(['other', { id: 'root', children: ['child'] }]);
  });

  it('attaches a session to a top-level node when its parent has no live session (orphaned mid-tree parent)', () => {
    // "orphan"'s placements parent resolves fine through `placements` to a real swarm, but
    // that parent id has no entry in the live sessions map at all.
    const orphan = aSession({ id: 'orphan' });
    const sessions = asMap(orphan);
    const placements: Record<string, SessionPlacement> = {
      orphan: { parent: 'missing-parent' },
      'missing-parent': { swarmId: 'swarm-1' },
    };
    const uiState = anUiState({ swarms: [swarmRecord()], placements });

    const { swarms } = groupSwarms(sessions, uiState);

    expect(swarms[0]!.roots.map((n) => n.sessionId)).toEqual(['orphan']);
  });

  it('falls back to Solo for a swarmId with no matching swarm record, rather than dropping the session', () => {
    const root = aSession({ id: 'root' });
    const sessions = asMap(root);
    const placements: Record<string, SessionPlacement> = { root: { swarmId: 'ghost-swarm' } };
    const uiState = anUiState({ swarms: [], placements });

    const { swarms, solo } = groupSwarms(sessions, uiState);

    expect(swarms).toEqual([]);
    expect(solo.map((n) => n.sessionId)).toEqual(['root']);
  });

  describe('hide-dead filtering', () => {
    it('removes a dead leaf with no successor when hideDead is on', () => {
      const root = aSession({ id: 'root', liveness: 'live' });
      const deadLeaf = aSession({ id: 'dead-leaf', liveness: 'dead' });
      const sessions = asMap(root, deadLeaf);
      const placements: Record<string, SessionPlacement> = {
        root: { swarmId: 'swarm-1' },
        'dead-leaf': { parent: 'root' },
      };
      const uiState = anUiState({
        swarms: [swarmRecord()],
        placements,
        hideDeadSwarms: ['swarm-1'],
      });

      const { swarms } = groupSwarms(sessions, uiState);

      expect(ids(swarms[0]!.roots[0]!)).toBe('root');
    });

    it('keeps a dead session with a successor visible even when hideDead is on', () => {
      const root = aSession({ id: 'root', liveness: 'live' });
      const deadWithSuccessor = aSession({ id: 'dead-handed-off', liveness: 'dead' });
      const sessions = asMap(root, deadWithSuccessor);
      const placements: Record<string, SessionPlacement> = {
        root: { swarmId: 'swarm-1' },
        'dead-handed-off': { parent: 'root', successor: 'somewhere-else' },
      };
      const uiState = anUiState({
        swarms: [swarmRecord()],
        placements,
        hideDeadSwarms: ['swarm-1'],
      });

      const { swarms } = groupSwarms(sessions, uiState);

      expect(ids(swarms[0]!.roots[0]!)).toEqual({ id: 'root', children: ['dead-handed-off'] });
    });

    it('keeps a dead predecessor when it has a live descendant, filtering only the dead leaf', () => {
      const deadRoot = aSession({ id: 'dead-root', liveness: 'dead' });
      const liveChild = aSession({ id: 'live-child', liveness: 'live' });
      const deadGrandchild = aSession({ id: 'dead-grandchild', liveness: 'dead' });
      const sessions = asMap(deadRoot, liveChild, deadGrandchild);
      const placements: Record<string, SessionPlacement> = {
        'dead-root': { swarmId: 'swarm-1' },
        'live-child': { parent: 'dead-root' },
        'dead-grandchild': { parent: 'live-child' },
      };
      const uiState = anUiState({
        swarms: [swarmRecord()],
        placements,
        hideDeadSwarms: ['swarm-1'],
      });

      const { swarms } = groupSwarms(sessions, uiState);

      expect(ids(swarms[0]!.roots[0]!)).toEqual({
        id: 'dead-root',
        children: ['live-child'],
      });
    });

    it('shows every session when hideDead is off', () => {
      const root = aSession({ id: 'root', liveness: 'live' });
      const deadLeaf = aSession({ id: 'dead-leaf', liveness: 'dead' });
      const sessions = asMap(root, deadLeaf);
      const placements: Record<string, SessionPlacement> = {
        root: { swarmId: 'swarm-1' },
        'dead-leaf': { parent: 'root' },
      };
      const uiState = anUiState({ swarms: [swarmRecord()], placements, hideDeadSwarms: [] });

      const { swarms } = groupSwarms(sessions, uiState);

      expect(ids(swarms[0]!.roots[0]!)).toEqual({ id: 'root', children: ['dead-leaf'] });
    });

    it('removes a dead solo leaf when the Solo bucket is toggled hidden', () => {
      const root = aSession({ id: 'root', liveness: 'live' });
      const deadLeaf = aSession({ id: 'dead-leaf', liveness: 'dead' });
      const sessions = asMap(root, deadLeaf);
      const placements: Record<string, SessionPlacement> = { 'dead-leaf': { parent: 'root' } };
      const uiState = anUiState({ placements, hideDeadSwarms: ['solo'] });

      const { solo, soloTotal, soloHideDead } = groupSwarms(sessions, uiState);

      expect(soloHideDead).toBe(true);
      expect(soloTotal).toBe(1);
      expect(ids(solo[0]!)).toBe('root');
    });

    it('keeps a dead solo session with a successor visible even when the Solo bucket is hidden', () => {
      const root = aSession({ id: 'root', liveness: 'live' });
      const deadWithSuccessor = aSession({ id: 'dead-handed-off', liveness: 'dead' });
      const sessions = asMap(root, deadWithSuccessor);
      const placements: Record<string, SessionPlacement> = {
        'dead-handed-off': { parent: 'root', successor: 'somewhere-else' },
      };
      const uiState = anUiState({ placements, hideDeadSwarms: ['solo'] });

      const { solo } = groupSwarms(sessions, uiState);

      expect(ids(solo[0]!)).toEqual({ id: 'root', children: ['dead-handed-off'] });
    });

    it('keeps the Solo bucket total stable when filtering empties the visible list', () => {
      const deadLeaf = aSession({ id: 'dead-leaf', liveness: 'dead' });
      const sessions = asMap(deadLeaf);
      const uiState = anUiState({ hideDeadSwarms: ['solo'] });

      const { solo, soloTotal } = groupSwarms(sessions, uiState);

      expect(solo).toEqual([]);
      expect(soloTotal).toBe(1);
    });
  });
});

function aSwarmGroup(overrides: Partial<SwarmGroup> = {}): SwarmGroup {
  return {
    swarmId: 'swarm-1',
    name: 'A swarm',
    repoCount: 1,
    attention: 0,
    collapsed: false,
    hideDead: false,
    archived: false,
    finished: false,
    recency: 0,
    roots: [],
    ...overrides,
  };
}

describe('activeSwarmsByRecency', () => {
  it('excludes finished swarms', () => {
    const active = aSwarmGroup({ swarmId: 'active', finished: false });
    const finished = aSwarmGroup({ swarmId: 'finished', finished: true });

    expect(activeSwarmsByRecency([active, finished])).toEqual([
      { swarmId: 'active', name: 'A swarm' },
    ]);
  });

  it('sorts by recency alone, most recent first, ignoring swarmOrder-style input order', () => {
    const stale = aSwarmGroup({ swarmId: 'stale', name: 'Stale', recency: 1 });
    const fresh = aSwarmGroup({ swarmId: 'fresh', name: 'Fresh', recency: 9 });
    const mid = aSwarmGroup({ swarmId: 'mid', name: 'Mid', recency: 5 });

    expect(activeSwarmsByRecency([stale, fresh, mid])).toEqual([
      { swarmId: 'fresh', name: 'Fresh' },
      { swarmId: 'mid', name: 'Mid' },
      { swarmId: 'stale', name: 'Stale' },
    ]);
  });
});
