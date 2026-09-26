import { describe, expect, it } from 'vitest';
import { resolveSidebarDrop } from './resolveSidebarDrop';

describe('resolveSidebarDrop', () => {
  it('is a no-op when dropped outside any droppable', () => {
    expect(resolveSidebarDrop({ type: 'session', id: 's1' }, null, undefined)).toEqual({
      type: 'noop',
    });
  });

  it('is a no-op for a foreign active type this sidebar does not recognize', () => {
    expect(
      resolveSidebarDrop(
        { type: 'repo', id: 'r1' },
        { type: 'swarm-header', id: 'h', swarmId: 'swarm-1' },
        undefined,
      ),
    ).toEqual({ type: 'noop' });
  });

  describe('swarm-header reorder', () => {
    it('reorders two swarm headers', () => {
      expect(
        resolveSidebarDrop(
          { type: 'swarm-reorder', id: 'swarm-a' },
          { type: 'swarm-reorder', id: 'swarm-b' },
          undefined,
        ),
      ).toEqual({ type: 'reorder', activeSwarmId: 'swarm-a', overSwarmId: 'swarm-b' });
    });

    it('is a no-op when dropped on its own position', () => {
      expect(
        resolveSidebarDrop(
          { type: 'swarm-reorder', id: 'swarm-a' },
          { type: 'swarm-reorder', id: 'swarm-a' },
          undefined,
        ),
      ).toEqual({ type: 'noop' });
    });

    it('is a no-op when a swarm-reorder drag lands on a swarm-header or solo droppable', () => {
      // The collision-detection filtering already keeps these apart for a real drag; the
      // resolver guards it too, so it can't silently reorder off a mismatched over-target.
      expect(
        resolveSidebarDrop(
          { type: 'swarm-reorder', id: 'swarm-a' },
          { type: 'swarm-header', id: 'h', swarmId: 'swarm-b' },
          undefined,
        ),
      ).toEqual({ type: 'noop' });
      expect(
        resolveSidebarDrop(
          { type: 'swarm-reorder', id: 'swarm-a' },
          { type: 'solo', id: 'solo' },
          undefined,
        ),
      ).toEqual({ type: 'noop' });
    });
  });

  describe('session onto a swarm header', () => {
    it('places an unparented, solo session as a top-level member', () => {
      expect(
        resolveSidebarDrop(
          { type: 'session', id: 's1' },
          { type: 'swarm-header', id: 'h', swarmId: 'swarm-1' },
          undefined,
        ),
      ).toEqual({
        type: 'place',
        sessionId: 's1',
        placement: { type: 'swarm', swarmId: 'swarm-1' },
      });
    });

    it('is a no-op when the session is already an unparented top-level member of that swarm', () => {
      expect(
        resolveSidebarDrop(
          { type: 'session', id: 's1' },
          { type: 'swarm-header', id: 'h', swarmId: 'swarm-1' },
          { swarmId: 'swarm-1' },
        ),
      ).toEqual({ type: 'noop' });
    });

    it('promotes a session nested under the same swarm (has a parent) rather than no-op-ing', () => {
      // It already *resolves* to swarm-1 by walking its parent, but its own raw fields don't
      // say "top-level member of swarm-1" — dropping on the header still clears its parent.
      expect(
        resolveSidebarDrop(
          { type: 'session', id: 's1' },
          { type: 'swarm-header', id: 'h', swarmId: 'swarm-1' },
          { parent: 'some-ancestor' },
        ),
      ).toEqual({
        type: 'place',
        sessionId: 's1',
        placement: { type: 'swarm', swarmId: 'swarm-1' },
      });
    });

    it('reparents a top-level member of a different swarm', () => {
      expect(
        resolveSidebarDrop(
          { type: 'session', id: 's1' },
          { type: 'swarm-header', id: 'h', swarmId: 'swarm-2' },
          { swarmId: 'swarm-1' },
        ),
      ).toEqual({
        type: 'place',
        sessionId: 's1',
        placement: { type: 'swarm', swarmId: 'swarm-2' },
      });
    });
  });

  describe('session onto Solo', () => {
    it('is a no-op when the session is already an unparented Solo root', () => {
      expect(
        resolveSidebarDrop({ type: 'session', id: 's1' }, { type: 'solo', id: 'solo' }, {}),
      ).toEqual({ type: 'noop' });
      expect(
        resolveSidebarDrop({ type: 'session', id: 's1' }, { type: 'solo', id: 'solo' }, undefined),
      ).toEqual({ type: 'noop' });
    });

    it('clears a top-level swarm member onto Solo', () => {
      expect(
        resolveSidebarDrop(
          { type: 'session', id: 's1' },
          { type: 'solo', id: 'solo' },
          { swarmId: 'swarm-1' },
        ),
      ).toEqual({ type: 'place', sessionId: 's1', placement: { type: 'none' } });
    });

    it('promotes a session nested under a Solo tree rather than no-op-ing', () => {
      // Merely *resolving* to Solo through a parent chain isn't the same as already being an
      // unparented Solo root — dropping on Solo still clears the parent and promotes it.
      expect(
        resolveSidebarDrop(
          { type: 'session', id: 's1' },
          { type: 'solo', id: 'solo' },
          { parent: 'some-solo-ancestor' },
        ),
      ).toEqual({ type: 'place', sessionId: 's1', placement: { type: 'none' } });
    });
  });

  it('is a no-op for a session dropped on a swarm-reorder droppable (its own swarm rows, not the header)', () => {
    expect(
      resolveSidebarDrop(
        { type: 'session', id: 's1' },
        { type: 'swarm-reorder', id: 'swarm-1', swarmId: 'swarm-1' },
        { swarmId: 'swarm-1' },
      ),
    ).toEqual({ type: 'noop' });
  });
});
