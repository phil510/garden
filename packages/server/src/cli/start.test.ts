import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Io } from './commands.js';
import {
  decideStartupAction,
  describeStartupFailure,
  runStart,
  SERVER_DETACHED_FLAG,
  SERVER_PROCESS_ENV,
  type StartDeps,
} from './start.js';

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
  home = mkdtempSync(join(tmpdir(), 'garden-cli-start-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<StartDeps> = {}): { deps: StartDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: StartDeps = {
    readPid: () => {
      calls.push('readPid');
      return null;
    },
    writePid: (_path, pid) => {
      calls.push(`writePid:${String(pid)}`);
    },
    isProcessRunning: () => {
      calls.push('isProcessRunning');
      return false;
    },
    spawnServer: () => {
      calls.push('spawnServer');
      return Promise.resolve({ kind: 'ready', pid: 999 });
    },
    chromeInstalled: () => {
      calls.push('chromeInstalled');
      return true;
    },
    openChromeWindow: (url) => {
      calls.push(`openChromeWindow:${url}`);
      return Promise.resolve();
    },
    scriptPath: '/bin/garden.js',
    home,
    ...overrides,
  };
  return { deps, calls };
}

describe('decideStartupAction', () => {
  it('attaches to a running pid and starts otherwise', () => {
    expect(decideStartupAction('running')).toBe('attach');
    expect(decideStartupAction('not-running')).toBe('start');
  });
});

describe('describeStartupFailure', () => {
  it('names the port and config file when the stderr shows EADDRINUSE', () => {
    const message = describeStartupFailure({
      port: 4310,
      configPath: '/home/.garden/config.json',
      stderr: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:4310',
      timedOut: false,
      timeoutMs: 30_000,
    });
    expect(message).toBe(
      'port 4310 is already in use by another process — stop it or change "port" in /home/.garden/config.json',
    );
  });

  it('relays the raw stderr for any other failure', () => {
    expect(
      describeStartupFailure({
        port: 4310,
        configPath: 'x',
        stderr: 'boom\n',
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toBe('boom');
  });

  it('strips a "garden: " prefix the child already wrote, so the caller does not double it', () => {
    expect(
      describeStartupFailure({
        port: 4310,
        configPath: 'x',
        stderr: 'garden: tmux is not installed\n',
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toBe('tmux is not installed');
  });

  it('falls back to a generic message when stderr is empty', () => {
    expect(
      describeStartupFailure({
        port: 4310,
        configPath: 'x',
        stderr: '',
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toBe('garden server failed to start');
  });

  it('names the timeout limit when the server never became healthy, instead of the generic message', () => {
    expect(
      describeStartupFailure({
        port: 4310,
        configPath: 'x',
        stderr: '',
        timedOut: true,
        timeoutMs: 30_000,
      }),
    ).toBe('garden server did not become healthy within 30s');
  });

  it('still leads with the port-in-use message when a timed-out result carries EADDRINUSE stderr', () => {
    expect(
      describeStartupFailure({
        port: 4310,
        configPath: 'x',
        stderr: 'Error: listen EADDRINUSE: 127.0.0.1:4310',
        timedOut: true,
        timeoutMs: 30_000,
      }),
    ).toBe('port 4310 is already in use by another process — stop it or change "port" in x');
  });
});

describe('runStart', () => {
  it('spawns the server when no pid is recorded, then opens the browser', async () => {
    const { io } = collectingIo();
    const { deps, calls } = baseDeps();

    const exitCode = await runStart(io, deps);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      'readPid',
      'spawnServer',
      'writePid:999',
      'chromeInstalled',
      expect.stringMatching(/^openChromeWindow:/),
    ]);
  });

  it('passes the server-process marker in the spawned environment and the detached flag as argv', async () => {
    const { io } = collectingIo();
    let seenArgs: readonly string[] | undefined;
    let seenEnv: NodeJS.ProcessEnv | undefined;
    const { deps } = baseDeps({
      spawnServer: (_scriptPath, args, env) => {
        seenArgs = args;
        seenEnv = env;
        return Promise.resolve({ kind: 'ready', pid: 1 });
      },
    });

    await runStart(io, deps);

    expect(seenEnv?.[SERVER_PROCESS_ENV]).toBe('1');
    expect(seenArgs).toEqual([SERVER_DETACHED_FLAG]);
    // The detached signal must never ride in env under any name — that's exactly the channel
    // a garden-managed tmux pane inherits from, which is the bug an argv flag exists to avoid
    // by construction.
    expect(Object.keys(seenEnv ?? {}).some((key) => /detached/i.test(key))).toBe(false);
  });

  it('reuses a server a running pid names instead of spawning a new one', async () => {
    const { io } = collectingIo();
    const { deps, calls } = baseDeps({
      readPid: () => 4242,
      isProcessRunning: (pid) => pid === 4242,
    });

    const exitCode = await runStart(io, deps);

    expect(exitCode).toBe(0);
    expect(calls).not.toContain('spawnServer');
    expect(calls).toContain('chromeInstalled');
  });

  it('starts fresh when the recorded pid is no longer running', async () => {
    const { io } = collectingIo();
    const { deps, calls } = baseDeps({
      readPid: () => 4242,
      isProcessRunning: () => false,
    });

    await runStart(io, deps);

    expect(calls).toContain('spawnServer');
  });

  it('fails with the port-in-use message and writes no pid when the server exits on EADDRINUSE', async () => {
    const { io, stderr } = collectingIo();
    const { deps, calls } = baseDeps({
      spawnServer: () =>
        Promise.resolve({
          kind: 'exited',
          code: 1,
          stderr: 'Error: listen EADDRINUSE: 127.0.0.1:4310',
        }),
    });

    const exitCode = await runStart(io, deps);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toMatch(/port 4310 is already in use/);
    expect(calls).not.toContain('writePid:999');
    expect(calls).not.toContain('chromeInstalled');
  });

  it('does not double the "garden: " prefix when the child already wrote one', async () => {
    const { io, stderr } = collectingIo();
    const { deps } = baseDeps({
      spawnServer: () =>
        Promise.resolve({
          kind: 'exited',
          code: 1,
          stderr: 'garden: tmux is not installed — install it and try again\n',
        }),
    });

    const exitCode = await runStart(io, deps);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['garden: tmux is not installed — install it and try again\n']);
  });

  it('names the 30s timeout, not the generic message, when the server never becomes healthy', async () => {
    const { io, stderr } = collectingIo();
    const { deps, calls } = baseDeps({
      spawnServer: () => Promise.resolve({ kind: 'timed-out', stderr: '', pid: 4242 }),
    });

    const exitCode = await runStart(io, deps);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toBe('garden: garden server did not become healthy within 30s\n');
    expect(calls).not.toContain('writePid:4242');
  });

  it('prints the url instead of opening a window when Chrome is absent', async () => {
    const { io, stdout } = collectingIo();
    const { deps } = baseDeps({ chromeInstalled: () => false });

    const exitCode = await runStart(io, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\n$/)]);
  });
});
