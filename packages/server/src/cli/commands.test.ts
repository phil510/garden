import type {
  CreateSessionResponse,
  DigestResponse,
  OkResponse,
  SessionsFilter,
  SessionState,
  SessionsResponse,
  WatchSummary,
} from '@garden/shared';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import {
  runAdopt,
  runDigest,
  runKill,
  runLs,
  runNew,
  runResume,
  runUnwatch,
  runAlert,
  runAlertClear,
  runWatch,
  runWatches,
} from './commands.js';
import { CliHttpError } from './http.js';

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

function aSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'session-1',
    cwd: '/repo',
    repoRoot: '/repo',
    branch: 'main',
    title: 'fix the bug',
    recap: null,
    liveness: 'live',
    status: 'working',
    statusReason: null,
    exitCode: null,
    tmuxName: 'repo',
    lastActivity: 0,
    claudeSessionName: null,
    watches: [],
    alert: null,
    pipeConnected: false,
    pipeLastConnectedAt: null,
    ...overrides,
  };
}

function throwingClient(error: Error): CliClient {
  return {
    listSessions: () => Promise.reject(error),
    createSession: () => Promise.reject(error),
    resumeSession: () => Promise.reject(error),
    killSession: () => Promise.reject(error),
    placeSession: () => Promise.reject(error),
    watch: () => Promise.reject(error),
    unwatch: () => Promise.reject(error),
    watches: () => Promise.reject(error),
    raiseAlert: () => Promise.reject(error),
    clearAlert: () => Promise.reject(error),
    digest: () => Promise.reject(error),
  };
}

describe('runNew', () => {
  let originalSessionId: string | undefined;

  beforeEach(() => {
    originalSessionId = process.env.GARDEN_SESSION_ID;
  });

  afterEach(() => {
    if (originalSessionId === undefined) delete process.env.GARDEN_SESSION_ID;
    else process.env.GARDEN_SESSION_ID = originalSessionId;
  });

  it('forwards GARDEN_SESSION_ID from its own pane environment as the caller', async () => {
    process.env.GARDEN_SESSION_ID = 'caller-1';
    const { io } = collectingIo();
    const response: CreateSessionResponse = { id: 'abc', tmuxName: 'repo' };
    const calls: Array<[string, string | undefined]> = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      createSession: (cwd, callerSessionId) => {
        calls.push([cwd, callerSessionId]);
        return Promise.resolve(response);
      },
    };

    const exitCode = await runNew(io, '/repo', false, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([['/repo', 'caller-1']]);
  });

  it('forwards no caller when GARDEN_SESSION_ID is unset', async () => {
    delete process.env.GARDEN_SESSION_ID;
    const { io } = collectingIo();
    const response: CreateSessionResponse = { id: 'abc', tmuxName: 'repo' };
    const calls: Array<[string, string | undefined]> = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      createSession: (cwd, callerSessionId) => {
        calls.push([cwd, callerSessionId]);
        return Promise.resolve(response);
      },
    };

    const exitCode = await runNew(io, '/repo', false, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([['/repo', undefined]]);
  });

  it('resolves a relative dir against the CLI cwd before sending it', async () => {
    const { io } = collectingIo();
    const sent: string[] = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      createSession: (cwd) => {
        sent.push(cwd);
        return Promise.resolve({ id: 'abc', tmuxName: 'repo' });
      },
    };

    await runNew(io, '.', false, client);
    await runNew(io, 'sub/dir', false, client);
    await runNew(io, '/abs/../repo/', false, client);

    expect(sent).toEqual([process.cwd(), resolve(process.cwd(), 'sub/dir'), '/repo']);
  });

  it('prints the minted id and tmux name on success', async () => {
    const { io, stdout, stderr } = collectingIo();
    const response: CreateSessionResponse = { id: 'abc', tmuxName: 'repo' };
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      createSession: () => Promise.resolve(response),
    };

    const exitCode = await runNew(io, '/repo', false, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['abc\trepo\n']);
    expect(stderr).toEqual([]);
  });

  it('prints json when --json is set', async () => {
    const { io, stdout } = collectingIo();
    const response: CreateSessionResponse = { id: 'abc', tmuxName: 'repo' };
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      createSession: () => Promise.resolve(response),
    };

    const exitCode = await runNew(io, '/repo', true, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([`${JSON.stringify(response)}\n`]);
  });

  it('exits non-zero and writes the error to stderr on failure', async () => {
    const { io, stdout, stderr } = collectingIo();
    const client = throwingClient(new Error('garden server is not running'));

    const exitCode = await runNew(io, '/repo', false, client);

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['garden: garden server is not running\n']);
  });
});

