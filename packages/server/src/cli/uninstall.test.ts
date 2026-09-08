import { describe, expect, it } from 'vitest';
import type { Io } from './commands.js';
import { runUninstall, type UninstallDeps } from './uninstall.js';

function collectingIo(): { io: Io; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = {
    stdout: { write: (text) => void stdout.push(text) },
    stderr: { write: (text) => void stderr.push(text) },
  };
  return { io, stdout, stderr };
}

function baseDeps(overrides: Partial<UninstallDeps> = {}): {
  deps: UninstallDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const deps: UninstallDeps = {
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
    removeAppDir: (path) => {
      calls.push(`removeAppDir:${path}`);
    },
    home: '/home/garden-user',
    ...overrides,
  };
  return { deps, calls };
}

describe('runUninstall', () => {
  it('aborts without touching anything when the user declines confirmation', async () => {
    const { io, stdout } = collectingIo();
    const { deps, calls } = baseDeps({ confirm: () => Promise.resolve(false) });

    const exitCode = await runUninstall(io, false, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['aborted\n']);
    expect(calls).toEqual([]);
  });

  it('skips the confirmation prompt when told to', async () => {
    const { io } = collectingIo();
    const { deps, calls } = baseDeps();

    const exitCode = await runUninstall(io, true, deps);

    expect(exitCode).toBe(0);
    expect(calls).not.toContain('confirm');
  });

  it('stops the server, kills the tmux server, and deletes the app dir in order', async () => {
    const { io, stdout } = collectingIo();
    const { deps, calls } = baseDeps();

    const exitCode = await runUninstall(io, false, deps);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      'confirm',
      'stop',
      'killTmuxServer:/home/garden-user/.garden/tmux.conf:garden',
      'removeAppDir:/home/garden-user/.garden',
    ]);
    expect(stdout.at(-1)).toBe('garden uninstalled\n');
  });

  it('stops short and reports failure when the server does not stop', async () => {
    const { io } = collectingIo();
    const { deps, calls } = baseDeps({ stop: () => Promise.resolve(1) });

    const exitCode = await runUninstall(io, false, deps);

    expect(exitCode).toBe(1);
    expect(calls).toEqual(['confirm']);
  });
});
