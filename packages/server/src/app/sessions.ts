import { randomUUID } from 'node:crypto';
import type { SessionState } from '@garden/shared';
import type { PermissionMode } from '../config.js';
import { deriveTmuxName } from '../domain/tmuxName.js';
import type { StorePort, TmuxPort } from './ports.js';
import type { Projection } from './projection.js';

export interface CreateSessionRequest {
  readonly cwd: string;
}

export interface CreateSessionResult {
  readonly id: string;
  readonly tmuxName: string;
}

export interface ResumeSessionRequest {
  readonly id: string;
}

export interface ResumeSessionResult {
  readonly id: string;
  readonly tmuxName: string;
}

export interface KillSessionRequest {
  readonly id: string;
}

/** The pieces `main.ts` binds once: the tmux target, the local server's own port, and
 *  the settings file every spawned Claude Code process is told to load.
 *
 *  `readClaudeCommand` is a function, not a value, because it must reflect a `claudeCommand`
 *  saved to `config.json` after boot without restarting garden — `main.ts` binds it to a
 *  fresh `configPort.read()` on every call, unlike `permissionMode`, which stays a boot-time
 *  snapshot. */
export interface SessionsDeps {
  readonly tmux: TmuxPort;
  readonly store: StorePort;
  readonly projection: Projection;
  readonly serverPort: number;
  readonly settingsPath: string;
  readonly readClaudeCommand: () => readonly string[];
  readonly permissionMode?: PermissionMode;
}

/** No flag by default; `'bypassPermissions'` is the only mode that adds one. */
function permissionFlags(mode: PermissionMode | undefined): readonly string[] {
  return mode === 'bypassPermissions' ? ['--permission-mode', 'bypassPermissions'] : [];
}

export class SessionNotFoundError extends Error {}

export function findSession(projection: Projection, id: string): SessionState {
  const session = projection.sessions().find((candidate) => candidate.id === id);
  if (session === undefined) throw new SessionNotFoundError(`no such session: ${id}`);
  return session;
}

/** The store's uuid-to-tmux-name map, the one fact garden cannot recompute once tmux
 *  forgets a session. A null name drops the entry rather than writing a tombstone. */
function writeTmuxName(store: StorePort, id: string, tmuxName: string | null): void {
  const base = store.read();
  const tmuxNames = { ...base.tmuxNames };
  if (tmuxName === null) delete tmuxNames[id];
  else tmuxNames[id] = tmuxName;
  store.write({ ...base, tmuxNames });
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
  const { tmux, store, projection, serverPort, settingsPath, readClaudeCommand, permissionMode } =
    deps;
  const takenNames = projection
    .sessions()
    .map((session) => session.tmuxName)
    .filter((name): name is string => name !== null);
  const id = randomUUID();
  const tmuxName = deriveTmuxName(request.cwd, takenNames);
  const claudeCommand = readClaudeCommand();

  await tmux.newSession({
    name: tmuxName,
    cwd: request.cwd,
    port: serverPort,
    command: [
      ...claudeCommand,
      '--session-id',
      id,
      ...permissionFlags(permissionMode),
      '--settings',
      settingsPath,
    ],
  });

  writeTmuxName(store, id, tmuxName);
  projection.dispatch({ type: 'session-registered', id, tmuxName, cwd: request.cwd });
  return { id, tmuxName };
}

/**
 * Resumes a dead session by whichever mechanism fits: `respawn-pane` in place when
 * tmux still holds the session (a dead pane kept by `remain-on-exit`), otherwise a
 * fresh tmux session at the recorded cwd. The session id never changes either way.
 */
export async function resumeSession(
  deps: SessionsDeps,
  request: ResumeSessionRequest,
): Promise<ResumeSessionResult> {
  const { tmux, store, projection, serverPort, settingsPath, readClaudeCommand, permissionMode } =
    deps;
  const session = findSession(projection, request.id);
  const claudeCommand = readClaudeCommand();
  const command = [
    ...claudeCommand,
    '--resume',
    request.id,
    ...permissionFlags(permissionMode),
    '--settings',
    settingsPath,
  ];
  const panes = await tmux.listPanes();
  const priorName = session.tmuxName;

  if (priorName !== null && panes.some((pane) => pane.session === priorName)) {
    await tmux.respawnPane({ name: priorName, command });
    writeTmuxName(store, request.id, priorName);
    projection.dispatch({
      type: 'session-registered',
      id: request.id,
      tmuxName: priorName,
      cwd: session.cwd,
    });
    return { id: request.id, tmuxName: priorName };
  }

  // The session being resumed may still carry its own stale name — tmux no longer
  // holds it, so it must not block reusing it.
  const takenNames = projection
    .sessions()
    .filter((s) => s.id !== request.id)
    .map((s) => s.tmuxName)
    .filter((name): name is string => name !== null);
  const tmuxName = deriveTmuxName(session.cwd, takenNames);
  await tmux.newSession({ name: tmuxName, cwd: session.cwd, port: serverPort, command });
  writeTmuxName(store, request.id, tmuxName);
  projection.dispatch({ type: 'session-registered', id: request.id, tmuxName, cwd: session.cwd });
  return { id: request.id, tmuxName };
}

/**
 * Kills the tmux session and drops the store's id-to-name mapping. Nothing here
 * special-cases the resulting dead state: the next tmux snapshot reports the session
 * gone, which `reduce` already turns into `dead` with no exit code.
 */
export async function killSession(deps: SessionsDeps, request: KillSessionRequest): Promise<void> {
  const { tmux, store, projection } = deps;
  const session = findSession(projection, request.id);
  if (session.tmuxName !== null) await tmux.killSession(session.tmuxName);
  writeTmuxName(store, request.id, null);
}
