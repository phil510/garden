import { aSession } from '@garden/shared/fixtures';
import type { SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import type { TmuxNewSessionRequest, TmuxPort } from './ports.js';
import type { Projection } from './projection.js';
import { createSession } from './sessions.js';

function fakeTmux(newSession: TmuxPort['newSession']): TmuxPort {
  return {
    listPanes: () => Promise.resolve([]),
    newSession,
    respawnPane: () => Promise.reject(new Error('not used by this test')),
    killSession: () => Promise.reject(new Error('not used by this test')),
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

describe('createSession', () => {
  it('starts tmux before registering the session, and returns its id and name', async () => {
    const calls: TmuxNewSessionRequest[] = [];
    const tmux = fakeTmux((request) => {
      calls.push(request);
      return Promise.resolve();
    });
    const { projection, dispatched } = fakeProjection();

    const result = await createSession(
      { tmux, projection, serverPort: 4310, settingsPath: '/home/.garden/claude-settings.json' },
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
  });

  it('derives a name unique against every tmux name the projection already knows', async () => {
    const tmux = fakeTmux(() => Promise.resolve());
    const { projection } = fakeProjection([aSession({ tmuxName: 'garden' })]);

    const result = await createSession(
      { tmux, projection, serverPort: 4310, settingsPath: '/home/.garden/claude-settings.json' },
      { cwd: '/Users/dev/garden' },
    );

    expect(result.tmuxName).toBe('garden-2');
  });

  it('does not dispatch session-registered when the tmux port throws', async () => {
    const tmux = fakeTmux(() => Promise.reject(new Error('tmux is not installed')));
    const { projection, dispatched } = fakeProjection();

    await expect(
      createSession(
        { tmux, projection, serverPort: 4310, settingsPath: '/home/.garden/claude-settings.json' },
        { cwd: '/Users/dev/garden' },
      ),
    ).rejects.toThrow('tmux is not installed');
    expect(dispatched).toEqual([]);
  });
});
