import type {
  CreateSessionResponse,
  DigestResponse,
  OkResponse,
  Placement,
  SessionsFilter,
  SessionsResponse,
  SpawnOptions,
  WatchesResponse,
  WatchResponse,
  WatchSummary,
} from '@garden/shared';
import { resolve } from 'node:path';
import * as http from './http.js';
import { CliHttpError } from './http.js';
import { writeAll, type WritableLike } from './io.js';

export interface Io {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
}

/** The `garden` bin's own message for the verb that needs a caller session and finds
 *  none — `adopt` reads `GARDEN_SESSION_ID` as "self" and fails this way when it's unset. */
const NO_CALLER_SESSION = 'GARDEN_SESSION_ID is not set';

/** The calls a subcommand needs. `./http.ts`'s exports satisfy this by shape. */
export interface CliClient {
  listSessions(filter?: SessionsFilter): Promise<SessionsResponse>;
  createSession(
    cwd: string,
    callerSessionId?: string,
    options?: SpawnOptions,
  ): Promise<CreateSessionResponse>;
  resumeSession(id: string, options?: SpawnOptions): Promise<CreateSessionResponse>;
  killSession(id: string): Promise<OkResponse>;
  placeSession(id: string, placement: Placement): Promise<OkResponse>;
  watch(
    sessionId: string,
    request: {
      pr: number;
      repo?: string;
      kinds?: readonly string[];
      ignoreChecks?: readonly string[];
      unignoreChecks?: readonly string[];
    },
  ): Promise<WatchResponse>;
  unwatch(sessionId: string, target: { pr: number; repo?: string }): Promise<OkResponse>;
  watches(sessionId: string): Promise<WatchesResponse>;
  digest(id: string): Promise<DigestResponse>;
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
  options: SpawnOptions = {},
): Promise<0 | 1> {
  const callerSessionId = process.env.GARDEN_SESSION_ID;
  // The server's cwd is not the caller's, so a relative dir must be resolved here.
  const absoluteDir = resolve(dir);
  return runCommand(
    io,
    json,
    () => client.createSession(absoluteDir, callerSessionId, options),
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
  options: SpawnOptions = {},
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () => client.resumeSession(id, options),
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

/** What the watch verbs read from the environment and flags: the session is the explicit
 *  `--session`, else the caller's own `GARDEN_SESSION_ID`. */
function watchSession(env: NodeJS.ProcessEnv, explicit: string | undefined): string {
  const session = explicit ?? env.GARDEN_SESSION_ID;
  if (session === undefined || session === '') throw new Error(NO_CALLER_SESSION);
  return session;
}

function watchLine(watch: WatchSummary): string {
  const ignoring =
    watch.ignoredChecks.length === 0 ? '' : ` ignoring: ${watch.ignoredChecks.join(', ')}`;
  return `${watch.repo}#${String(watch.pr)} ${watch.kinds.join(',')} ${watch.status}${
    watch.pendingDigest ? ' pending' : ''
  }${ignoring}`;
}

export interface WatchTarget {
  readonly env: NodeJS.ProcessEnv;
  readonly session: string | undefined;
  readonly pr: number;
  readonly repo: string | undefined;
}

export function runWatch(
  io: Io,
  target: WatchTarget & {
    readonly kinds: readonly string[] | undefined;
    readonly ignoreChecks?: readonly string[] | undefined;
    readonly unignoreChecks?: readonly string[] | undefined;
  },
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () =>
      client.watch(watchSession(target.env, target.session), {
        pr: target.pr,
        ...(target.repo === undefined ? {} : { repo: target.repo }),
        ...(target.kinds === undefined ? {} : { kinds: target.kinds }),
        ...(target.ignoreChecks === undefined ? {} : { ignoreChecks: target.ignoreChecks }),
        ...(target.unignoreChecks === undefined ? {} : { unignoreChecks: target.unignoreChecks }),
      }),
    (result) => watchLine(result.watch),
  );
}

export function runUnwatch(
  io: Io,
  target: Omit<WatchTarget, 'pr'> & { readonly pr: number | 'all' },
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    async (): Promise<OkResponse> => {
      const session = watchSession(target.env, target.session);
      if (target.pr !== 'all') {
        return client.unwatch(session, {
          pr: target.pr,
          ...(target.repo === undefined ? {} : { repo: target.repo }),
        });
      }
      for (const { pr, repo } of (await client.watches(session)).watches) {
        try {
          await client.unwatch(session, { pr, repo });
        } catch (error) {
          // A watch removed since the list was read has nothing left to remove.
          if (!(error instanceof CliHttpError && error.status === 404)) throw error;
        }
      }
      return { ok: true };
    },
    () => 'unwatched',
  );
}

export function runWatches(
  io: Io,
  target: Pick<WatchTarget, 'env' | 'session'>,
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    () => client.watches(watchSession(target.env, target.session)),
    ({ watches }) => (watches.length === 0 ? 'no watches' : watches.map(watchLine).join('\n')),
  );
}

/** A digest is global: it needs no session, so a worker with another `GARDEN_SESSION_ID` can
 *  read what a delivered line counted. */
export function runDigest(
  io: Io,
  id: string,
  json: boolean,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  return runCommand(
    io,
    json,
    async () => {
      try {
        return await client.digest(id);
      } catch (error) {
        if (error instanceof CliHttpError && error.status === 404)
          throw new Error(`no digest ${id} (expired or never recorded)`, { cause: error });
        throw error;
      }
    },
    ({ digest }) => digest.line,
  );
}
