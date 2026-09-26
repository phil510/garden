import { homedir } from 'node:os';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
  OkResponse,
  SessionsFilter,
  SessionsResponse,
} from '@garden/shared';
import { ensureConfigFile, loadConfig } from '../config.js';

/** The server did not answer, or answered with an error the client can only surface. */
export class CliHttpError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliHttpError';
  }
}

function baseUrl(): string {
  const home = homedir();
  const config = loadConfig(process.env, ensureConfigFile(home), home);
  return `http://${config.host}:${String(config.port)}`;
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
    throw new CliHttpError(body?.error ?? `garden server returned ${String(response.status)}`);
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
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function listSessions(filter?: SessionsFilter): Promise<SessionsResponse> {
  return request(`/sessions${filter === undefined ? '' : sessionsQuery(filter)}`);
}

export function createSession(
  cwd: string,
  callerSessionId?: string,
): Promise<CreateSessionResponse> {
  const body: CreateSessionRequest =
    callerSessionId === undefined ? { cwd } : { cwd, callerSessionId };
  return request('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function resumeSession(id: string): Promise<CreateSessionResponse> {
  return request(`/sessions/${encodeURIComponent(id)}/resume`, { method: 'POST' });
}

export function killSession(id: string): Promise<OkResponse> {
  return request(`/sessions/${encodeURIComponent(id)}/kill`, { method: 'POST' });
}
