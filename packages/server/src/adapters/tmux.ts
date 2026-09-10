import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseTmuxVersion, tmuxVersionAtLeast, type TmuxVersion } from '@garden/shared';

const execFileAsync = promisify(execFile);

/** Below this, `utempter_remove_record` resets SIGCHLD to SIG_DFL around its own
 *  fork-and-wait, discarding the exiting pane's SIGCHLD before `pane_dead_status`
 *  can be set (tmux/tmux#4559, fixed in 3.6). */
const MINIMUM_RELIABLE_EXIT_STATUS_VERSION: TmuxVersion = { major: 3, minor: 6 };

/** Which tmux server to talk to. Passed in; the adapter never reads config itself. */
export interface TmuxTarget {
  readonly socket: string;
  readonly confPath: string;
}
export interface TmuxPane {
  readonly session: string;
  readonly dead: boolean;
  readonly exitCode: number | undefined;
}
export interface NewSessionRequest {
  readonly name: string;
  readonly cwd: string;
  readonly port: number;
  readonly command: readonly string[];
}
export interface RespawnRequest {
  readonly name: string;
  readonly command: readonly string[];
}

/** The tmux command failed. app/ decides what that means for a use case. */
export class TmuxError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    cause?: unknown,
  ) {
    super(`tmux ${args.join(' ')} failed: ${describeFailure(stderr, cause)}`, { cause });
    this.name = 'TmuxError';
  }
}

/** stderr is empty when tmux never ran at all — the binary missing is the common
 *  case, and its errno is the only thing that says so. */
function describeFailure(stderr: string, cause: unknown): string {
  const trimmed = stderr.trim();
  if (trimmed !== '') return trimmed;
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return code ?? '(no stderr)';
}

// -f is read only by a starting server and ignored by a running one, so passing it
// every time means whichever command starts the server loads the conf.
async function run(target: TmuxTarget, args: readonly string[]): Promise<string> {
  const argv = ['-L', target.socket, '-f', target.confPath, ...args];
  try {
    const { stdout } = await execFileAsync('tmux', argv);
    return stdout;
  } catch (error) {
    throw new TmuxError(argv, (error as { stderr?: string }).stderr ?? '', error);
  }
}

const PANE_FORMAT = '#{session_name}\t#{pane_dead}\t#{pane_dead_status}';

/** One entry per pane across every session, carrying the facts liveness derives from. */
export async function listPanes(target: TmuxTarget): Promise<TmuxPane[]> {
  let stdout: string;
  try {
    stdout = await run(target, ['list-panes', '-a', '-F', PANE_FORMAT]);
  } catch (error) {
    // No server on this socket means zero sessions, which is a fact and not a
    // failure. tmux reports this two ways depending on history: "no server
    // running" once a server that existed has exited, or "error connecting to"
    // (ENOENT on the socket path) when no server has ever started on it.
    if (error instanceof TmuxError && /no server running|error connecting to/i.test(error.stderr))
      return [];
    throw error;
  }
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [session = '', dead = '', status = ''] = line.split('\t');
      return {
        session,
        dead: dead === '1',
        // pane_dead_status is empty while the pane is alive.
        exitCode: dead === '1' && status !== '' ? Number(status) : undefined,
      };
    });
}

/**
 * Whether a live server already holds `socket` — a probe, never a target: no `-f confPath`,
 * since a probe must not trigger the "first command loads the conf" behavior `run` relies on,
 * and the conf file may not exist yet on a sandbox's first-ever run.
 *
 * A pane being present is not enough: garden's tmux servers run with `remain-on-exit on`
 * (`appdir.ts`), so a pane whose command already exited stays listed as dead rather than
 * disappearing — the same fact `listPanes` above derives `dead` from. Only a pane that is
 * actually still running counts as the socket being in use.
 */
export async function socketHasLivePanes(socket: string): Promise<boolean> {
  const argv = ['-L', socket, 'list-panes', '-a', '-F', '#{pane_dead}'];
  let stdout: string;
  try {
    stdout = (await execFileAsync('tmux', argv)).stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    // No server on this socket at all: see listPanes's identical check above.
    if (/no server running|error connecting to/i.test(stderr)) return false;
    throw new TmuxError(argv, stderr, error);
  }
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .some((line) => line !== '1');
}

export async function newSession(target: TmuxTarget, request: NewSessionRequest): Promise<void> {
  await run(target, [
    'new-session',
    '-d',
    '-s',
    request.name,
    '-c',
    request.cwd,
    '-e',
    `GARDEN_PORT=${String(request.port)}`,
    '--',
    ...request.command,
  ]);
}

/** Replaces the pane's process, reusing the tmux name and any attached client. */
export async function respawnPane(target: TmuxTarget, request: RespawnRequest): Promise<void> {
  await run(target, ['respawn-pane', '-k', '-t', request.name, '--', ...request.command]);
}

export async function killSession(target: TmuxTarget, name: string): Promise<void> {
  await run(target, ['kill-session', '-t', name]);
}

/** Sibling of `cli/preflight.ts`'s `evaluateTmuxVersion` — same parse-and-compare helper,
 *  its own threshold and severity (warn, not block). */
export function describeTmuxVersionWarning(versionOutput: string): string | null {
  const found = parseTmuxVersion(versionOutput);
  if (!found || tmuxVersionAtLeast(found, MINIMUM_RELIABLE_EXIT_STATUS_VERSION)) return null;
  return (
    `tmux ${String(found.major)}.${String(found.minor)} found, 3.6 required — ` +
    `a session's exit code may never arrive on this version`
  );
}

/** Never throws: a failure to even run `tmux -V` must not crash or block startup. The
 *  CLI's own `checkTmux` (`cli/preflight.ts`) already owns "tmux is not installed." */
export async function checkTmuxVersionWarning(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('tmux', ['-V']);
    return describeTmuxVersionWarning(stdout);
  } catch {
    return null;
  }
}
