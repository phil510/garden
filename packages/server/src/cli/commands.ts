import type {
  CreateSessionResponse,
  OkResponse,
  Placement,
  SessionsFilter,
  SessionsResponse,
} from '@garden/shared';
import * as http from './http.js';
import { writeAll, type WritableLike } from './io.js';

export interface Io {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
}

/** The `garden` bin's own message for every verb that needs a caller session and finds
 *  none — `new --handoff`, `handoff --to`, and `adopt` all read `GARDEN_SESSION_ID` as
 *  "self" and fail this same way when it's unset. */
const NO_CALLER_SESSION = 'GARDEN_SESSION_ID is not set';

/** The calls a subcommand needs. `./http.ts`'s exports satisfy this by shape. */
export interface CliClient {
  listSessions(filter?: SessionsFilter): Promise<SessionsResponse>;
  createSession(
    cwd: string,
    callerSessionId?: string,
    handoff?: boolean,
  ): Promise<CreateSessionResponse>;
  resumeSession(id: string): Promise<CreateSessionResponse>;
  killSession(id: string): Promise<OkResponse>;
  handoffSession(fromId: string, to: string): Promise<OkResponse>;
  placeSession(id: string, placement: Placement): Promise<OkResponse>;
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
  handoff = false,
): Promise<0 | 1> {
  const callerSessionId = process.env.GARDEN_SESSION_ID;
  return runCommand(
    io,
    json,
    () => {
      if (handoff && callerSessionId === undefined) throw new Error(NO_CALLER_SESSION);
      return client.createSession(dir, callerSessionId, handoff);
    },
    (result) => `${result.id}\t${result.tmuxName}`,
  );
}

export function runLs(
  io: Io,
  json: boolean,
  client: CliClient = defaultClient,
  filter?: SessionsFilter,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    async () => (await client.listSessions(filter)).sessions,
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

export function runHandoff(
  io: Io,
  to: string,
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () => {
      const self = process.env.GARDEN_SESSION_ID;
      if (self === undefined) throw new Error(NO_CALLER_SESSION);
      return client.handoffSession(self, to);
    },
    () => 'handed off',
  );
}

export function runAdopt(
  io: Io,
  target: string,
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () => {
      const self = process.env.GARDEN_SESSION_ID;
      if (self === undefined) throw new Error(NO_CALLER_SESSION);
      return client.placeSession(target, { type: 'parent', parentId: self });
    },
    () => 'adopted',
  );
}
