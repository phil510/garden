import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** `major.minor` as parsed from `tmux -V`. tmux's trailing patch letter (e.g. "3.6a") and any
 *  branch prefix (e.g. "next-3.4") are not part of the comparison. */
interface TmuxVersion {
  readonly major: number;
  readonly minor: number;
}

/** Below this, `utempter_remove_record` resets SIGCHLD to SIG_DFL around its own
 *  fork-and-wait, discarding the exiting pane's SIGCHLD before `pane_dead_status`
 *  can be set (tmux/tmux#4559, fixed in 3.6). garden's one hard requirement. */
const MINIMUM_TMUX_VERSION: TmuxVersion = { major: 3, minor: 6 };

/** Null when no version can be read; the gate turns that into its own error message. */
function parseTmuxVersion(versionOutput: string): TmuxVersion | null {
  const match = /(\d+)\.(\d+)/.exec(versionOutput);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function tmuxVersionAtLeast(version: TmuxVersion, minimum: TmuxVersion): boolean {
  return (
    version.major > minimum.major ||
    (version.major === minimum.major && version.minor >= minimum.minor)
  );
}

function formatVersion(version: TmuxVersion): string {
  return `${String(version.major)}.${String(version.minor)}`;
}

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
  readonly sessionId: string;
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
    '-e',
    `GARDEN_SESSION_ID=${request.sessionId}`,
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

/**
 * Loads the conf into an already-running server, whose `-f` was read (or not) when it started.
 * Every line in the conf is a plain `set-option -g`, which replaces rather than appends, so
 * repeating this is safe. No server is a no-op: the next command that starts one reads the conf.
 * Sent without `-f`, which would start a server just to source into it.
 */
export async function applyConf(target: TmuxTarget): Promise<void> {
  const argv = ['-L', target.socket, 'source-file', target.confPath];
  try {
    await execFileAsync('tmux', argv);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (/no server running|error connecting to/i.test(stderr)) return;
    throw new TmuxError(argv, stderr, error);
  }
}

/** Throws when `tmux -V`'s output is unparseable or below garden's minimum. The pure half of
 *  the startup gate — callable from a plain string, with no process involved. */
export function assertTmuxVersion(versionOutput: string): void {
  const found = parseTmuxVersion(versionOutput);
  if (!found) {
    throw new Error(
      `garden requires tmux ${formatVersion(MINIMUM_TMUX_VERSION)} or newer — could not read a version from "${versionOutput.trim()}"`,
    );
  }
  if (!tmuxVersionAtLeast(found, MINIMUM_TMUX_VERSION)) {
    throw new Error(
      `garden requires tmux ${formatVersion(MINIMUM_TMUX_VERSION)} or newer, found ${formatVersion(found)}`,
    );
  }
}

/** Runs `tmux -V` once and throws if tmux is missing, unrunnable, or below garden's minimum
 *  version. The startup gate: called first from `main()`, before anything else touches disk
 *  or tmux. Never write a "garden: " prefix here — the caller owns that. */
export async function checkTmuxVersion(): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('tmux', ['-V']));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('tmux is not installed — install it and try again', { cause: error });
    }
    throw new Error(`could not run tmux: ${(error as Error).message}`, { cause: error });
  }
  assertTmuxVersion(stdout);
}
