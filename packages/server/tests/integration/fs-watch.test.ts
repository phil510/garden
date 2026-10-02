import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { status } from '../../src/adapters/git.js';
import { watchFsRoot } from '../../src/adapters/fsWatch.js';
import { until } from './support/poll.js';
import { QUIET_WINDOW_MS, settle, sleep } from './support/fsSignals.js';

function runGit(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd });
}

function initRepo(dir: string): void {
  runGit(dir, ['init', '--initial-branch=main']);
  runGit(dir, ['config', 'user.email', 'garden-test@example.com']);
  runGit(dir, ['config', 'user.name', 'garden test']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  runGit(dir, ['add', 'README.md']);
  runGit(dir, ['commit', '-m', 'initial commit']);
}

const logger = { warn: () => undefined };

describe('watchFsRoot against a real repo', () => {
  let dir: string;
  let repo: string;
  let worktree: string;
  const open: { close(): void }[] = [];

  /** A started watch with its own signal counter. */
  function watching(root: string) {
    let signals = 0;
    const handle = watchFsRoot(
      root,
      () => {
        signals += 1;
      },
      logger,
    );
    open.push(handle);
    return { handle, count: () => signals, reset: () => (signals = 0) };
  }

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-fswatch-')));
    repo = join(dir, 'repo');
    mkdirSync(repo);
    initRepo(repo);
    mkdirSync(join(repo, 'src'));
    worktree = join(dir, 'wt');
    runGit(repo, ['worktree', 'add', worktree, '-b', 'feat/wt']);
  });

  afterEach(() => {
    for (const handle of open.splice(0)) handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('signals once after a file write', async () => {
    const watch = watching(repo);
    await settle(repo, watch.count);
    watch.reset();

    writeFileSync(join(repo, 'src', 'a.ts'), 'a');
    await until(
      'a signal',
      () => Promise.resolve(watch.count()),
      (n) => n > 0,
    );
    await sleep(QUIET_WINDOW_MS);

    expect(watch.count()).toBe(1);
  });

  it('coalesces a burst of writes into one signal', async () => {
    const watch = watching(repo);
    await settle(repo, watch.count);
    watch.reset();

    for (let i = 0; i < 10; i += 1) writeFileSync(join(repo, 'src', `burst-${String(i)}.ts`), 'x');
    await until(
      'a signal',
      () => Promise.resolve(watch.count()),
      (n) => n > 0,
    );
    await sleep(QUIET_WINDOW_MS);

    expect(watch.count()).toBe(1);
  });

  it('ignores a write under .git/ that is not the index or HEAD', async () => {
    const watch = watching(repo);
    await settle(repo, watch.count);
    watch.reset();

    writeFileSync(join(repo, '.git', 'scratch'), 'x');
    await sleep(QUIET_WINDOW_MS);
    expect(watch.count()).toBe(0);

    writeFileSync(join(repo, 'control.ts'), 'x');
    await until(
      'the control write to signal',
      () => Promise.resolve(watch.count()),
      (n) => n > 0,
    );
  });

  it('signals once for a git add', async () => {
    const watch = watching(repo);
    await settle(repo, watch.count);
    watch.reset();
    writeFileSync(join(repo, 'staged.ts'), 'x');
    await until(
      'the file write to signal',
      () => Promise.resolve(watch.count()),
      (n) => n > 0,
    );
    await sleep(QUIET_WINDOW_MS);
    watch.reset();

    runGit(repo, ['add', 'staged.ts']);
    await until(
      'a signal',
      () => Promise.resolve(watch.count()),
      (n) => n > 0,
    );
    await sleep(QUIET_WINDOW_MS);

    expect(watch.count()).toBe(1);
  });

  it('stops signalling for a root whose watch was closed', async () => {
    const a = watching(repo);
    await settle(repo, a.count);
    a.handle.close();
    a.reset();
    const b = watching(worktree);
    await settle(worktree, b.count);
    b.reset();

    writeFileSync(join(repo, 'in-a.ts'), 'x');
    await sleep(QUIET_WINDOW_MS);
    expect(a.count()).toBe(0);

    writeFileSync(join(worktree, 'in-b.ts'), 'x');
    await until(
      'a signal on the new root',
      () => Promise.resolve(b.count()),
      (n) => n > 0,
    );
    await sleep(QUIET_WINDOW_MS);
    expect(b.count()).toBe(1);
    expect(a.count()).toBe(0);
  });

  it('signals for a working-file write in a worktree root', async () => {
    const watch = watching(worktree);
    await settle(worktree, watch.count);
    watch.reset();

    writeFileSync(join(worktree, 'wt-file.ts'), 'x');
    await until(
      'a signal',
      () => Promise.resolve(watch.count()),
      (n) => n > 0,
    );
    await sleep(QUIET_WINDOW_MS);

    expect(watch.count()).toBe(1);
  });

  it("does not signal for the git adapter's own status", async () => {
    writeFileSync(join(repo, 'dirty.ts'), 'x');
    runGit(repo, ['add', 'dirty.ts']);
    writeFileSync(join(repo, 'README.md'), 'changed\n');
    const watch = watching(repo);
    await settle(repo, watch.count);
    watch.reset();

    await status(repo);
    await sleep(QUIET_WINDOW_MS);
    expect(watch.count()).toBe(0);

    writeFileSync(join(repo, 'control.ts'), 'x');
    await until(
      'the control write to signal',
      () => Promise.resolve(watch.count()),
      (n) => n > 0,
    );
  });
});
