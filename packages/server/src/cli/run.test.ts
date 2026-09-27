import type { CreateSessionResponse, OkResponse, SessionsResponse } from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import type { StopAllDeps } from './stop.js';
import {
  decideEntrypointAction,
  isCliCommand,
  parseEntrypointArgv,
  runCli,
  usageLines,
} from './run.js';

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
    listSessions: (filter) => {
      calls.push(filter === undefined ? 'ls' : `ls:${JSON.stringify(filter)}`);
      return Promise.resolve(sessions);
    },
    createSession: (cwd, callerSessionId) => {
      calls.push(`new:${cwd}:${callerSessionId ?? ''}`);
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
    placeSession: (id, placement) => {
      calls.push(`place:${id}:${JSON.stringify(placement)}`);
      return Promise.resolve(ok);
    },
  };
  return { client, calls };
}

describe('isCliCommand', () => {
  it('recognises the seven subcommands and nothing else', () => {
    expect(isCliCommand('new')).toBe(true);
    expect(isCliCommand('ls')).toBe(true);
    expect(isCliCommand('kill')).toBe(true);
    expect(isCliCommand('resume')).toBe(true);
    expect(isCliCommand('adopt')).toBe(true);
    expect(isCliCommand('stop')).toBe(true);
    expect(isCliCommand('uninstall')).toBe(true);
    expect(isCliCommand('bogus')).toBe(false);
    expect(isCliCommand(undefined)).toBe(false);
  });
});

describe('parseEntrypointArgv', () => {
  it('reports not detached and no command for an empty argv', () => {
    expect(parseEntrypointArgv([])).toEqual({ command: undefined, rest: [], isDetached: false });
  });

  it('reports detached and no command for the detached re-invocation shape', () => {
    // What `spawnServer` actually passes: the flag alone, nothing else.
    expect(parseEntrypointArgv(['--detached'])).toEqual({
      command: undefined,
      rest: [],
      isDetached: true,
    });
  });

  it('splits a known subcommand and its own args out, undisturbed, when not detached', () => {
    expect(parseEntrypointArgv(['ls', '--json'])).toEqual({
      command: 'ls',
      rest: ['--json'],
      isDetached: false,
    });
  });

  it("does not strip a subcommand argument that happens to share the flag's own literal text", () => {
    // e.g. `garden new --detached`, naming a directory called "--detached" — only a
    // leading position counts as the marker, so this must reach `rest` untouched.
    expect(parseEntrypointArgv(['new', '--detached'])).toEqual({
      command: 'new',
      rest: ['--detached'],
      isDetached: false,
    });
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
    // Both `garden`'s own re-invocation and `pnpm dev`/`pnpm dev:sandbox` land here — whether
    // that run is detached is decided separately, off argv, in bin/garden.ts.
    expect(decideEntrypointAction(undefined, true)).toEqual({ kind: 'server' });
  });

  it('starts the CLI-driven startup flow when no command is given and the process marker is unset', () => {
    // Bare `garden` typed at a shell.
    expect(decideEntrypointAction(undefined, false)).toEqual({ kind: 'start' });
  });

  it('reports an unknown command with the marker set', () => {
    expect(decideEntrypointAction('bogus', true)).toEqual({
      kind: 'unknown',
      command: 'bogus',
    });
  });

  it('reports an unknown command with the marker unset', () => {
    expect(decideEntrypointAction('bogus', false)).toEqual({
      kind: 'unknown',
      command: 'bogus',
    });
  });
});

