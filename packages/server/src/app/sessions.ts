import { randomUUID } from 'node:crypto';
import { deriveTmuxName } from '../domain/tmuxName.js';
import type { TmuxPort } from './ports.js';
import type { Projection } from './projection.js';

export interface CreateSessionRequest {
  readonly cwd: string;
}

export interface CreateSessionResult {
  readonly id: string;
  readonly tmuxName: string;
}

/** The pieces `main.ts` binds once: the tmux target, the local server's own port, and
 *  the settings file every spawned Claude Code process is told to load. */
export interface SessionsDeps {
  readonly tmux: TmuxPort;
  readonly projection: Projection;
  readonly serverPort: number;
  readonly settingsPath: string;
}

/**
 * Mints a session id, derives a tmux name unique against every session the
 * projection already knows about, and starts tmux running Claude Code before the
 * session is registered — a tmux failure must never produce a session with no
 * process behind it.
 */
export async function createSession(
  deps: SessionsDeps,
  request: CreateSessionRequest,
): Promise<CreateSessionResult> {
  const { tmux, projection, serverPort, settingsPath } = deps;
  const takenNames = projection
    .sessions()
    .map((session) => session.tmuxName)
    .filter((name): name is string => name !== null);
  const id = randomUUID();
  const tmuxName = deriveTmuxName(request.cwd, takenNames);

  await tmux.newSession({
    name: tmuxName,
    cwd: request.cwd,
    port: serverPort,
    command: ['claude', '--session-id', id, '--settings', settingsPath],
  });

  projection.dispatch({ type: 'session-registered', id, tmuxName, cwd: request.cwd });
  return { id, tmuxName };
}