describe('runAdopt', () => {
  let originalSessionId: string | undefined;

  beforeEach(() => {
    originalSessionId = process.env.GARDEN_SESSION_ID;
  });

  afterEach(() => {
    if (originalSessionId === undefined) delete process.env.GARDEN_SESSION_ID;
    else process.env.GARDEN_SESSION_ID = originalSessionId;
  });

  it("places the named target's parent as GARDEN_SESSION_ID on success", async () => {
    process.env.GARDEN_SESSION_ID = 'caller-1';
    const { io, stdout } = collectingIo();
    const calls: Array<[string, unknown]> = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      placeSession: (id, placement) => {
        calls.push([id, placement]);
        return Promise.resolve({ ok: true });
      },
    };

    const exitCode = await runAdopt(io, 'target-1', false, client);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([['target-1', { type: 'parent', parentId: 'caller-1' }]]);
    expect(stdout).toEqual(['adopted\n']);
  });

  it('fails with exit 1 and creates no relationship when GARDEN_SESSION_ID is unset', async () => {
    delete process.env.GARDEN_SESSION_ID;
    const { io, stdout, stderr } = collectingIo();
    const calls: unknown[] = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      placeSession: (...args) => {
        calls.push(args);
        return Promise.resolve({ ok: true });
      },
    };

    const exitCode = await runAdopt(io, 'target-1', false, client);

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['garden: GARDEN_SESSION_ID is not set\n']);
  });

  it('surfaces a cross-swarm rejection from the server on stderr, exit 1', async () => {
    process.env.GARDEN_SESSION_ID = 'caller-1';
    const { io, stderr } = collectingIo();
    const client = throwingClient(new Error('target-1 belongs to a different swarm than caller-1'));

    const exitCode = await runAdopt(io, 'target-1', false, client);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['garden: target-1 belongs to a different swarm than caller-1\n']);
  });
});

describe('runLs', () => {
  it('prints one line per session, most fields tab-separated', async () => {
    const { io, stdout } = collectingIo();
    const sessions: SessionsResponse = {
      sessions: [
        aSession(),
        aSession({ id: 'session-2', status: null, liveness: 'dead', title: null }),
      ],
    };
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      listSessions: () => Promise.resolve(sessions),
    };

    const exitCode = await runLs(io, false, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['session-1\tlive\tworking\tfix the bug\nsession-2\tdead\t-\t/repo\n']);
  });

  it('prints a placeholder line when there are no sessions', async () => {
    const { io, stdout } = collectingIo();
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      listSessions: () => Promise.resolve({ sessions: [] }),
    };

    const exitCode = await runLs(io, false, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['no sessions\n']);
  });

  it('prints the raw session array as json', async () => {
    const { io, stdout } = collectingIo();
    const sessions: SessionsResponse = { sessions: [aSession()] };
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      listSessions: () => Promise.resolve(sessions),
    };

    const exitCode = await runLs(io, true, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([`${JSON.stringify(sessions.sessions)}\n`]);
  });

  it('threads the filter through to the client, unfiltered when none is given', async () => {
    const { io } = collectingIo();
    const seenFilters: (SessionsFilter | undefined)[] = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      listSessions: (filter) => {
        seenFilters.push(filter);
        return Promise.resolve({ sessions: [] });
      },
    };

    await runLs(io, false, client);
    await runLs(io, false, client, { sinceDays: 30, live: true });

    expect(seenFilters).toEqual([undefined, { sinceDays: 30, live: true }]);
  });
});

describe('runResume', () => {
  it('prints the id and tmux name on success', async () => {
    const { io, stdout } = collectingIo();
    const response: CreateSessionResponse = { id: 'abc', tmuxName: 'repo-2' };
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      resumeSession: () => Promise.resolve(response),
    };

    const exitCode = await runResume(io, 'abc', false, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['abc\trepo-2\n']);
  });

  it('surfaces a not-found error on stderr', async () => {
    const { io, stderr } = collectingIo();
    const client = throwingClient(new Error('no such session: abc'));

    const exitCode = await runResume(io, 'abc', false, client);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['garden: no such session: abc\n']);
  });
});

