import { describe, expect, it, vi } from 'vitest';
import type { Projection } from './projection.js';
import type { HarnessLaunchRequest, TmuxNewSessionRequest, TmuxPort } from './ports.js';
import { fakeHarness } from './harness.fixture.js';
import { createSession } from './sessions.js';

describe('createSession harness boundary', () => {
  it('passes launch choices to the harness and registers only after tmux accepts its command', async () => {
    const command = ['vendor-launch', 'opaque-native-argument'];
    const spawnCommand = vi.fn<(request: HarnessLaunchRequest) => readonly string[]>(() => command);
    const dispatch = vi.fn();
    const projection = { dispatch, sessions: () => [] } as unknown as Projection;
    let finishLaunch: (() => void) | undefined;
    const newSession = vi.fn<(request: TmuxNewSessionRequest) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finishLaunch = resolve;
        }),
    );
    const tmux = { listPanes: () => Promise.resolve([]), newSession } as unknown as TmuxPort;
    const pending = createSession(
      {
        projection,
        tmux,
        serverPort: 4310,
        permissionMode: 'bypassPermissions',
        harness: {
          ...fakeHarness(),
          spawnCommand,
          initialStatus: { status: 'waiting', reason: 'starting' },
        },
      },
      { cwd: '/repo', model: 'selected-model', effort: 'high' },
    );
    await vi.waitFor(() => expect(newSession).toHaveBeenCalledOnce());
    expect(dispatch).not.toHaveBeenCalled();
    const launch = spawnCommand.mock.calls[0]![0];
    expect(launch.id).toMatch(/^[a-f0-9-]+$/);
    expect(launch).toEqual({
      id: launch.id,
      cwd: '/repo',
      model: 'selected-model',
      effort: 'high',
      permissionMode: 'bypassPermissions',
    });
    expect(newSession.mock.calls[0]![0]).toMatchObject({ command });
    finishLaunch!();
    const result = await pending;
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session-registered',
      id: result.id,
      tmuxName: result.tmuxName,
      cwd: '/repo',
      reported: { status: 'waiting', reason: 'starting' },
    });
  });

  it('does not register a process tmux refused to start', async () => {
    const dispatch = vi.fn();
    const failure = new Error('spawn refused');
    const tmux = {
      listPanes: () => Promise.resolve([]),
      newSession: () => Promise.reject(failure),
    } as unknown as TmuxPort;
    await expect(
      createSession(
        {
          projection: { dispatch, sessions: () => [] } as unknown as Projection,
          tmux,
          harness: fakeHarness(),
          serverPort: 4310,
        },
        { cwd: '/repo' },
      ),
    ).rejects.toBe(failure);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
