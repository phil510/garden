// Shared fixture helpers for exercising the garden plugin's compaction-status hooks
// (plugins/garden/hooks/scripts/{warn,recover}.sh) as real subprocesses — per docs/testing.md,
// execFile is never mocked, so the only way to prove these scripts' behaviour is to run them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOKS_SCRIPTS_DIR = join(REPO_ROOT, 'plugins', 'garden', 'hooks', 'scripts');

export const WARN_SH = join(HOOKS_SCRIPTS_DIR, 'warn.sh');
export const EVENTS_MONITOR_SH = join(REPO_ROOT, 'plugins', 'garden', 'monitors', 'events.sh');
export const RECOVER_SH = join(HOOKS_SCRIPTS_DIR, 'recover.sh');
export const CONTEXT_TOKENS_SH = join(
  REPO_ROOT,
  'plugins',
  'garden',
  'skills',
  'orchestrate-sessions',
  'scripts',
  'context_tokens.sh',
);

/** Tracks every temp dir a test created, so a single `cleanupTempDirs()` in `afterEach` tears
 * them all down whether the test passed or not — never left for the next run to inherit. */
const tempDirs: string[] = [];

export function tempScratchpad(): string {
  const dir = mkdtempSync(join(tmpdir(), 'garden-hooks-test-'));
  tempDirs.push(dir);
  return dir;
}

/** Env var name the scripts check to override their default `/private/tmp` glob root — see
 * plugins/garden/hooks/scripts/{warn,recover}.sh. */
export const GLOB_ROOT_ENV = 'GARDEN_HOOKS_GLOB_ROOT';

/** A hermetic stand-in for the scripts' default `/private/tmp` glob root, so the glob-fallback
 * tests don't need to write under the real system tmp root — which a non-macOS CI runner may
 * not permit. Auto-cleaned via cleanupTempDirs(). */
export function tempGlobRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'garden-hooks-test-root-'));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** One synthetic assistant transcript line carrying the given total token usage. */
export function usageLine(tokens: number): string {
  return (
    JSON.stringify({
      type: 'assistant',
      message: { usage: { input_tokens: tokens, cache_read_input_tokens: 0, output_tokens: 0 } },
    }) + '\n'
  );
}

/** The system line Claude Code appends when compaction completes; no usage line follows until
 * the model's next reply. */
export function compactBoundaryLine(): string {
  return JSON.stringify({ type: 'system', subtype: 'compact_boundary' }) + '\n';
}

/** A non-assistant filler line, for padding a transcript past a tail window. */
function fillerLine(): string {
  return JSON.stringify({ type: 'user', message: { content: 'filler' } }) + '\n';
}

export function writeTranscript(dir: string, lines: string[]): string {
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.join(''));
  return path;
}

/** `count` filler lines, for pushing an earlier line outside a small tail window. */
export function fillerLines(count: number): string[] {
  return Array.from({ length: count }, fillerLine);
}

export interface ScriptResult {
  code: number;
  stdout: string;
}

export interface WarnHookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

export function parseHookOutput(stdout: string): WarnHookOutput {
  return JSON.parse(stdout) as WarnHookOutput;
}

/** Runs a hook script directly (as Claude Code itself would, via the command string in
 * hooks.json) with the given JSON piped to stdin. `process.env` is the base — the script's own
 * `jq`/`bash`/coreutils resolve by name and need PATH — with `envOverrides` layered on top. */
export function runScript(
  scriptPath: string,
  input: Record<string, unknown>,
  envOverrides: NodeJS.ProcessEnv = {},
): ScriptResult {
  try {
    const stdout = execFileSync(scriptPath, [], {
      input: JSON.stringify(input),
      env: { ...process.env, ...envOverrides },
      encoding: 'utf8',
    });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { status: number | null; stdout?: string };
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '' };
  }
}

/** A PATH with only `bash` reachable (resolved from the real one) and nothing else — enough
 * for the `#!/usr/bin/env bash` shebang to resolve, but with `jq` unreachable regardless of
 * where this machine actually installs it. */
export function pathWithoutJq(): string {
  const binDir = mkdtempSync(join(tmpdir(), 'garden-hooks-test-bin-'));
  tempDirs.push(binDir);
  const realBash = execFileSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
  execFileSync('ln', ['-s', realBash, join(binDir, 'bash')]);
  return binDir;
}

export function markerPath(scratchpad: string): string {
  return join(scratchpad, '.compaction-warned');
}

export function statusFilePath(scratchpad: string): string {
  return join(scratchpad, 'compaction-status.md');
}

export function markerExists(scratchpad: string): boolean {
  return existsSync(markerPath(scratchpad));
}