describe('runKill', () => {
  it('prints a confirmation on success', async () => {
    const { io, stdout } = collectingIo();
    const response: OkResponse = { ok: true };
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      killSession: () => Promise.resolve(response),
    };

    const exitCode = await runKill(io, 'abc', false, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['killed\n']);
  });

  it('prints json on success when --json is set', async () => {
    const { io, stdout } = collectingIo();
    const response: OkResponse = { ok: true };
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      killSession: () => Promise.resolve(response),
    };

    const exitCode = await runKill(io, 'abc', true, client);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([`${JSON.stringify(response)}\n`]);
  });
});

function aWatch(overrides: Partial<WatchSummary> = {}): WatchSummary {
  return {
    repo: 'owner/name',
    pr: 123,
    kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
    pendingDigest: false,
    ignoredChecks: [],
    status: 'active',
    ...overrides,
  };
}

describe('runWatches', () => {
  it('prints one line per watch and marks a waiting digest', async () => {
    const { io, stdout } = collectingIo();
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      watches: () =>
        Promise.resolve({
          watches: [aWatch(), aWatch({ pr: 7, kinds: ['closed'], pendingDigest: true })],
        }),
    };

    const exitCode = await runWatches(
      io,
      { env: { GARDEN_SESSION_ID: 's1' }, session: undefined },
      false,
      client,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([
      'owner/name#123 review,comment,checks,conflict,closed active\nowner/name#7 closed active pending\n',
    ]);
  });

  it('lists ignored checks on the watch line and in --json', async () => {
    const { io, stdout } = collectingIo();
    const watches = [aWatch({ pr: 7, kinds: ['closed'], ignoredChecks: ['cve-scan', 'ci/x'] })];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      watches: () => Promise.resolve({ watches }),
    };
    const target = { env: { GARDEN_SESSION_ID: 's1' }, session: undefined };

    await runWatches(io, target, false, client);
    await runWatches(io, target, true, client);

    expect(stdout[0]).toBe('owner/name#7 closed active ignoring: cve-scan, ci/x\n');
    expect(JSON.parse(stdout[1] ?? '')).toMatchObject({
      watches: [{ ignoredChecks: ['cve-scan', 'ci/x'] }],
    });
  });

  it('says so when there are no watches, and prints the response as JSON with --json', async () => {
    const { io, stdout } = collectingIo();
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      watches: () => Promise.resolve({ watches: [] }),
    };
    const target = { env: { GARDEN_SESSION_ID: 's1' }, session: undefined };

    await runWatches(io, target, false, client);
    await runWatches(io, target, true, client);

    expect(stdout).toEqual(['no watches\n', '{"watches":[]}\n']);
  });

  it('fails without a session from the flag or the environment', async () => {
    const { io, stderr } = collectingIo();

    const exitCode = await runWatches(
      io,
      { env: {}, session: undefined },
      false,
      throwingClient(new Error('unused')),
    );

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['garden: GARDEN_SESSION_ID is not set\n']);
  });
});

describe('runAlert', () => {
  it('raises the alert on the caller session, passing multi-line text through unchanged', async () => {
    const { io, stdout } = collectingIo();
    const raised: Array<[string, string]> = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      raiseAlert: (sessionId, text) => {
        raised.push([sessionId, text]);
        return Promise.resolve({ alert: { text, raisedAt: 1, updatedAt: 1 } });
      },
    };

    const exitCode = await runAlert(
      io,
      { env: { GARDEN_SESSION_ID: 's1' }, text: 'stuck\n  on CI' },
      false,
      client,
    );

    expect(exitCode).toBe(0);
    expect(raised).toEqual([['s1', 'stuck\n  on CI']]);
    expect(stdout).toEqual(['alert raised\n']);
  });

  it('fails without calling the client when GARDEN_SESSION_ID is unset or empty', async () => {
    for (const env of [{}, { GARDEN_SESSION_ID: '' }]) {
      const { io, stderr } = collectingIo();

      const exitCode = await runAlert(
        io,
        { env, text: 'x' },
        false,
        throwingClient(new Error('called')),
      );

      expect(exitCode).toBe(1);
      expect(stderr).toEqual(['garden: GARDEN_SESSION_ID is not set\n']);
    }
  });
});

