import type {
  CreateSessionResponse,
  OkResponse,
  SessionsResponse,
  SpawnOptions,
  WatchSummary,
} from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import { CliHttpError } from './http.js';
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

/** Empty when no option is set, so calls without flags keep their plain form. */
function spawnSuffix(options: SpawnOptions | undefined): string {
  const set = Object.entries(options ?? {});
  return set.length === 0 ? '' : `:${JSON.stringify(Object.fromEntries(set))}`;
}

function aWatch(pr: number): WatchSummary {
  return {
    repo: 'owner/name',
    pr,
    kinds: ['review'],
    pendingDigest: false,
    status: 'active',
    ignoredChecks: [],
  };
}

function recordingClient(
  listedWatches: WatchSummary[] = [],
  unwatchFails: ReadonlySet<number> = new Set(),
): { client: CliClient; calls: string[] } {
  const calls: string[] = [];
  const sessions: SessionsResponse = { sessions: [] };
  const created: CreateSessionResponse = { id: 'abc', tmuxName: 'repo' };
  const ok: OkResponse = { ok: true };
  const client: CliClient = {
    listSessions: (filter) => {
      calls.push(filter === undefined ? 'ls' : `ls:${JSON.stringify(filter)}`);
      return Promise.resolve(sessions);
    },
    createSession: (cwd, callerSessionId, options) => {
      calls.push(`new:${cwd}:${callerSessionId ?? ''}${spawnSuffix(options)}`);
      return Promise.resolve(created);
    },
    resumeSession: (id, options) => {
      calls.push(`resume:${id}${spawnSuffix(options)}`);
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
    watch: (sessionId, request) => {
      calls.push(`watch:${sessionId}:${JSON.stringify(request)}`);
      return Promise.resolve({ watch: aWatch(request.pr) });
    },
    unwatch: (sessionId, target) => {
      calls.push(`unwatch:${sessionId}:${JSON.stringify(target)}`);
      if (unwatchFails.has(target.pr)) {
        return Promise.reject(new CliHttpError('not watching', { status: 404 }));
      }
      return Promise.resolve(ok);
    },
    watches: (sessionId) => {
      calls.push(`watches:${sessionId}`);
      return Promise.resolve({ watches: listedWatches });
    },
    digest: (id) => {
      calls.push(`digest:${id}`);
      return Promise.reject(new Error('not used by this test'));
    },
  };
  return { client, calls };
}

describe('isCliCommand', () => {
  it('recognises the twelve subcommands and nothing else', () => {
    expect(isCliCommand('new')).toBe(true);
    expect(isCliCommand('ls')).toBe(true);
    expect(isCliCommand('kill')).toBe(true);
    expect(isCliCommand('resume')).toBe(true);
    expect(isCliCommand('adopt')).toBe(true);
    expect(isCliCommand('watch')).toBe(true);
    expect(isCliCommand('unwatch')).toBe(true);
    expect(isCliCommand('watches')).toBe(true);
    expect(isCliCommand('digest')).toBe(true);
    expect(isCliCommand('events')).toBe(true);
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

  it('forwards --model and --effort on "new", each independently', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    expect(await runCli('new', ['/repo', '--model', 'opus', '--effort', 'high'], io, client)).toBe(
      0,
    );
    expect(await runCli('new', ['/repo', '--effort', 'max'], io, client)).toBe(0);

    expect(calls).toEqual([
      'new:/repo:caller-1:{"model":"opus","effort":"high"}',
      'new:/repo:caller-1:{"effort":"max"}',
    ]);
  });

  it('forwards --model and --effort on "resume"', async () => {
    const { io } = collectingIo();
    const { client, calls } = recordingClient();

    expect(
      await runCli('resume', ['abc', '--model', 'sonnet', '--effort', 'low'], io, client),
    ).toBe(0);

    expect(calls).toEqual(['resume:abc:{"model":"sonnet","effort":"low"}']);
  });

  it.each([
    ['new', ['/repo', '--effort', 'extreme'], 'garden new <dir>'],
    ['new', ['/repo', '--model=-x'], 'garden new <dir>'],
    ['resume', ['abc', '--effort', 'bogus'], 'garden resume <id>'],
    ['resume', ['abc', '--model='], 'garden resume <id>'],
  ] as const)(
    'rejects a bad flag value on "%s" before calling the server',
    async (command, args, form) => {
      const { io, stderr } = collectingIo();
      const { client, calls } = recordingClient();

      expect(await runCli(command, args, io, client)).toBe(1);

      expect(stderr).toEqual([
        `garden: usage: ${form} [--model <model>] [--effort <low|medium|high|xhigh|max>]\n`,
      ]);
      expect(calls).toEqual([]);
    },
  );

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

  it('requires an id for "digest" and needs no session for it', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    expect(await runCli('digest', [], io, client, undefined, {})).toBe(1);
    expect(stderr).toEqual(['garden: usage: garden digest <id> [--json]\n']);
    expect(calls).toEqual([]);

    await runCli('digest', ['abc'], collectingIo().io, client, undefined, {});
    expect(calls).toEqual(['digest:abc']);
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

  it.each([[[]], [['--follow', '--session', 'other']]])(
    'rejects "events" with args %j as a usage error',
    async (args) => {
      const { io, stderr } = collectingIo();
      const { client, calls } = recordingClient();

      expect(await runCli('events', args, io, client)).toBe(1);

      expect(calls).toEqual([]);
      expect(stderr).toEqual(['garden: usage: garden events --follow\n']);
    },
  );

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

describe('runCli watch verbs', () => {
  const env = { GARDEN_SESSION_ID: 'env-session' };
  const run = (
    command: 'watch' | 'unwatch' | 'watches',
    args: string[],
    client: CliClient,
    callerEnv: NodeJS.ProcessEnv = env,
  ) => runCli(command, args, collectingIo().io, client, undefined, callerEnv);

  it('defaults the session from GARDEN_SESSION_ID and lets --session override it', async () => {
    const { client, calls } = recordingClient();

    expect(await run('watch', ['12'], client)).toBe(0);
    expect(await run('watch', ['12', '--session', 'other'], client)).toBe(0);
    expect(await run('watches', [], client)).toBe(0);
    expect(await run('watches', ['--session', 'other'], client)).toBe(0);
    expect(await run('unwatch', ['12'], client)).toBe(0);
    expect(await run('unwatch', ['12', '--session', 'other'], client)).toBe(0);

    expect(calls).toEqual([
      'watch:env-session:{"pr":12}',
      'watch:other:{"pr":12}',
      'watches:env-session',
      'watches:other',
      'unwatch:env-session:{"pr":12}',
      'unwatch:other:{"pr":12}',
    ]);
  });

  it('passes --repo and a comma-separated --on through unmodified', async () => {
    const { client, calls } = recordingClient();

    await run('watch', ['5', '--repo', 'o/n', '--on', 'review,bogus'], client);
    await run('unwatch', ['5', '--repo', 'o/n'], client);

    expect(calls).toEqual([
      'watch:env-session:{"pr":5,"repo":"o/n","kinds":["review","bogus"]}',
      'unwatch:env-session:{"pr":5,"repo":"o/n"}',
    ]);
  });

  it('passes repeated --ignore-check and --unignore-check as arrays, and omits them otherwise', async () => {
    const { client, calls } = recordingClient();

    await run(
      'watch',
      ['5', '--ignore-check', 'a', '--ignore-check', 'b c', '--unignore-check', 'd'],
      client,
    );
    await run('watch', ['5'], client);

    expect(calls).toEqual([
      'watch:env-session:{"pr":5,"ignoreChecks":["a","b c"],"unignoreChecks":["d"]}',
      'watch:env-session:{"pr":5}',
    ]);
  });

  it('removes every listed watch on unwatch --all and tolerates a 404', async () => {
    const { client, calls } = recordingClient([aWatch(1), aWatch(2), aWatch(3)], new Set([2]));

    expect(await run('unwatch', ['--all'], client)).toBe(0);

    expect(calls).toEqual([
      'watches:env-session',
      'unwatch:env-session:{"pr":1,"repo":"owner/name"}',
      'unwatch:env-session:{"pr":2,"repo":"owner/name"}',
      'unwatch:env-session:{"pr":3,"repo":"owner/name"}',
    ]);
  });

  it.each([
    ['watch', []],
    ['watch', ['abc']],
    ['watch', ['1.5']],
    ['watch', ['0']],
    ['unwatch', []],
    ['unwatch', ['x']],
  ] as const)(
    'rejects "%s %j" as a usage error before calling the server',
    async (command, args) => {
      const { io, stderr } = collectingIo();
      const { client, calls } = recordingClient();

      expect(await runCli(command, [...args], io, client, undefined, env)).toBe(1);

      expect(calls).toEqual([]);
      expect(stderr).toEqual([expect.stringContaining('garden: usage: garden ')]);
    },
  );

  it('fails with no caller session when neither the flag nor the environment names one', async () => {
    const { io, stderr } = collectingIo();
    const { client, calls } = recordingClient();

    expect(await runCli('watches', [], io, client, undefined, {})).toBe(1);

    expect(calls).toEqual([]);
    expect(stderr).toEqual(['garden: GARDEN_SESSION_ID is not set\n']);
  });
});
