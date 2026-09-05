import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitStatusEntry {
  readonly path: string;
  readonly status: string;
}

/** The git binary exited non-zero. app/ decides what that means for a use case. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed: ${stderr.trim() || '(no stderr)'}`);
    this.name = 'GitError';
  }
}

async function run(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout;
  } catch (error) {
    throw new GitError(args, (error as { stderr?: string }).stderr ?? '');
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

export async function branch(cwd: string): Promise<string> {
  const stdout = await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

const RENAME_SEPARATOR = ' -> ';

/** One entry per changed path, in `git status --porcelain` order. */
export async function status(cwd: string): Promise<GitStatusEntry[]> {
  const stdout = await run(cwd, ['status', '--porcelain']);
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const code = line.slice(0, 2);
      const rest = line.slice(3);
      const arrowIndex = rest.indexOf(RENAME_SEPARATOR);
      const path = arrowIndex === -1 ? rest : rest.slice(arrowIndex + RENAME_SEPARATOR.length);
      return { path, status: code };
    });
}
