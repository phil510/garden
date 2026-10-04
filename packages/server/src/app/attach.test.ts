import { aSession } from '@garden/shared/fixtures';
import type { SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import {
  SessionAlreadyAttachedError,
  SessionNotRunningError,
  createAttachRegistry,
} from './attach.js';
import type { PaneSize, PtyPort } from './ports.js';
import type { Projection } from './projection.js';
import { SessionNotFoundError } from './sessions.js';

interface SpawnedPty {
  readonly tmuxName: string;
  readonly size: PaneSize;
  readonly written: string[];
  readonly resizes: PaneSize[];
  readonly emitData: (chunk: string) => void;
  readonly emitExit: () => void;
  killed: boolean;
}

/** Records what the registry asked the pty layer for, and hands back the levers a test
 *  needs to drive the pty end: bytes arriving and the pty exiting on its own. */
function fakePty() {
  const spawned: SpawnedPty[] = [];
  const port: PtyPort = {
    attach: (tmuxName, size, handlers) => {
      const pty: SpawnedPty = {
        tmuxName,
        size,
        written: [],
        resizes: [],
        emitData: handlers.onData,
        emitExit: handlers.onExit,
        killed: false,
      };
      spawned.push(pty);
      return {
        write: (data) => pty.written.push(data),
        resize: (next) => pty.resizes.push(next),
        kill: () => {
          pty.killed = true;
        },
      };
    },
  };
  return { port, spawned };
}

function fakeProjection(sessions: SessionState[]): Projection {
  return {
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
    updateOverlay: () => {
      throw new Error('not used by this test');
    },
    overlay: () => {
      throw new Error('not used by this test');
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => {
      throw new Error('not used by this test');
    },
  };
}

const size: PaneSize = { cols: 80, rows: 24 };
const noHandlers = { onData: () => undefined, onExit: () => undefined };

describe('createAttachRegistry', () => {
  it('spawns the pty against the session’s tmux name at the requested size', () => {
    const session = aSession({ id: 'one', tmuxName: 'repo-2' });
    const pty = fakePty();
    const registry = createAttachRegistry({ pty: pty.port, projection: fakeProjection([session]) });

    registry.attach({ id: 'one', size, ...noHandlers });

    expect(pty.spawned).toHaveLength(1);
    expect(pty.spawned[0]?.tmuxName).toBe('repo-2');
    expect(pty.spawned[0]?.size).toEqual(size);
  });

  it('forwards writes and resizes to the pty', () => {
    const pty = fakePty();
    const registry = createAttachRegistry({
      pty: pty.port,
      projection: fakeProjection([aSession({ id: 'one' })]),
    });

    const attachment = registry.attach({ id: 'one', size, ...noHandlers });
    attachment.write('ls\r');
    attachment.resize({ cols: 120, rows: 40 });

    expect(pty.spawned[0]?.written).toEqual(['ls\r']);
    expect(pty.spawned[0]?.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('delivers pty output to the caller', () => {
    const chunks: string[] = [];
    const pty = fakePty();
    const registry = createAttachRegistry({
      pty: pty.port,
      projection: fakeProjection([aSession({ id: 'one' })]),
    });

    registry.attach({ id: 'one', size, onData: (chunk) => chunks.push(chunk), onExit: () => {} });
    pty.spawned[0]?.emitData('hello');

    expect(chunks).toEqual(['hello']);
  });

  it('refuses a second attach while the first is open', () => {
    const pty = fakePty();
    const registry = createAttachRegistry({
      pty: pty.port,
      projection: fakeProjection([aSession({ id: 'one' })]),
    });

    registry.attach({ id: 'one', size, ...noHandlers });

    expect(() => registry.attach({ id: 'one', size, ...noHandlers })).toThrow(
      SessionAlreadyAttachedError,
    );
    expect(pty.spawned).toHaveLength(1);
  });

  it('attaches two different sessions at once', () => {
    const pty = fakePty();
    const registry = createAttachRegistry({
      pty: pty.port,
      projection: fakeProjection([
        aSession({ id: 'one', tmuxName: 'repo' }),
        aSession({ id: 'two', tmuxName: 'other' }),
      ]),
    });

    registry.attach({ id: 'one', size, ...noHandlers });
    registry.attach({ id: 'two', size, ...noHandlers });

    expect(pty.spawned.map((entry) => entry.tmuxName)).toEqual(['repo', 'other']);
  });

  it('kills the pty on close and frees the session for a new attach', () => {
    const pty = fakePty();
    const registry = createAttachRegistry({
      pty: pty.port,
      projection: fakeProjection([aSession({ id: 'one' })]),
    });

    registry.attach({ id: 'one', size, ...noHandlers }).close();
    registry.attach({ id: 'one', size, ...noHandlers });

    expect(pty.spawned[0]?.killed).toBe(true);
    expect(pty.spawned).toHaveLength(2);
  });

  it('frees the session when the pty exits on its own, and tells the caller once', () => {
    let exits = 0;
    const pty = fakePty();
    const registry = createAttachRegistry({
      pty: pty.port,
      projection: fakeProjection([aSession({ id: 'one' })]),
    });

    const attachment = registry.attach({
      id: 'one',
      size,
      onData: () => {},
      onExit: () => exits++,
    });
    pty.spawned[0]?.emitExit();
    attachment.close();

    expect(exits).toBe(1);
    expect(() => registry.attach({ id: 'one', size, ...noHandlers })).not.toThrow();
  });

  it('rejects an unknown session id', () => {
    const pty = fakePty();
    const registry = createAttachRegistry({ pty: pty.port, projection: fakeProjection([]) });

    expect(() => registry.attach({ id: 'missing', size, ...noHandlers })).toThrow(
      SessionNotFoundError,
    );
  });

  it('rejects a session tmux no longer holds', () => {
    const pty = fakePty();
    const registry = createAttachRegistry({
      pty: pty.port,
      projection: fakeProjection([aSession({ id: 'one', tmuxName: null, liveness: 'dead' })]),
    });

    expect(() => registry.attach({ id: 'one', size, ...noHandlers })).toThrow(
      SessionNotRunningError,
    );
    expect(pty.spawned).toHaveLength(0);
  });

  it('frees the session when the pty fails to spawn', () => {
    let failNext = true;
    const pty = fakePty();
    const failing: PtyPort = {
      attach: (tmuxName, requested, handlers) => {
        if (failNext) {
          failNext = false;
          throw new Error('fork failed');
        }
        return pty.port.attach(tmuxName, requested, handlers);
      },
    };
    const registry = createAttachRegistry({
      pty: failing,
      projection: fakeProjection([aSession({ id: 'one', tmuxName: 'garden-one' })]),
    });

    expect(() => registry.attach({ id: 'one', size, ...noHandlers })).toThrow('fork failed');

    expect(() => registry.attach({ id: 'one', size, ...noHandlers })).not.toThrow();
    expect(pty.spawned).toHaveLength(1);
  });
});
