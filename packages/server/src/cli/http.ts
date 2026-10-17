import { homedir } from 'node:os';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  DigestResponse,
  ErrorResponse,
  OkResponse,
  Placement,
  PlacementRequest,
  ResumeSessionRequest,
  SessionsFilter,
  SessionsResponse,
  SpawnOptions,
  WatchesResponse,
  WatchResponse,
} from '@garden/shared';
import { pipeStreamPath } from '@garden/shared';
import { ensureConfigFile, loadConfig } from '../config.js';

/** The server did not answer, or answered with an error the client can only surface. */
export class CliHttpError extends Error {
  /** The HTTP status of an error response; undefined when the server never answered. */
  readonly status: number | undefined;

  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options);
    this.name = 'CliHttpError';
    this.status = options?.status;
  }
}

function hostPort(): string {
  const home = homedir();
  const config = loadConfig(process.env, ensureConfigFile(home), home);
  return `${config.host}:${String(config.port)}`;
}

function baseUrl(): string {
  return `http://${hostPort()}`;
}

/** The session's pipe stream URL. Read afresh on every call so a restarted server, which may
 *  have moved, is found again. */
export function pipeUrl(sessionId: string): string {
  return `ws://${hostPort()}${pipeStreamPath(sessionId)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, init);
  } catch (cause) {
    throw new CliHttpError('garden server is not running — start it with `garden`', { cause });
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorResponse | null;
    throw new CliHttpError(body?.error ?? `garden server returned ${String(response.status)}`, {
      status: response.status,
    });
  }
  return (await response.json()) as T;
}

/** Mirrors `packages/web/src/api/client.ts`'s `URLSearchParams` idiom for building a query. */
function sessionsQuery(filter: SessionsFilter): string {
  const params = new URLSearchParams();
  if (filter.sinceDays !== undefined) params.set('sinceDays', String(filter.sinceDays));
  if (filter.maxRecapChars !== undefined) params.set('maxRecapChars', String(filter.maxRecapChars));
  if (filter.live !== undefined) params.set('live', String(filter.live));
  if (filter.status !== undefined) params.set('status', filter.status);
  if (filter.swarmId !== undefined) params.set('swarm', filter.swarmId);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function listSessions(filter?: SessionsFilter): Promise<SessionsResponse> {
  return request(`/sessions${filter === undefined ? '' : sessionsQuery(filter)}`);
}

function definedSpawnOptions({ model, effort }: SpawnOptions): SpawnOptions {
  return {
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

export function createSession(
  cwd: string,
  callerSessionId?: string,
  options: SpawnOptions = {},
): Promise<CreateSessionResponse> {
  const body: CreateSessionRequest = {
    cwd,
    ...(callerSessionId === undefined ? {} : { callerSessionId }),
    ...definedSpawnOptions(options),
  };
  return request('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function resumeSession(
  id: string,
  options: SpawnOptions = {},
): Promise<CreateSessionResponse> {
  const body: ResumeSessionRequest = definedSpawnOptions(options);
  return request(`/sessions/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function killSession(id: string): Promise<OkResponse> {
  return request(`/sessions/${encodeURIComponent(id)}/kill`, { method: 'POST' });
}

export function placeSession(id: string, placement: Placement): Promise<OkResponse> {
  const body: PlacementRequest = { placement };
  return request(`/sessions/${encodeURIComponent(id)}/placement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** `kinds` and the check names are passed through as typed by the user; the server validates them. */
export function watch(
  sessionId: string,
  body: {
    pr: number;
    repo?: string;
    kinds?: readonly string[];
    ignoreChecks?: readonly string[];
    unignoreChecks?: readonly string[];
  },
): Promise<WatchResponse> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/watches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function unwatch(
  sessionId: string,
  target: { pr: number; repo?: string },
): Promise<OkResponse> {
  const params = new URLSearchParams({ pr: String(target.pr) });
  if (target.repo !== undefined) params.set('repo', target.repo);
  return request(`/sessions/${encodeURIComponent(sessionId)}/watches?${params.toString()}`, {
    method: 'DELETE',
  });
}

export function watches(sessionId: string): Promise<WatchesResponse> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/watches`);
}

export function digest(id: string): Promise<DigestResponse> {
  return request(`/digests/${encodeURIComponent(id)}`);
}
