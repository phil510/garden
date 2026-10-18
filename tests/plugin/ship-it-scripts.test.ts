// Exercises the ship-it pipeline scripts (plugins/garden/skills/ship-it/scripts/) as real
// subprocesses against temp git repos — see docs/testing.md for why execFile is never mocked.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTempDirs,
  PIPELINE_FINISH_SH,
  PIPELINE_INIT_SH,
  PIPELINE_STATUS_SH,
  tempScratchpad,
} from './support/plugin-hooks.js';

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], input = ''): RunResult {
  try {
    const stdout = execFileSync(script, args, {
      input,
      encoding: 'utf8',
      env: gitEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status: number | null; stdout?: string; stderr?: string };
    return {
      code: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** Git hooks export GIT_DIR/GIT_INDEX_FILE, which would point the temp repo's git calls at the real one. */
function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

function tempRepo(): string {
  const dir = tempScratchpad();
  execFileSync('git', ['init', '-q', dir], { env: gitEnv() });
  return dir;
}

function brief(reviewLoop: string): string {
  return `**Tracker:** none\n**Review loop:** ${reviewLoop}\n\n### 1. Objective\nDo the thing.\n`;
}

function init(worktree: string, branch: string, reviewLoop = 'none'): RunResult {
  return run(
    PIPELINE_INIT_SH,
    ['--worktree', worktree, '--branch', branch, '--repo', 'o/r'],
    brief(reviewLoop),
  );
}

function stateDir(worktree: string, branch: string): string {
  return join(worktree, '.ship-it', branch);
}

function status(worktree: string, branch: string) {
  const result = run(PIPELINE_STATUS_SH, ['--worktree', worktree, '--branch', branch]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as {
    review_loop: { phase: string | null; outcome: string | null };
  };
}

function finish(worktree: string, branch: string) {
  const result = run(PIPELINE_FINISH_SH, [
    '--worktree',
    worktree,
    '--branch',
    branch,
    '--status',
    'completed',
  ]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as {
    decisions_entries: number;
    lock_released: boolean;
  };
}

describe('ship-it pipeline-init.sh', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it('scaffolds workflow.md, decisions.md and the lock, and keeps the state dir out of git status', () => {
    const repo = tempRepo();

    const result = init(repo, 'feat/x');

    expect(result.code).toBe(0);
    expect(existsSync(join(stateDir(repo, 'feat/x'), 'workflow.md'))).toBe(true);
    expect(existsSync(join(stateDir(repo, 'feat/x'), 'decisions.md'))).toBe(true);
    expect(readFileSync(join(repo, '.ship-it', 'active'), 'utf8').trim()).toBe('feat/x');
    expect(readFileSync(join(repo, '.ship-it', '.gitignore'), 'utf8')).toBe('*\n');
    const porcelain = execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    expect(porcelain).toBe('');
  });

  it('exits 3 when another branch holds the lock', () => {
    const repo = tempRepo();
    init(repo, 'feat/a');

    const result = init(repo, 'feat/b');

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("branch 'feat/a'");
  });

  it('exits 2 when the branch already has a workflow.md, leaving no lock behind', () => {
    const repo = tempRepo();
    mkdirSync(stateDir(repo, 'feat/x'), { recursive: true });
    writeFileSync(join(stateDir(repo, 'feat/x'), 'workflow.md'), '# existing\n');

    const result = init(repo, 'feat/x');

    expect(result.code).toBe(2);
    expect(existsSync(join(repo, '.ship-it', 'active'))).toBe(false);
  });
});

describe('ship-it pipeline-status.sh review_loop.outcome', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  function writeLoopState(repo: string, state: Record<string, string>): void {
    writeFileSync(join(stateDir(repo, 'feat/x'), 'review-loop-state.json'), JSON.stringify(state));
  }

  it('is skipped when the brief names no loop', () => {
    const repo = tempRepo();
    init(repo, 'feat/x', 'none');

    expect(status(repo, 'feat/x').review_loop).toMatchObject({ outcome: 'skipped', phase: null });
  });

  it('is skipped when the brief field carries trailing whitespace', () => {
    const repo = tempRepo();
    init(repo, 'feat/x', 'none \t');

    expect(status(repo, 'feat/x').review_loop.outcome).toBe('skipped');
  });

  it('is pending when a loop is named and no state file exists', () => {
    const repo = tempRepo();
    init(repo, 'feat/x', 'pr-review-bot-loop');

    expect(status(repo, 'feat/x').review_loop.outcome).toBe('pending');
  });

  it('is running while the state phase is not done', () => {
    const repo = tempRepo();
    init(repo, 'feat/x', 'pr-review-bot-loop');
    writeLoopState(repo, { phase: 'triage' });

    expect(status(repo, 'feat/x').review_loop).toMatchObject({
      outcome: 'running',
      phase: 'triage',
    });
  });

  it.each(['passed', 'blocked'])('reports the state file outcome %s once done', (outcome) => {
    const repo = tempRepo();
    init(repo, 'feat/x', 'pr-review-bot-loop');
    writeLoopState(repo, { phase: 'done', outcome });

    expect(status(repo, 'feat/x').review_loop.outcome).toBe(outcome);
  });
});

describe('ship-it pipeline-status.sh JSON', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it('stays valid JSON when an annotation holds a tab or carriage return', () => {
    const repo = tempRepo();
    init(repo, 'feat/x');
    const workflow = join(stateDir(repo, 'feat/x'), 'workflow.md');
    writeFileSync(workflow, readFileSync(workflow, 'utf8') + '> NOTE a\tb\rc\n');

    const result = run(PIPELINE_STATUS_SH, ['--worktree', repo, '--branch', 'feat/x']);
    const parsed = JSON.parse(result.stdout) as { annotations: string[] };

    expect(parsed.annotations.at(-1)).toBe('> NOTE a\tb\rc');
  });
});

describe('ship-it pipeline-finish.sh', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it('counts timestamped decisions entries and is idempotent on a repeat run', () => {
    const repo = tempRepo();
    init(repo, 'feat/x');
    const decisions = join(stateDir(repo, 'feat/x'), 'decisions.md');
    writeFileSync(
      decisions,
      readFileSync(decisions, 'utf8') +
        '2026-10-18T10:00:00Z — planner: chose A.\n2026-10-18T10:05:00Z — reviewer: accepted B.\n',
    );

    const first = finish(repo, 'feat/x');
    const workflowAfterFirst = readFileSync(join(stateDir(repo, 'feat/x'), 'workflow.md'), 'utf8');
    const second = finish(repo, 'feat/x');

    expect(first.decisions_entries).toBe(2);
    expect(second.decisions_entries).toBe(2);
    expect(readFileSync(join(stateDir(repo, 'feat/x'), 'workflow.md'), 'utf8')).toBe(
      workflowAfterFirst,
    );
  });

  it('rewrites only the header Status line, not one in the brief body', () => {
    const repo = tempRepo();
    run(
      PIPELINE_INIT_SH,
      ['--worktree', repo, '--branch', 'feat/x', '--repo', 'o/r'],
      `${brief('none')}**Status:** quoted in the brief\n`,
    );

    finish(repo, 'feat/x');

    const workflow = readFileSync(join(stateDir(repo, 'feat/x'), 'workflow.md'), 'utf8');
    expect(workflow).toMatch(/^\*\*Status:\*\* completed$/m);
    expect(workflow).toContain('**Status:** quoted in the brief');
  });

  it('releases the lock only when it names this branch', () => {
    const repo = tempRepo();
    init(repo, 'feat/a');
    mkdirSync(stateDir(repo, 'feat/b'), { recursive: true });
    writeFileSync(
      join(stateDir(repo, 'feat/b'), 'workflow.md'),
      '# Workflow\n\n**Status:** active\n\n## Stages\n\n## Annotations\n',
    );

    const other = finish(repo, 'feat/b');
    expect(other.lock_released).toBe(false);
    expect(existsSync(join(repo, '.ship-it', 'active'))).toBe(true);

    const own = finish(repo, 'feat/a');
    expect(own.lock_released).toBe(true);
    expect(existsSync(join(repo, '.ship-it', 'active'))).toBe(false);
  });
});
