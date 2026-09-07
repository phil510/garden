import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
  FileResponse,
  OkResponse,
  ReposResponse,
  TreeResponse,
  UiStateRequest,
} from '@garden/shared';

/** The server answered with a non-2xx status, or the response body was not JSON. */
export class ApiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorResponse | null;
    throw new ApiError(body?.error ?? `garden server returned ${String(response.status)}`);
  }
  return (await response.json()) as T;
}

export function createSession(cwd: string): Promise<CreateSessionResponse> {
  return request('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd } satisfies CreateSessionRequest),
  });
}

export function resumeSession(id: string): Promise<CreateSessionResponse> {
  return request(`/sessions/${encodeURIComponent(id)}/resume`, { method: 'POST' });
}

export function killSession(id: string): Promise<OkResponse> {
  return request(`/sessions/${encodeURIComponent(id)}/kill`, { method: 'POST' });
}

export function listRepos(): Promise<ReposResponse> {
  return request('/repos');
}

export function getFileTree(sessionId: string, path: string): Promise<TreeResponse> {
  const query = new URLSearchParams({ session: sessionId, path });
  return request(`/fs/tree?${query.toString()}`);
}

export function getFile(sessionId: string, path: string): Promise<FileResponse> {
  const query = new URLSearchParams({ session: sessionId, path });
  return request(`/fs/file?${query.toString()}`);
}

export function updateUiState(patch: UiStateRequest): Promise<OkResponse> {
  return request('/ui-state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
