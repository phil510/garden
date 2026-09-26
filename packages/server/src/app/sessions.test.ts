import { aSession } from '@garden/shared/fixtures';
import type { SessionState, UiState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayState, StorePort, TmuxNewSessionRequest, TmuxPort } from './ports.js';
import type { Projection } from './projection.js';
import { createSession, killSession, resumeSession } from './sessions.js';

const baseUiState: UiState = {
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  hideDeadRepos: [],
  preset: 'single',
  slots: [null],
  focusedSlot: 0,
  layout: null,
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
};

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

/** `placementOf` defaults to "no placement" rather than throwing, since every
 *  `resumeSession` call reads it to decide whether a swarm needs unarchiving — a test with
 *  no swarms in play should not have to override it just to reach the tmux/dispatch
 *  behavior it actually exercises. `current()` exposes the overlay as mutated by the default
 *  `updateOverlay`, for tests (e.g. spawn recording) that don't override it. */
function fakeProjection(sessions: SessionState[] = [], overrides: Partial<Projection> = {}) {
  const dispatched: GardenEvent[] = [];
  let current = emptyOverlay;
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
    updateOverlay: (mutate) => {
      current = mutate(current);
      return current;
    },
    placementOf: () => undefined,
    ...overrides,
  };
  return { projection, dispatched, current: () => current };
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
        readClaudeCommand: () => ['claude'],
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(calls).toEqual([
      {
        name: 'garden',
        cwd: '/Users/dev/garden',
        port: 4310,
        sessionId: result.id,
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

  it('puts every token of a multi-token claudeCommand ahead of the session flags', async () => {
    const calls: TmuxNewSessionRequest[] = [];
    const tmux = fakeTmux({
      newSession: (request) => {
        calls.push(request);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection();
    const { store } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
        readClaudeCommand: () => ['tsx', 'scripts/fake-claude.ts'],
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(calls[0]?.command).toEqual([
      'tsx',
      'scripts/fake-claude.ts',
      '--session-id',
      result.id,
      '--settings',
      '/home/.garden/claude-settings.json',
    ]);
  });

  it('calls readClaudeCommand fresh on every invocation rather than caching its first result', async () => {
    const calls: TmuxNewSessionRequest[] = [];
    const tmux = fakeTmux({
      newSession: (request) => {
        calls.push(request);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection();
    const { store } = fakeStore();
    const results: readonly (readonly string[])[] = [
      ['claude'],
      ['ec', 'bedrock', 'launch', 'claude', '--'],
    ];
    let readCount = 0;
    const readClaudeCommand = () => results[readCount++] ?? ['claude'];
    const deps = {
      tmux,
      store,
      projection,
      serverPort: 4310,
      settingsPath: '/home/.garden/claude-settings.json',
      readClaudeCommand,
    };

    await createSession(deps, { cwd: '/Users/dev/garden' });
    await createSession(deps, { cwd: '/Users/dev/garden' });

    expect(readCount).toBe(2);
    expect(calls[0]?.command.slice(0, 1)).toEqual(['claude']);
    expect(calls[1]?.command.slice(0, 5)).toEqual(['ec', 'bedrock', 'launch', 'claude', '--']);
  });

  it('adds --permission-mode bypassPermissions ahead of --settings when configured', async () => {
    const calls: TmuxNewSessionRequest[] = [];
    const tmux = fakeTmux({
      newSession: (request) => {
        calls.push(request);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection();
    const { store } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
        readClaudeCommand: () => ['claude'],
        permissionMode: 'bypassPermissions',
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(calls[0]?.command).toEqual([
      'claude',
      '--session-id',
      result.id,
      '--permission-mode',
      'bypassPermissions',
      '--settings',
      '/home/.garden/claude-settings.json',
    ]);
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
        readClaudeCommand: () => ['claude'],
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(result.tmuxName).toBe('garden-2');
  });

  it('derives a name unique against a live tmux session the projection has lost track of', async () => {
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: false, exitCode: undefined }]),
      newSession: () => Promise.resolve(),
    });
    const { projection } = fakeProjection([]);
    const { store } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
        readClaudeCommand: () => ['claude'],
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(result.tmuxName).toBe('garden-2');
  });

  it('derives a name unique against both the projection and a live pane it does not know about', async () => {
    // Distinguishes the two taken-name sources: the projection knows 'garden', the live
    // pane list knows 'garden-2'. Dropping either source would let the other name collide.
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden-2', dead: false, exitCode: undefined }]),
      newSession: () => Promise.resolve(),
    });
    const { projection } = fakeProjection([aSession({ tmuxName: 'garden' })]);
    const { store } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
        readClaudeCommand: () => ['claude'],
      },
      { cwd: '/Users/dev/garden' },
    );

    expect(result.tmuxName).toBe('garden-3');
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
          readClaudeCommand: () => ['claude'],
        },
        { cwd: '/Users/dev/garden' },
      ),
    ).rejects.toThrow('tmux is not installed');
    expect(dispatched).toEqual([]);
    expect(written().tmuxNames).toEqual({});
  });

  it('records the caller as parent when callerSessionId resolves to a known session', async () => {
    const tmux = fakeTmux({ newSession: () => Promise.resolve() });
    const { projection, current } = fakeProjection([aSession({ id: 'caller', title: 'Caller' })]);
    const { store } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
        readClaudeCommand: () => ['claude'],
      },
      { cwd: '/Users/dev/garden', callerSessionId: 'caller' },
    );

    expect(result.unknownCaller).toBeUndefined();
    expect(current().placements[result.id]).toEqual({ parent: 'caller' });
    expect(current().swarms[0]?.name).toBe('Caller');
  });

  it('sets unknownCaller instead of throwing when callerSessionId does not resolve', async () => {
    const tmux = fakeTmux({ newSession: () => Promise.resolve() });
    const { projection, dispatched, current } = fakeProjection([]);
    const { store } = fakeStore();

    const result = await createSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/home/.garden/claude-settings.json',
        readClaudeCommand: () => ['claude'],
      },
      { cwd: '/Users/dev/garden', callerSessionId: 'ghost' },
    );

    expect(result.unknownCaller).toBe(true);
    expect(dispatched).toEqual([
      { type: 'session-registered', id: result.id, tmuxName: 'garden', cwd: '/Users/dev/garden' },
    ]);
    expect(current().placements).toEqual({});
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
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
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

  it('adds --permission-mode bypassPermissions to the respawnPane command when configured', async () => {
    const respawned: unknown[] = [];
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      respawnPane: (request) => {
        respawned.push(request);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection([deadSession]);
    const { store } = fakeStore();

    await resumeSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
        permissionMode: 'bypassPermissions',
      },
      { id: 'sid-1' },
    );

    expect(respawned).toEqual([
      {
        name: 'garden',
        command: [
          'claude',
          '--resume',
          'sid-1',
          '--permission-mode',
          'bypassPermissions',
          '--settings',
          settingsPath,
        ],
      },
    ]);
  });

  it('puts every token of a multi-token claudeCommand ahead of --resume', async () => {
    const respawned: unknown[] = [];
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      respawnPane: (request) => {
        respawned.push(request);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection([deadSession]);
    const { store } = fakeStore();

    await resumeSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['tsx', 'scripts/fake-claude.ts'],
      },
      { id: 'sid-1' },
    );

    expect(respawned).toEqual([
      {
        name: 'garden',
        command: ['tsx', 'scripts/fake-claude.ts', '--resume', 'sid-1', '--settings', settingsPath],
      },
    ]);
  });

  it('adds --permission-mode bypassPermissions to the fresh-newSession command when configured', async () => {
    const created: unknown[] = [];
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([]),
      newSession: (request) => {
        created.push(request);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection([deadSession]);
    const { store } = fakeStore();

    await resumeSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
        permissionMode: 'bypassPermissions',
      },
      { id: 'sid-1' },
    );

    expect(created).toEqual([
      {
        name: 'garden',
        cwd: '/Users/dev/garden',
        port: 4310,
        sessionId: 'sid-1',
        command: [
          'claude',
          '--resume',
          'sid-1',
          '--permission-mode',
          'bypassPermissions',
          '--settings',
          settingsPath,
        ],
      },
    ]);
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
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      { id: 'sid-1' },
    );

    expect(created).toEqual([
      {
        name: 'garden',
        cwd: '/Users/dev/garden',
        port: 4310,
        sessionId: 'sid-1',
        command: ['claude', '--resume', 'sid-1', '--settings', settingsPath],
      },
    ]);
    expect(result).toEqual({ id: 'sid-1', tmuxName: 'garden' });
    expect(dispatched).toEqual([
      { type: 'session-registered', id: 'sid-1', tmuxName: 'garden', cwd: '/Users/dev/garden' },
    ]);
    expect(written().tmuxNames).toEqual({ 'sid-1': 'garden' });
  });

  it('derives a fresh name unique against a live tmux session the projection has lost track of', async () => {
    const staleSession = aSession({
      id: 'sid-1',
      cwd: '/Users/dev/garden',
      tmuxName: 'garden-old',
    });
    const created: unknown[] = [];
    const tmux = fakeTmux({
      // Matches the issue's exact repro: a dead pane kept alive by remain-on-exit still
      // holds the name. Filtering dead panes out of the taken set must not resurface it.
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      newSession: (request) => {
        created.push(request);
        return Promise.resolve();
      },
    });
    const { projection } = fakeProjection([staleSession]);
    const { store } = fakeStore();

    const result = await resumeSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      { id: 'sid-1' },
    );

    expect(result.tmuxName).toBe('garden-2');
    expect(created).toEqual([
      {
        name: 'garden-2',
        cwd: '/Users/dev/garden',
        port: 4310,
        sessionId: 'sid-1',
        command: ['claude', '--resume', 'sid-1', '--settings', settingsPath],
      },
    ]);
  });

  it('does not dispatch when the in-place mechanism throws', async () => {
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      respawnPane: () => Promise.reject(new Error('tmux is not installed')),
    });
    const { projection, dispatched } = fakeProjection([deadSession]);
    const { store } = fakeStore();

    await expect(
      resumeSession(
        {
          tmux,
          store,
          projection,
          serverPort: 4310,
          settingsPath,
          readClaudeCommand: () => ['claude'],
        },
        { id: 'sid-1' },
      ),
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
      resumeSession(
        {
          tmux,
          store,
          projection,
          serverPort: 4310,
          settingsPath,
          readClaudeCommand: () => ['claude'],
        },
        { id: 'sid-1' },
      ),
    ).rejects.toThrow('tmux is not installed');
    expect(dispatched).toEqual([]);
  });

  it("clears archived on the resumed session's top-level swarm", async () => {
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      respawnPane: () => Promise.resolve(),
    });
    let overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 'swarm-1', name: 'A swarm', archived: true }],
    };
    const { projection } = fakeProjection([deadSession], {
      uiState: () => ({ ...baseUiState, swarms: [...overlay.swarms] }),
      placementOf: () => ({ swarmId: 'swarm-1', topLevelSwarmId: 'swarm-1' }),
      updateOverlay: (mutate) => {
        overlay = mutate(overlay);
        return overlay;
      },
    });
    const { store } = fakeStore();

    await resumeSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      { id: 'sid-1' },
    );

    expect(overlay.swarms).toEqual([{ id: 'swarm-1', name: 'A swarm', archived: false }]);
  });

  it('leaves archived untouched when resuming a session with no swarm, or in a non-archived swarm', async () => {
    const tmux = fakeTmux({
      listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
      respawnPane: () => Promise.resolve(),
    });
    const { projection: soloProjection } = fakeProjection([deadSession]);
    const { store: soloStore } = fakeStore();

    // No swarm at all: placementOf's default ("no placement") short-circuits before
    // uiState()/updateOverlay are ever called, so nothing needs overriding.
    await resumeSession(
      {
        tmux,
        store: soloStore,
        projection: soloProjection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      { id: 'sid-1' },
    );

    let overlay: OverlayState = {
      ...emptyOverlay,
      swarms: [{ id: 'swarm-1', name: 'A swarm', archived: false }],
    };
    const overlayWrites: OverlayState[] = [];
    const { projection: memberProjection } = fakeProjection([deadSession], {
      uiState: () => ({ ...baseUiState, swarms: [...overlay.swarms] }),
      placementOf: () => ({ swarmId: 'swarm-1', topLevelSwarmId: 'swarm-1' }),
      updateOverlay: (mutate) => {
        const next = mutate(overlay);
        overlayWrites.push(next);
        overlay = next;
        return next;
      },
    });
    const { store: memberStore } = fakeStore();

    await resumeSession(
      {
        tmux,
        store: memberStore,
        projection: memberProjection,
        serverPort: 4310,
        settingsPath,
        readClaudeCommand: () => ['claude'],
      },
      { id: 'sid-1' },
    );

    expect(overlayWrites).toEqual([]);
    expect(overlay.swarms).toEqual([{ id: 'swarm-1', name: 'A swarm', archived: false }]);
  });

  it('throws for an id the projection does not know', async () => {
    const tmux = fakeTmux();
    const { projection } = fakeProjection([]);
    const { store } = fakeStore();

    await expect(
      resumeSession(
        {
          tmux,
          store,
          projection,
          serverPort: 4310,
          settingsPath,
          readClaudeCommand: () => ['claude'],
        },
        { id: 'nope' },
      ),
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
      groups: {},
      stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
      swarms: [],
      placements: {},
      swarmOrder: [],
      collapsedSwarms: [],
      hideDeadSwarms: [],
    });

    await killSession(
      {
        tmux,
        store,
        projection,
        serverPort: 4310,
        settingsPath: '/x',
        readClaudeCommand: () => ['claude'],
      },
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
        {
          tmux,
          store,
          projection,
          serverPort: 4310,
          settingsPath: '/x',
          readClaudeCommand: () => ['claude'],
        },
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
        {
          tmux,
          store,
          projection,
          serverPort: 4310,
          settingsPath: '/x',
          readClaudeCommand: () => ['claude'],
        },
        { id: 'nope' },
      ),
    ).rejects.toThrow('no such session: nope');
  });
});
