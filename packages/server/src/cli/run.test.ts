import type { CreateSessionResponse, OkResponse, SessionsResponse } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import type { StopAllDeps } from './stop.js';
import { decideEntrypointAction, isCliCommand, runCli, usageLines } from './run.js';

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

function recordingClient(): { client: CliClient; calls: string[] } {
  const calls: string[] = [];
  const sessions: SessionsResponse = { sessions: [] };
  const created: CreateSessionResponse = { id: 'abc', tmuxName: 'repo' };
  const ok: OkResponse = { ok: true };
  const client: CliClient = {
    listSessions: () => {
      calls.push('ls');
      return Promise.resolve(sessions);
    },
    createSession: (cwd) => {
      calls.push(`new:${cwd}`);
      return Promise.resolve(created);
    },
    resumeSession: (id) => {
      calls.push(`resume:${id}`);
      return Promise.resolve(created);
    },
    killSession: (id) => {
      calls.push(`kill:${id}`);
      return Promise.resolve(ok);
    },
  };
  return { client, calls };
}

describe('isCliCommand', () => {
  it('recognises the six subcommands and nothing else', () => {
    expect(isCliCommand('new')).toBe(true);
    expect(isCliCommand('ls')).toBe(true);
    expect(isCliCommand('kill')).toBe(true);
    expect(isCliCommand('resume')).toBe(true);
    expect(isCliCommand('stop')).toBe(true);
    expect(isCliCommand('uninstall')).toBe(true);
    expect(isCliCommand('bogus')).toBe(false);
    expect(isCliCommand(undefined)).toBe(false);
  });
});

describe('decideEntrypointAction', () => {
  it('dispatches a known subcommand even with the server-process marker set', () => {
    // The inherited-marker regression case: a subcommand typed inside a garden-managed
    // pane must dispatch, not recurse into the server.
    expect(decideEntrypointAction('ls', true)).toEqual({ kind: 'cli', command: 'ls' });
  });

  it('dispatches a known subcommand with the marker unset', () => {
    expect(decideEntrypointAction('ls', false)).toEqual({ kind: 'cli', command: 'ls' });
  });

  it('runs the server when no command is given and the marker is set', () => {
    // The detached re-invocation that `garden` performs to start the server.
    expect(decideEntrypointAction(undefined, true)).toEqual({ kind: 'server' });
  });

  it('starts the CLI-driven startup flow when no command is given and the marker is unset', () => {
    // Bare `garden` typed at a shell.
    expect(decideEntrypointAction(undefined, false)).toEqual({ kind: 'start' });
  });

  it('reports an unknown command with the marker set', () => {
    expect(decideEntrypointAction('bogus', true)).toEqual({ kind: 'unknown', command: 'bogus' });
  });

  it('reports an unknown command with the marker unset', () => {
    expect(decideEntrypointAction('bogus', false)).toEqual({ kind: 'unknown', command: 'bogus' });
  });
});

describe('runCli', () => {
  it('dispatches "new <dir>" with the positional as the directory', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('new', ['/repo'], io, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual(['new:/repo']);
  });

  it('dispatches "ls" with no positionals required', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', [], io, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual(['ls']);
  });

  it('dispatches "kill <id>" and "resume <id>" with the positional as the id', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    expect(await runCli('kill', ['abc'], io, client)).toBe(0);
    expect(await runCli('resume', ['abc'], io, client)).toBe(0);
    expect(calls).toEqual(['kill:abc', 'resume:abc']);
  });

  it('recognises --json anywhere after the subcommand', async () => {
    const { io, stdout } = collectingIo();
    const { client } = recordingClient();

    await runCli('ls', ['--json'], io, client);

    expect(stdout).toEqual(['[]\n']);
  });

  it('prints a usage message and exits 1 when the required positional is missing', async () => {
    const { io, stdout, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('new', [], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['garden: usage: garden new <dir>\n']);
  });

  it('shows [--all] on the stop subcommand', () => {
    expect(usageLines()).toContain('stop [--all]');
  });
});

function fakeStopAllDeps(overrides: Partial<StopAllDeps> = {}): {
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
    killTmuxServer: () => {
      calls.push('killTmuxServer');
      return Promise.resolve();
    },
    home: '/home/garden-user',
    appDir: '/home/garden-user/.garden',
    tmuxSocket: 'garden',
    ...overrides,
  };
  return { deps, calls };
}

describe('runCli dispatch of "stop --all"', () => {
  it('confirms, stops, and kills tmux when --all is set', async () => {
    const { io } = collectingIo();
    const { client, calls: clientCalls } = recordingClient();
    const { deps, calls } = fakeStopAllDeps();

    const exitCode = await runCli('stop', ['--all'], io, client, deps);

    expect(exitCode).toBe(0);
    expect(clientCalls).toEqual(['ls']);
    expect(calls).toEqual(['confirm', 'stop', 'killTmuxServer']);
  });

  it('skips confirmation and the session-count fetch when --all --yes are both set', async () => {
    const { io } = collectingIo();
    const { client, calls: clientCalls } = recordingClient();
    const { deps, calls } = fakeStopAllDeps();

    const exitCode = await runCli('stop', ['--all', '--yes'], io, client, deps);

    expect(exitCode).toBe(0);
    expect(clientCalls).toEqual([]);
    expect(calls).toEqual(['stop', 'killTmuxServer']);
  });
});
