import { execFile } from 'node:child_process';
import { lstat, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Every call in this file runs against a local working tree and normally finishes in
 *  milliseconds. This bounds the pathological case — a stalled network mount, an ejected
 *  volume, a lock some other process is holding — so one unresponsive `cwd` fails instead of
 *  leaving the calling `Promise` unsettled forever. */
const GIT_TIMEOUT_MS = 5_000;

export interface GitStatusEntry {
  readonly path: string;
  readonly status: string;
}

/** The git command failed. app/ decides what that means for a use case. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    cause?: unknown,
  ) {
    super(`git ${args.join(' ')} failed: ${describeFailure(stderr, cause)}`, { cause });
    this.name = 'GitError';
  }
}

/** stderr is empty when git never ran at all, or when it was killed for running past
 *  `GIT_TIMEOUT_MS` — the errno and the kill signal are the only things that say why. */
function describeFailure(stderr: string, cause: unknown): string {
  const trimmed = stderr.trim();
  if (trimmed !== '') return trimmed;
  const { code, signal } = (cause as NodeJS.ErrnoException & { signal?: string }) ?? {};
  if (signal !== undefined) return `killed after ${String(GIT_TIMEOUT_MS)}ms (${signal})`;
  return code ?? '(no stderr)';
}

async function run(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
    return stdout;
  } catch (error) {
    throw new GitError(args, (error as { stderr?: string }).stderr ?? '', error);
  }
}

/**
 * The common `.git` directory's parent, not `--show-toplevel`: inside a worktree,
 * toplevel returns the worktree's own path, which would give every worktree its
 * own sidebar group instead of folding into its repo. The common dir is shared by
 * a repo and every one of its worktrees, so this resolves both to the same root.
 */
export async function repoRoot(cwd: string): Promise<string> {
  const stdout = await run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return dirname(stdout.trim());
}

/**
 * Where `cwd` sits inside its working tree, spelled the way `status` reports paths: a
 * slash-terminated relative path, empty at the working tree root itself. This is the working
 * tree's own root and not `repoRoot`'s common-dir parent, which a linked worktree shares with
 * the repo it was created from and so does not anchor that worktree's status paths. Answering
 * with the prefix rather than the root keeps the comparison in git's basis, where neither side
 * has to be resolved to an absolute path first.
 */
export async function workTreePrefix(cwd: string): Promise<string> {
  const stdout = await run(cwd, ['rev-parse', '--show-prefix']);
  return stdout.trim();
}

/** The `origin` remote's URL, or null when the repository has no `origin`. git exits 2 for a
 *  missing remote; any other failure (not a repository, a vanished directory) is a `GitError`. */
export async function remoteUrl(cwd: string): Promise<string | null> {
  try {
    return (await run(cwd, ['remote', 'get-url', 'origin'])).trim();
  } catch (error) {
    if (error instanceof GitError && (error.cause as { code?: unknown }).code === 2) return null;
    throw error;
  }
}

const BRANCH_REF = 'ref: refs/heads/';
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * What `git rev-parse --abbrev-ref HEAD` would print, read straight from the contents of a
 * `HEAD` file; null when the file says something only git can interpret. A branch that is
 * unborn still has a name here, and one sharing its name with a tag is its bare name rather
 * than `heads/<name>` — git's disambiguation needs the ref database, which this does not have.
 * reftable repositories write `ref: refs/heads/.invalid` as a placeholder, and a symbolic ref
 * outside `refs/heads/` has no branch name to give; both are left to git.
 */
export function parseHead(contents: string): string | null {
  const line = contents.replace(/\r?\n$/, '');
  if (OBJECT_ID.test(line)) return 'HEAD';
  if (!line.startsWith(BRANCH_REF)) return null;
  const name = line.slice(BRANCH_REF.length);
  if (name === '' || name === '.invalid' || name.includes('\n')) return null;
  return name;
}

/** A cached HEAD path is rediscovered after this long, bounding how stale it can get when a
 *  symlink is retargeted or a nested `git init` changes which repository owns a cwd. Each entry
 *  adds up to half again at random so the cwds discovered together at boot don't all
 *  rediscover, and spawn, on the same tick. */
const HEAD_PATH_MAX_AGE_MS = 5 * 60_000;

/** How long a cwd outside any repository is remembered as one, so it costs one launch per window
 *  rather than one per sweep while a later `git init` is still noticed. */
