import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionsResponse } from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import { CliHttpError } from './http.js';
import { runStop, runStopAll, type StopAllDeps, type StopDeps } from './stop.js';

function collectingIo(): { io: Io; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = {
    stdout: {
      write: (text, callback) => {
        stdout.push(text);
        callback?.();
      },
    },
    stderr: {
      write: (text, callback) => {
        stderr.push(text);
        callback?.();
      },
    },
  };
  return { io, stdout, stderr };
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'garden-cli-stop-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<StopDeps> = {}): { deps: StopDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: StopDeps = {
    readPid: () => {
      calls.push('readPid');
      return null;
    },
    removePid: () => {
      calls.push('removePid');
    },
    isProcessRunning: () => {
      calls.push('isProcessRunning');
      return false;
    },
    healthPid: () => {
      calls.push('healthPid');
      return Promise.resolve('refused');
    },
    kill: (pid, signal) => {
      calls.push(`kill:${String(pid)}:${signal}`);
    },
    home,
    stopTimeoutMs: 200,
    pollIntervalMs: 10,
    ...overrides,
  };
  return { deps, calls };
}

describe('runStop', () => {
  it('reports not running and skips kill when no pid is recorded', async () => {
    const { io, stdout } = collectingIo();
    const { deps, calls } = baseDeps();

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['garden is not running\n']);
    expect(calls).not.toContain(expect.stringMatching(/^kill:/));
    expect(calls).toContain('removePid');
  });

  it('clears a stale pid file that names a process no longer running', async () => {
    const { io, stdout } = collectingIo();
    const { deps, calls } = baseDeps({ readPid: () => 4242, isProcessRunning: () => false });

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['garden is not running\n']);
    expect(calls.filter((c) => c === 'removePid')).toHaveLength(1);
    expect(calls.some((c) => c.startsWith('kill:'))).toBe(false);
  });

  it('kills a running server and waits for it to exit', async () => {
    const { io, stdout } = collectingIo();
    let running = true;
    setTimeout(() => {
      running = false;
    }, 30);
    const { deps, calls } = baseDeps({
      readPid: () => 4242,
      isProcessRunning: () => running,
      healthPid: () => Promise.resolve(4242),
    });

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['garden stopped\n']);
    expect(calls).toContain('kill:4242:SIGTERM');
    expect(calls).toContain('removePid');
  });

  it('fails after the deadline when the server never stops', async () => {
    const { io, stderr } = collectingIo();
    const { deps, calls } = baseDeps({
      readPid: () => 4242,
      isProcessRunning: () => true,
      healthPid: () => Promise.resolve(4242),
    });

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toMatch(/did not stop within 200ms/);
    expect(calls).not.toContain('removePid');
  });

  it('treats a live pid that /health says is another process as stale and never signals it', async () => {
    const { io, stdout } = collectingIo();
    const { deps, calls } = baseDeps({
      readPid: () => 4242,
      isProcessRunning: () => true,
      healthPid: () => Promise.resolve(777),
    });

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['garden is not running\n']);
    expect(calls).toContain('removePid');
    expect(calls.some((c) => c.startsWith('kill:'))).toBe(false);
  });

  it('treats a live pid with nothing listening on the port as stale and never signals it', async () => {
    const { io, stdout } = collectingIo();
    const { deps, calls } = baseDeps({
      readPid: () => 4242,
      isProcessRunning: () => true,
      healthPid: () => Promise.resolve('refused'),
    });

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['garden is not running\n']);
    expect(calls).toContain('removePid');
    expect(calls.some((c) => c.startsWith('kill:'))).toBe(false);
  });

  it('refuses without signalling or clearing the pid file when a live pid does not answer /health', async () => {
    const { io, stderr } = collectingIo();
    const { deps, calls } = baseDeps({
      readPid: () => 4242,
      isProcessRunning: () => true,
      healthPid: () => Promise.resolve('no-answer'),
    });

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toContain('4242');
    expect(stderr[0]).toMatch(/hung garden/);
    expect(calls).not.toContain('removePid');
    expect(calls.some((c) => c.startsWith('kill:'))).toBe(false);
  });
});

function fakeClient(overrides: Partial<CliClient> = {}): { client: CliClient; calls: string[] } {
  const calls: string[] = [];
  const client: CliClient = {
    listSessions: () => {
      calls.push('listSessions');
      return Promise.resolve({ sessions: [] } as SessionsResponse);
    },
    createSession: () => Promise.reject(new Error('not used by this test')),
    resumeSession: () => Promise.reject(new Error('not used by this test')),
    killSession: () => Promise.reject(new Error('not used by this test')),
    placeSession: () => Promise.reject(new Error('not used by this test')),
    watch: () => Promise.reject(new Error('not used by this test')),
    unwatch: () => Promise.reject(new Error('not used by this test')),
    watches: () => Promise.reject(new Error('not used by this test')),
    raiseAlert: () => Promise.reject(new Error('not used by this test')),
    clearAlert: () => Promise.reject(new Error('not used by this test')),
    digest: () => Promise.reject(new Error('not used by this test')),
    ...overrides,
  };
  return { client, calls };
}