describe('runCli', () => {
  let originalSessionId: string | undefined;

  beforeEach(() => {
    originalSessionId = process.env.GARDEN_SESSION_ID;
    process.env.GARDEN_SESSION_ID = 'caller-1';
  });

  afterEach(() => {
    if (originalSessionId === undefined) delete process.env.GARDEN_SESSION_ID;
    else process.env.GARDEN_SESSION_ID = originalSessionId;
  });

  it('dispatches "new <dir>" with the positional as the directory', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('new', ['/repo'], io, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual(['new:/repo:caller-1']);
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

  it('dispatches "adopt <id>" with the positional as the target', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('adopt', ['target-1'], io, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      `place:target-1:${JSON.stringify({ type: 'parent', parentId: 'caller-1' })}`,
    ]);
  });

  it('requires a positional for "adopt"', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('adopt', [], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual(['garden: usage: garden adopt <id>\n']);
  });

  it('recognises --json anywhere after the subcommand', async () => {
    const { io, stdout } = collectingIo();
    const { client } = recordingClient();

    await runCli('ls', ['--json'], io, client);

    expect(stdout).toEqual(['[]\n']);
  });

  it('threads --since-days, --max-recap-chars, --live and --status into the filter', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli(
      'ls',
      ['--since-days', '30', '--max-recap-chars', '100', '--live', '--status', 'working'],
      io,
      client,
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      `ls:${JSON.stringify({ sinceDays: 30, maxRecapChars: 100, live: true, status: 'working' })}`,
    ]);
  });

  it('calls listSessions unfiltered when no ls flags are given', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    await runCli('ls', [], io, client);

    expect(calls).toEqual(['ls']);
  });

  it('threads --swarm into the filter as swarmId', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--swarm', 'swarm-1'], io, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([`ls:${JSON.stringify({ swarmId: 'swarm-1' })}`]);
  });

  it('rejects a non-numeric --since-days with a usage error', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--since-days', 'nope'], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual(['garden: usage: garden ls --since-days <non-negative integer days>\n']);
  });

  it('rejects a negative --since-days with a usage error', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--since-days=-1'], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual(['garden: usage: garden ls --since-days <non-negative integer days>\n']);
  });

  it('rejects an empty --since-days with a usage error rather than coercing to 0', async () => {
    // `Number('')` is `0`, which is a non-negative integer — checking the coerced result
    // alone would silently apply sinceDays: 0 instead of surfacing the caller's mistake.
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--since-days='], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual(['garden: usage: garden ls --since-days <non-negative integer days>\n']);
  });

  it('rejects a trailing --since-days with no value as a usage error, not a crash', async () => {
    // node:util's parseArgs throws synchronously when a string-typed option is the last
    // token with no following value — this must surface as a usage error, not an uncaught
    // exception reaching bin/garden.ts's unguarded process.exit(await runCli(...)).
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--since-days'], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual([expect.stringContaining('garden: usage:')]);
  });

  it('rejects a fractional --max-recap-chars with a usage error', async () => {
    // A naive `Number.isFinite` boundary check lets 0.5 through: `.slice(-0.5)` truncates
    // toward zero to `.slice(-0)`, which is `.slice(0)` — the whole string, uncapped.
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--max-recap-chars=0.5'], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual([
      'garden: usage: garden ls --max-recap-chars <non-negative integer chars>\n',
    ]);
  });

  it('rejects a non-numeric --max-recap-chars with a usage error', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--max-recap-chars', 'nope'], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual([
      'garden: usage: garden ls --max-recap-chars <non-negative integer chars>\n',
    ]);
  });

  it('rejects a negative --max-recap-chars with a usage error', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--max-recap-chars=-1'], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual([
      'garden: usage: garden ls --max-recap-chars <non-negative integer chars>\n',
    ]);
  });

  it('rejects an empty --max-recap-chars with a usage error rather than coercing to 0', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--max-recap-chars='], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual([
      'garden: usage: garden ls --max-recap-chars <non-negative integer chars>\n',
    ]);
  });

  it('rejects an invalid --status with a usage error', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    const exitCode = await runCli('ls', ['--status', 'bogus'], io, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stderr).toEqual([
      'garden: usage: garden ls --status <working|waiting|needs-approval|unknown>\n',
    ]);
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
