import type { CreateSessionResponse, OkResponse, SessionsResponse } from '@garden/shared';
import * as http from './http.js';
import { writeAll, type WritableLike } from './io.js';

export interface Io {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
}

/** The four calls a subcommand needs. `./http.ts`'s exports satisfy this by shape. */
export interface CliClient {
  listSessions(): Promise<SessionsResponse>;
  createSession(cwd: string): Promise<CreateSessionResponse>;
  resumeSession(id: string): Promise<CreateSessionResponse>;
  killSession(id: string): Promise<OkResponse>;
}

export const defaultClient: CliClient = http;

function printResult(io: Io, json: boolean, data: unknown, line: () => string): Promise<void> {
  return writeAll(io.stdout, json ? `${JSON.stringify(data)}\n` : `${line()}\n`);
}

function printError(io: Io, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  return writeAll(io.stderr, `garden: ${message}\n`);
}

async function runCommand<T>(
  io: Io,
  json: boolean,
  action: () => Promise<T>,
  line: (result: T) => string,
): Promise<0 | 1> {
  try {
    const result = await action();
    await printResult(io, json, result, () => line(result));
    return 0;
  } catch (error) {
    await printError(io, error);
    return 1;
  }
}

export function runNew(
  io: Io,
  dir: string,
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () => client.createSession(dir),
    (result) => `${result.id}\t${result.tmuxName}`,
  );
}

export function runLs(io: Io, json: boolean, client: CliClient = defaultClient): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    async () => (await client.listSessions()).sessions,
    (sessions) =>
      sessions.length === 0
        ? 'no sessions'
        : sessions
            .map((s) => `${s.id}\t${s.liveness}\t${s.status ?? '-'}\t${s.title ?? s.cwd}`)
            .join('\n'),
  );
}

export function runResume(
  io: Io,
  id: string,
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () => client.resumeSession(id),
    (result) => `${result.id}\t${result.tmuxName}`,
  );
}

export function runKill(
  io: Io,
  id: string,
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () => client.killSession(id),
    () => 'killed',
  );
}
