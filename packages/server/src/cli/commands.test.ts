import type {
  CreateSessionResponse,
  OkResponse,
  SessionState,
  SessionsResponse,
} from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import { runKill, runLs, runNew, runResume } from './commands.js';

function collectingIo(): { io: Io; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = {
    stdout: { write: (text) => void stdout.push(text) },
    stderr: { write: (text) => void stderr.push(text) },
  };
  return { io, stdout, stderr };
}

function aSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'session-1',
    cwd: '/repo',
    repoRoot: '/repo',
    worktree: null,
    branch: 'main',
    title: 'fix the bug',
    recap: null,
    liveness: 'live',
    status: 'working',
    statusReason: null,
    exitCode: null,
    tmuxName: 'repo',
    lastActivity: 0,
    ...overrides,
  };
}

function throwingClient(error: Error): CliClient {
  return {
    listSessions: () => Promise.reject(error),
    createSession: () => Promise.reject(error),
    resumeSession: () => Promise.reject(error),
    killSession: () => Promise.reject(error),
  };
}

describe('runNew', () => {
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
