import { aSession } from '@garden/shared/fixtures';
import type { SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayState, StorePort, TmuxNewSessionRequest, TmuxPort } from './ports.js';
import type { Projection } from './projection.js';
import { createSession, killSession, resumeSession } from './sessions.js';

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  hideDead: false,
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
};

function fakeTmux(overrides: Partial<TmuxPort> = {}): TmuxPort {
  return {
    listPanes: () => Promise.resolve([]),
    newSession: () => Promise.reject(new Error('not used by this test')),
    respawnPane: () => Promise.reject(new Error('not used by this test')),
    killSession: () => Promise.reject(new Error('not used by this test')),
    ...overrides,
  };
}

function fakeProjection(sessions: SessionState[] = []) {
  const dispatched: GardenEvent[] = [];
  const projection: Projection = {
    sessions: () => sessions,
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: (event) => dispatched.push(event),
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
  };
  return { projection, dispatched };
}

/** In-memory StorePort: sessions.ts's contract with the store is read-modify-write,
 *  so the fake has to hold what it was handed. */
function fakeStore(initial: OverlayState = emptyOverlay) {
  let current = initial;
  const store: StorePort = {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
  return { store, written: () => current };
}

describe('createSession', () => {
  it('starts tmux before registering the session, and returns its id and name', async () => {
    const calls: TmuxNewSessionRequest[] = [];
    const tmux = fakeTmux({
      newSession: (request) => {
        calls.push(request);
        return Promise.resolve();
      },
    });
    const { projection, dispatched } = fakeProjection();
    const { store, written } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(calls).toEqual([
      {
        name: 'garden',
        cwd: '/Users/dev/garden',
        port: 4310,
        command: [
          'claude',
          '--session-id',
          result.id,
          '--settings',
          '/home/.garden/claude-settings.json',
        ],
      },
    ]);
    expect(result.tmuxName).toBe('garden');
    expect(result.id).not.toBe('');
    expect(dispatched).toEqual([
      { type: 'session-registered', id: result.id, tmuxName: 'garden', cwd: '/Users/dev/garden' },
    ]);
    expect(written().tmuxNames).toEqual({ [result.id]: 'garden' });
  });

  it('derives a name unique against every tmux name the projection already knows', async () => {
    const tmux = fakeTmux({ newSession: () => Promise.resolve() });
    const { projection } = fakeProjection([aSession({ tmuxName: 'garden' })]);
    const { store } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(result.tmuxName).toBe('garden-2');
  });

  it('does not dispatch session-registered when the tmux port throws', async () => {
    const tmux = fakeTmux({ newSession: () => Promise.reject(new Error('tmux is not installed')) });
    const { projection, dispatched } = fakeProjection();
    const { store, written } = fakeStore();

    await expect(
      createSession(
        {
          tmux,
          store,
          projection,
          serverPort: 4310,
          settingsPath: '/home/.garden/claude-settings.json',
        },
        { cwd: '/Users/dev/garden' },
      ),
    ).rejects.toThrow('tmux is not installed');
    expect(dispatched).toEqual([]);
    expect(written().tmuxNames).toEqual({});
  });
});

describe('resumeSession', () => {
  const settingsPath = '/home/.garden/claude-settings.json';
  const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' });

  it('respawns in place when tmux still holds the session', async () => {
    const respawned: unknown[] = [];
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      respawnPane: (request) => {
        respawned.push(request);
        return Promise.resolve();
      },
    });
    const { projection, dispatched } = fakeProjection([deadSession]);
    const { store, written } = fakeStore();

    const result = await resumeSession(
      { tmux, store, projection, serverPort: 4310, settingsPath },
      { id: 'sid-1' },
    );

    expect(respawned).toEqual([
      { name: 'garden', command: ['claude', '--resume', 'sid-1', '--settings', settingsPath] },
    ]);
    expect(result).toEqual({ id: 'sid-1', tmuxName: 'garden' });
    expect(dispatched).toEqual([
      { type: 'session-registered', id: 'sid-1', tmuxName: 'garden', cwd: '/Users/dev/garden' },
    ]);
    expect(written().tmuxNames).toEqual({ 'sid-1': 'garden' });
  });

  it('creates a fresh tmux session when tmux no longer holds the recorded name', async () => {
    const created: unknown[] = [];
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([]),
      newSession: (request) => {
        created.push(request);
        return Promise.resolve();
      },
    });
    const { projection, dispatched } = fakeProjection([deadSession]);
    const { store, written } = fakeStore();

    const result = await resumeSession(
      { tmux, store, projection, serverPort: 4310, settingsPath },
      { id: 'sid-1' },
    );

    expect(created).toEqual([
      {
        name: 'garden',
        cwd: '/Users/dev/garden',
        port: 4310,
        command: ['claude', '--resume', 'sid-1', '--settings', settingsPath],
      },
    ]);
    expect(result).toEqual({ id: 'sid-1', tmuxName: 'garden' });
    expect(dispatched).toEqual([
      { type: 'session-registered', id: 'sid-1', tmuxName: 'garden', cwd: '/Users/dev/garden' },
    ]);
    expect(written().tmuxNames).toEqual({ 'sid-1': 'garden' });
  });

  it('does not dispatch when the in-place mechanism throws', async () => {
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      respawnPane: () => Promise.reject(new Error('tmux is not installed')),
    });
    const { projection, dispatched } = fakeProjection([deadSession]);
    const { store } = fakeStore();

    await expect(
      resumeSession({ tmux, store, projection, serverPort: 4310, settingsPath }, { id: 'sid-1' }),
    ).rejects.toThrow('tmux is not installed');
    expect(dispatched).toEqual([]);
  });

  it('does not dispatch when the fresh-session mechanism throws', async () => {
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([]),
      newSession: () => Promise.reject(new Error('tmux is not installed')),
    });
    const { projection, dispatched } = fakeProjection([deadSession]);
    const { store } = fakeStore();

    await expect(
      resumeSession({ tmux, store, projection, serverPort: 4310, settingsPath }, { id: 'sid-1' }),
    ).rejects.toThrow('tmux is not installed');
    expect(dispatched).toEqual([]);
  });

  it('throws for an id the projection does not know', async () => {
    const tmux = fakeTmux();
    const { projection } = fakeProjection([]);
    const { store } = fakeStore();

    await expect(
      resumeSession({ tmux, store, projection, serverPort: 4310, settingsPath }, { id: 'nope' }),
    ).rejects.toThrow('no such session: nope');
  });
});

