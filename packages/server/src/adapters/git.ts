import { execFile } from 'node:child_process';
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

export async function branch(cwd: string): Promise<string> {
  const stdout = await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

/**
 * One entry per changed path, in `git status --porcelain` order. The `-z` form is
 * what makes the paths usable: without it git quotes anything non-ASCII into octal
 * escapes, and a rename is one ` -> `-joined record that a path containing that
 * substring is indistinguishable from. With it, paths are raw and a rename is two
 * NUL-separated records — new path first, original second — so the original is
 * dropped by consuming it alongside its own entry. `--ignored=matching` adds a `!!`
 * entry for every ignored path, reported as a whole directory rather than each file
 * inside it once an entire directory is ignored.
 */
export async function status(cwd: string): Promise<GitStatusEntry[]> {
  const stdout = await run(cwd, ['status', '--porcelain', '-z', '--ignored=matching']);
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
