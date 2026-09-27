import type {
  CreateSessionResponse,
  OkResponse,
  SessionsFilter,
  SessionState,
  SessionsResponse,
} from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import { runAdopt, runKill, runLs, runNew, runResume } from './commands.js';

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
