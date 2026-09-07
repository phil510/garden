import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Io } from './commands.js';
import { runStop, type StopDeps } from './stop.js';

function collectingIo(): { io: Io; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = {
    stdout: { write: (text) => void stdout.push(text) },
    stderr: { write: (text) => void stderr.push(text) },
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
    });

    const exitCode = await runStop(io, deps);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toMatch(/did not stop within 200ms/);
    expect(calls).not.toContain('removePid');
  });
});