describe('runAlertClear', () => {
  it('clears the alert on the caller session', async () => {
    const { io, stdout } = collectingIo();
    const cleared: string[] = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      clearAlert: (sessionId) => {
        cleared.push(sessionId);
        return Promise.resolve({ ok: true });
      },
    };

    const exitCode = await runAlertClear(io, { env: { GARDEN_SESSION_ID: 's1' } }, false, client);

    expect(exitCode).toBe(0);
    expect(cleared).toEqual(['s1']);
    expect(stdout).toEqual(['alert cleared\n']);
  });
});

describe('runWatch', () => {
  it('prints the created watch in the same form as the list', async () => {
    const { io, stdout } = collectingIo();
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      watch: () => Promise.resolve({ watch: aWatch({ kinds: ['review', 'closed'] }) }),
    };

    const exitCode = await runWatch(
      io,
      {
        env: { GARDEN_SESSION_ID: 's1' },
        session: undefined,
        pr: 123,
        repo: undefined,
        kinds: ['review'],
      },
      false,
      client,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['owner/name#123 review,closed active\n']);
  });
});

describe('runUnwatch', () => {
  it('skips a watch that vanished between the list and its delete, and removes the rest', async () => {
    const { io, stdout } = collectingIo();
    const removed: string[] = [];
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      watches: () => Promise.resolve({ watches: [aWatch({ pr: 1 }), aWatch({ pr: 2 })] }),
      unwatch: (_session, { pr }) => {
        if (pr === 1) return Promise.reject(new CliHttpError('not watching', { status: 404 }));
        removed.push(String(pr));
        return Promise.resolve({ ok: true });
      },
    };

    const exitCode = await runUnwatch(
      io,
      { env: { GARDEN_SESSION_ID: 's1' }, session: undefined, pr: 'all', repo: undefined },
      false,
      client,
    );

    expect(exitCode).toBe(0);
    expect(removed).toEqual(['2']);
    expect(stdout).toEqual(['unwatched\n']);
  });

  it('stops on any other failure', async () => {
    const { io, stderr } = collectingIo();
    const client: CliClient = {
      ...throwingClient(new Error('unused')),
      watches: () => Promise.resolve({ watches: [aWatch()] }),
      unwatch: () => Promise.reject(new CliHttpError('boom', { status: 500 })),
    };

    const exitCode = await runUnwatch(
      io,
      { env: { GARDEN_SESSION_ID: 's1' }, session: undefined, pr: 'all', repo: undefined },
      false,
      client,
    );

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['garden: boom\n']);
  });
});

describe('runDigest', () => {
  const response: DigestResponse = {
    digest: {
      id: 'abc123',
      repo: 'owner/name',
      pr: 7,
      line: '#7 owner/name: [digest abc123] 1 comment',
      createdAt: '2026-01-01T00:00:00.000Z',
      replaces: null,
      atMint: { headSha: 'sha1', mergeable: true },
      closed: null,
      items: {
        reviews: [],
        issueComments: [{ id: 1, author: 'alice', at: '2026-01-01T00:00:00.000Z' }],
        reviewComments: [],
        checkRuns: [],
        statuses: [],
        conflicts: [],
      },
    },
  };
  const client = (...ids: string[]): CliClient => ({
    ...throwingClient(new Error('unused')),
    digest: (id) => {
      ids.push(id);
      return Promise.resolve(response);
    },
  });

  it('prints the stored line, or the whole response as JSON with --json', async () => {
    const { io, stdout } = collectingIo();
    const ids: string[] = [];

    expect(await runDigest(io, 'abc123', false, client(...ids))).toBe(0);
    expect(await runDigest(io, 'abc123', true, client(...ids))).toBe(0);

    expect(stdout).toEqual([`${response.digest.line}\n`, `${JSON.stringify(response)}\n`]);
  });

  it('says the digest expired or was never recorded on a 404, and exits 1', async () => {
    const { io, stdout, stderr } = collectingIo();
    const missing: CliClient = {
      ...throwingClient(new Error('unused')),
      digest: () => Promise.reject(new CliHttpError('no digest nope', { status: 404 })),
    };

    expect(await runDigest(io, 'nope', true, missing)).toBe(1);

    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['garden: no digest nope (expired or never recorded)\n']);
  });

  it('surfaces any other failure as it is, and exits 1', async () => {
    const { io, stderr } = collectingIo();

    expect(await runDigest(io, 'x', false, throwingClient(new Error('server is down')))).toBe(1);

    expect(stderr).toEqual(['garden: server is down\n']);
  });
});
