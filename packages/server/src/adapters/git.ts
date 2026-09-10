import { execFile } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

/** stderr is empty when git never ran at all — the binary missing is the common
 *  case, and its errno is the only thing that says so. */
function describeFailure(stderr: string, cause: unknown): string {
  const trimmed = stderr.trim();
  if (trimmed !== '') return trimmed;
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return code ?? '(no stderr)';
}

async function run(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
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

export interface WorktreeInfo {
  readonly path: string;
  readonly name: string;
}

/**
 * The linked worktree `cwd` sits inside, or null when `cwd`'s working tree is the main
 * checkout. `--git-dir` and `--git-common-dir` resolve to the same path for the main checkout
 * and diverge for a linked worktree (whose `.git` is a file pointing at
 * `<repo>/.git/worktrees/<name>`, while `--git-common-dir` always answers with the repo's own
 * `.git`), so comparing the two — rather than comparing `cwd` to `repoRoot` — correctly
 * answers "is this a worktree" for `cwd` anywhere inside the tree, worktree root or
 * subdirectory alike. All three values come from one `rev-parse` call, resolved through git's
 * own symlink handling, so a symlinked ancestor can't desync the comparison.
 */
export async function worktree(cwd: string): Promise<WorktreeInfo | null> {
  const stdout = await run(cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
    '--show-toplevel',
  ]);
  const [gitDir, commonDir, toplevel] = stdout.trim().split('\n');
  if (gitDir === commonDir || toplevel === undefined) return null;
  return { path: toplevel, name: basename(toplevel) };
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