function baseStopAllDeps(overrides: Partial<StopAllDeps> = {}): {
  deps: StopAllDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const deps: StopAllDeps = {
    confirm: () => {
      calls.push('confirm');
      return Promise.resolve(true);
    },
    stop: () => {
      calls.push('stop');
      return Promise.resolve(0);
    },
    killTmuxServer: (confPath, socket) => {
      calls.push(`killTmuxServer:${confPath}:${socket}`);
      return Promise.resolve();
    },
    home: '/home/garden-user',
    appDir: '/home/garden-user/.garden',
    tmuxSocket: 'garden',
    ...overrides,
  };
  return { deps, calls };
}

describe('runStopAll', () => {
  it('reports the live session count in the confirm message when the server is reachable', async () => {
    const { io } = collectingIo();
    const { client } = fakeClient({
      listSessions: () =>
        Promise.resolve({
          sessions: [
            { liveness: 'live' },
            { liveness: 'live' },
            { liveness: 'dead' },
          ] as unknown as SessionsResponse['sessions'],
        }),
    });
    let seenMessage = '';
    const { deps } = baseStopAllDeps({
      confirm: (message) => {
        seenMessage = message;
        return Promise.resolve(true);
      },
    });

    await runStopAll(io, false, client, deps);

    expect(seenMessage).toMatch(/2 live sessions/);
    // Plural possessive takes a trailing apostrophe only, not another "s".
    expect(seenMessage).toContain("losing 2 live sessions' in-flight Claude work");
  });

  it('uses singular possessive grammar for exactly one live session', async () => {
    const { io } = collectingIo();
    const { client } = fakeClient({
      listSessions: () =>
        Promise.resolve({
          sessions: [{ liveness: 'live' }] as unknown as SessionsResponse['sessions'],
        }),
    });
    let seenMessage = '';
    const { deps } = baseStopAllDeps({
      confirm: (message) => {
        seenMessage = message;
        return Promise.resolve(true);
      },
    });

    await runStopAll(io, false, client, deps);

    expect(seenMessage).toContain("losing 1 live session's in-flight Claude work");
  });

  it('falls back to an uncounted prompt when the server is unreachable', async () => {
    const { io } = collectingIo();
    const { client } = fakeClient({
      listSessions: () => Promise.reject(new CliHttpError('garden server is not running')),
    });
    let seenMessage = '';
    const { deps } = baseStopAllDeps({
      confirm: (message) => {
        seenMessage = message;
        return Promise.resolve(true);
      },
    });

    await runStopAll(io, false, client, deps);

    expect(seenMessage).toMatch(/uncounted number of live sessions/);
    expect(seenMessage).toContain(
      "losing an uncounted number of live sessions' in-flight Claude work",
    );
  });

  it('skips the confirmation prompt and the session count fetch when told to', async () => {
    const { io } = collectingIo();
    const { client, calls: clientCalls } = fakeClient();
    const { deps, calls } = baseStopAllDeps();

    const exitCode = await runStopAll(io, true, client, deps);

    expect(exitCode).toBe(0);
    expect(clientCalls).toEqual([]);
    expect(calls).not.toContain('confirm');
  });

  it('aborts without stopping anything when the user declines confirmation', async () => {
    const { io, stdout } = collectingIo();
    const { client } = fakeClient();
    const { deps, calls } = baseStopAllDeps({ confirm: () => Promise.resolve(false) });

    const exitCode = await runStopAll(io, false, client, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['aborted\n']);
    expect(calls).toEqual([]);
  });

  it('does not kill tmux when stopping the server fails', async () => {
    const { io } = collectingIo();
    const { client } = fakeClient();
    const { deps, calls } = baseStopAllDeps({ stop: () => Promise.resolve(1) });

    const exitCode = await runStopAll(io, false, client, deps);

    expect(exitCode).toBe(1);
    expect(calls.some((c) => c.startsWith('killTmuxServer'))).toBe(false);
  });

  it('fails without the success line when the tmux server cannot be reached', async () => {
    const { io, stdout, stderr } = collectingIo();
    const { client } = fakeClient();
    const { deps } = baseStopAllDeps({
      killTmuxServer: () => Promise.reject(new Error('cannot reach the tmux server socket /x')),
    });

    const exitCode = await runStopAll(io, true, client, deps);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['garden: cannot reach the tmux server socket /x\n']);
    expect(stdout.join('')).not.toContain('tmux server killed');
  });

  it('stops the server then kills tmux, in order, on a successful run', async () => {
    const { io, stdout } = collectingIo();
    const { client, calls: clientCalls } = fakeClient();
    const { deps, calls } = baseStopAllDeps();

    const exitCode = await runStopAll(io, false, client, deps);

    expect(exitCode).toBe(0);
    expect(clientCalls).toEqual(['listSessions']);
    expect(calls).toEqual([
      'confirm',
      'stop',
      'killTmuxServer:/home/garden-user/.garden/tmux.conf:garden',
    ]);
    expect(stdout.at(-1)).toBe('garden stopped; tmux server killed\n');
  });
});