describe('killSession', () => {
  it('kills the tmux session and drops the store mapping', async () => {
    const killed: string[] = [];
    const tmux = fakeTmux({
      killSession: (name) => {
        killed.push(name);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection([aSession({ id: 'sid-1', tmuxName: 'garden' })]);
    const { store, written } = fakeStore({
      version: 1,
      tmuxNames: { 'sid-1': 'garden', 'sid-2': 'other' },
      hideDead: false,
      groups: {},
      stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
    });

    await killSession(
      { tmux, store, projection, serverPort: 4310, settingsPath: '/x' },
      { id: 'sid-1' },
    );

    expect(killed).toEqual(['garden']);
    expect(written().tmuxNames).toEqual({ 'sid-2': 'other' });
  });

  it('does not call tmux when the session already has no tmux name', async () => {
    const tmux = fakeTmux({ killSession: () => Promise.reject(new Error('should not be called')) });
    const { projection } = fakeProjection([aSession({ id: 'sid-1', tmuxName: null })]);
    const { store } = fakeStore();

    await expect(
      killSession(
        { tmux, store, projection, serverPort: 4310, settingsPath: '/x' },
        { id: 'sid-1' },
      ),
    ).resolves.toBeUndefined();
  });

  it('throws for an id the projection does not know', async () => {
    const tmux = fakeTmux();
    const { projection } = fakeProjection([]);
    const { store } = fakeStore();

    await expect(
      killSession(
        { tmux, store, projection, serverPort: 4310, settingsPath: '/x' },
        { id: 'nope' },
      ),
    ).rejects.toThrow('no such session: nope');
  });
});
