import { randomUUID } from 'node:crypto';
import type { SessionState } from '@garden/shared';
import type { PermissionMode } from '../config.js';
import { deriveTmuxName } from '../domain/tmuxName.js';
import { SessionNotFoundError } from './errors.js';
import type { StorePort, TmuxPaneFact, TmuxPort } from './ports.js';
import type { Projection } from './projection.js';
import { handoffSession, recordSpawn, SwarmCycleError } from './swarms.js';

export { SessionNotFoundError } from './errors.js';

export interface CreateSessionRequest {
  readonly cwd: string;
  readonly callerSessionId?: string;
  /** When true and `callerSessionId` is set, the caller's placement moves to the new
   *  session instead of the new session spawning as the caller's child. */
  readonly handoff?: boolean;
}

export interface CreateSessionResult {
  readonly id: string;
  readonly tmuxName: string;
  /** Set when `callerSessionId` was forwarded but doesn't name a session garden knows
   *  about. Never sent on the wire — `http/routes/sessions.ts` turns it into a stderr
   *  warning instead. */
  readonly unknownCaller?: boolean;
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

/** Every tmux name currently in use, from the two sources that can each hold one the
 *  other doesn't: the projection's own sessions, and every live pane tmux reports —
 *  the pane list is what catches a session the projection has lost track of (a dead
 *  or never-transcribed pane still holding its name). `excludeId` drops the session
 *  being resumed, whose own stale name must not block reusing it. */
function takenTmuxNames(
  projection: Projection,
  panes: readonly TmuxPaneFact[],
  excludeId?: string,
): string[] {
  return [
    ...projection
      .sessions()
      .filter((session) => session.id !== excludeId)
      .map((session) => session.tmuxName)
      .filter((name): name is string => name !== null),
    ...panes.map((pane) => pane.session),
  ];
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

  // Checked before spawning anything: the new session's id is always fresh, so this is the
  // only computeHandoff rejection reachable from this call site (cross-swarm/cycle both
  // require the target to already have a placements entry). Catching it after the spawn
  // would leave a live, unplaced tmux session behind for every retry of an already-handed-
  // off caller.
  if (request.handoff === true && request.callerSessionId !== undefined) {
    const priorSuccessor = projection.placementOf(request.callerSessionId)?.successor;
    if (priorSuccessor !== undefined)
      throw new SwarmCycleError(`${request.callerSessionId} already has a successor`);
  }

  const panes = await tmux.listPanes();
  const takenNames = takenTmuxNames(projection, panes);
  const id = randomUUID();
  const tmuxName = deriveTmuxName(request.cwd, takenNames);
  const claudeCommand = readClaudeCommand();

  await tmux.newSession({
    name: tmuxName,
    cwd: request.cwd,
    port: serverPort,
    sessionId: id,
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

  if (request.callerSessionId === undefined) return { id, tmuxName };

  if (request.handoff === true) {
    try {
      handoffSession({ projection }, { fromId: request.callerSessionId, toId: id });
    } catch (error) {
      if (error instanceof SessionNotFoundError) return { id, tmuxName, unknownCaller: true };
      // A concurrent handoff for the same caller can land in the gap between the pre-spawn
      // guard above and this call, so a rejection reaching here (unlike an unknown caller)
      // finds tmux already running for `id`. Roll it back the same way `killSession` does,
      // rather than leaving an orphaned session the caller has no id to correlate or kill.
      await killSession(deps, { id });
      throw error;
    }
    return { id, tmuxName };
  }

  const callerTitle =
    projection.sessions().find((session) => session.id === request.callerSessionId)?.title ?? null;
  try {
    recordSpawn({ projection }, { callerId: request.callerSessionId, childId: id, callerTitle });
  } catch (error) {
    if (!(error instanceof SessionNotFoundError)) throw error;
    return { id, tmuxName, unknownCaller: true };
  }
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

  const takenNames = takenTmuxNames(projection, panes, request.id);
  const tmuxName = deriveTmuxName(session.cwd, takenNames);
  await tmux.newSession({
    name: tmuxName,
    cwd: session.cwd,
    port: serverPort,
    sessionId: session.id,
    command,
  });
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
