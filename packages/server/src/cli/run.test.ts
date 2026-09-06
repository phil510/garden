import type { CreateSessionResponse, OkResponse, SessionsResponse } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { CliClient, Io } from './commands.js';
import { isCliCommand, runCli } from './run.js';

function collectingIo(): { io: Io; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = {
    stdout: { write: (text) => void stdout.push(text) },
    stderr: { write: (text) => void stderr.push(text) },
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
  it('recognises the four subcommands and nothing else', () => {
    expect(isCliCommand('new')).toBe(true);
    expect(isCliCommand('ls')).toBe(true);
    expect(isCliCommand('kill')).toBe(true);
    expect(isCliCommand('resume')).toBe(true);
    expect(isCliCommand('stop')).toBe(false);
    expect(isCliCommand(undefined)).toBe(false);
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
});
