import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