const NOT_A_REPO_RETRY_MS = 30_000;

/** Fs calls have no timeout of their own, so a stalled mount would hang one forever. The
 *  stalled call itself is abandoned, not cancelled. */
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`filesystem read timed out after ${String(GIT_TIMEOUT_MS)}ms`)),
      GIT_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type HeadPath =
  | { readonly path: string; readonly expiresAt: number }
  | { readonly failure: unknown; readonly expiresAt: number };

/**
 * Resolves a cwd's branch by reading its `HEAD` file, so a steady-state call spawns no process:
 * every launch blocks the event loop for the length of the `posix_spawn`, and the branch sweep
 * makes one call per live cwd every tick. The `HEAD` path is discovered with git once per cwd
 * (git, not a walk up for `.git`, because a linked worktree or submodule keeps its own `HEAD`
 * elsewhere) and the file is read fresh every call. Whatever the file doesn't settle falls back
 * to `rev-parse --abbrev-ref HEAD`.
 */
export function createBranchReader(now: () => number = Date.now): (cwd: string) => Promise<string> {
  const headPaths = new Map<string, HeadPath>();

  const viaGit = async (cwd: string): Promise<string> =>
    (await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

  async function discover(cwd: string): Promise<string> {
    let stdout: string;
    try {
      stdout = await run(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'HEAD']);
    } catch (error) {
      // Only an answer from git itself is remembered; a launch that failed or timed out is
      // retried on the next call.
      if (
        error instanceof GitError &&
        typeof (error.cause as { code?: unknown }).code === 'number'
      ) {
        headPaths.set(cwd, { failure: error, expiresAt: now() + NOT_A_REPO_RETRY_MS });
      }
      throw error;
    }
    const path = stdout.trim();
    const jitter = Math.random() * HEAD_PATH_MAX_AGE_MS * 0.5;
    headPaths.set(cwd, { path, expiresAt: now() + HEAD_PATH_MAX_AGE_MS + jitter });
    return path;
  }

  /** null when the file needs git to interpret; throws when it can't be read. A symlinked
   *  `HEAD` is a legacy layout whose target holds the ref, so it is not read here. */
  async function readHead(path: string): Promise<string | null> {
    if ((await bounded(lstat(path))).isSymbolicLink()) return null;
    return parseHead(await bounded(readFile(path, 'utf8')));
  }

  return async (cwd) => {
    // A deleted linked worktree can leave its `.git/worktrees/<id>/HEAD` readable, so the
    // cwd itself has to be checked rather than trusting the read to fail.
    try {
      await bounded(stat(cwd));
    } catch (error) {
      headPaths.delete(cwd);
      throw new GitError(['rev-parse', '--abbrev-ref', 'HEAD'], '', error);
    }
    const cached = headPaths.get(cwd);
    if (cached !== undefined && cached.expiresAt > now()) {
      if ('failure' in cached) throw cached.failure;
      try {
        return (await readHead(cached.path)) ?? (await viaGit(cwd));
      } catch {
        headPaths.delete(cwd);
      }
    }
    const path = await discover(cwd);
    try {
      return (await readHead(path)) ?? (await viaGit(cwd));
    } catch {
      headPaths.delete(cwd);
      return viaGit(cwd);
    }
  };
}

/**
 * One entry per changed path, in `git status --porcelain` order. The `-z` form is
 * what makes the paths usable: without it git quotes anything non-ASCII into octal
 * escapes, and a rename is one ` -> `-joined record that a path containing that
 * substring is indistinguishable from. With it, paths are raw and a rename is two
 * NUL-separated records — new path first, original second — so the original is
 * dropped by consuming it alongside its own entry. `--ignored=matching` adds a `!!`
 * entry for every ignored path, reported as a whole directory rather than each file
 * inside it once an entire directory is ignored. `--no-optional-locks` keeps `status` from
 * opportunistically rewriting `.git/index`, which the filesystem watch would report back as a
 * change to refresh.
 */
export async function status(cwd: string): Promise<GitStatusEntry[]> {
  const stdout = await run(cwd, [
    '--no-optional-locks',
    'status',
    '--porcelain',
    '-z',
    '--ignored=matching',
  ]);
  const records = stdout.split('\0').filter((record) => record !== '');
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    const code = record.slice(0, 2);
    entries.push({ path: record.slice(3), status: code });
    if (code.includes('R') || code.includes('C')) i += 1;
  }
  return entries;
}
