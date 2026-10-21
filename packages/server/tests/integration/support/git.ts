import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function runGit(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd });
}

/** Initialises `dir` as a repo on `main` with one commit. */
export function initRepo(dir: string): void {
  runGit(dir, ['init', '--initial-branch=main']);
  runGit(dir, ['config', 'user.email', 'garden-test@example.com']);
  runGit(dir, ['config', 'user.name', 'garden test']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  runGit(dir, ['add', 'README.md']);
  runGit(dir, ['commit', '-m', 'initial commit']);
}
