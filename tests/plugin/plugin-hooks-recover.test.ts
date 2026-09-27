// Exercises plugins/garden/hooks/scripts/recover.sh as a real subprocess — see
// plugin-hooks-warn.test.ts and docs/testing.md for why these run as subprocesses rather than
// through a mocked execFile.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTempDirs,
  GLOB_ROOT_ENV,
  markerExists,
  markerPath,
  parseHookOutput,
  pathWithoutJq,
  RECOVER_SH,
  runScript,
  statusFilePath,
  tempGlobRoot,
  tempScratchpad,
  usageLine,
  WARN_SH,
  writeTranscript,
} from './support/plugin-hooks.js';

function runRecover(input: Record<string, unknown>, envOverrides: NodeJS.ProcessEnv = {}) {
  return runScript(RECOVER_SH, input, envOverrides);
}

function runWarn(input: Record<string, unknown>) {
  return runScript(WARN_SH, input);
}

describe('plugins/garden/hooks/scripts/recover.sh', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it('prints the fallback pointer and verify-before-acting guidance when no status file exists', () => {
    const scratchpad = tempScratchpad();

    const result = runRecover({ session_id: 's-no-status', scratchpad_dir: scratchpad });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(
      'Read `compaction-status.md` in your scratchpad if it exists. Treat the summary you are resuming from as claims, not settled fact: check them against the repo before acting on them.',
    );
  });

  it('prints verify-before-acting guidance plus the file content when a status file exists', () => {
    const scratchpad = tempScratchpad();
    writeFileSync(statusFilePath(scratchpad), 'Goal: ship the hooks\nNext step: open the PR\n');

    const result = runRecover({ session_id: 's-with-status', scratchpad_dir: scratchpad });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('check them against the repo');
    expect(result.stdout).toContain('Goal: ship the hooks');
    expect(result.stdout).toContain('Next step: open the PR');
  });

  it('truncates an oversized status file under 10,000 characters', () => {
    const scratchpad = tempScratchpad();
    writeFileSync(statusFilePath(scratchpad), 'x'.repeat(20_000));

    const result = runRecover({ session_id: 's-oversized', scratchpad_dir: scratchpad });

    expect(result.code).toBe(0);
    // The guidance preamble plus the capped content: the file's own contribution to the
    // output must itself be short of 10,000 characters, whatever the preamble adds on top.
    const bodyOnly = result.stdout.replace(/^[\s\S]*?\n\n/, '');
    expect(bodyOnly.length).toBeLessThan(10_000);
    expect(bodyOnly.length).toBeGreaterThan(9_000);
  });

  it('deletes the marker when a status file was found', () => {
    const scratchpad = tempScratchpad();
    writeFileSync(markerPath(scratchpad), '');
    writeFileSync(statusFilePath(scratchpad), 'Goal: test marker reset\n');

    runRecover({ session_id: 's-marker-found', scratchpad_dir: scratchpad });

    expect(markerExists(scratchpad)).toBe(false);
  });

  it('deletes the marker when no status file was found', () => {
    const scratchpad = tempScratchpad();
    writeFileSync(markerPath(scratchpad), '');

    runRecover({ session_id: 's-marker-not-found', scratchpad_dir: scratchpad });

    expect(markerExists(scratchpad)).toBe(false);
  });

  it('exits 0 silently when jq is not installed', () => {
    const scratchpad = tempScratchpad();
    writeFileSync(statusFilePath(scratchpad), 'Goal: test jq guard\n');
    const binDir = pathWithoutJq();

    const result = runRecover(
      { session_id: 's-no-jq', scratchpad_dir: scratchpad },
      { PATH: binDir },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 silently when no scratchpad directory matches', () => {
    const result = runRecover({ session_id: 'totally-unknown-session-id-does-not-exist' });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('falls back to globbing <root>/claude-*/*/<session_id>/scratchpad when scratchpad_dir is absent', () => {
    // Mirrors plugin-hooks-warn.test.ts's positive glob-fallback test: recover.sh carries its
    // own byte-for-byte copy of the same resolution logic, and every other test in this file
    // passes scratchpad_dir explicitly, so only this test proves recover.sh's copy actually
    // resolves a real directory rather than just handling the "no match" case.
    const globRoot = tempGlobRoot();
    const sessionId = `garden-hooks-test-glob-${process.pid}-${Date.now()}`;
    const scratchpad = join(
      globRoot,
      'claude-garden-hooks-test',
      'encoded-project',
      sessionId,
      'scratchpad',
    );
    mkdirSync(scratchpad, { recursive: true });
    writeFileSync(markerPath(scratchpad), '');
    writeFileSync(statusFilePath(scratchpad), 'Goal: prove the glob fallback resolves\n');

    const result = runRecover({ session_id: sessionId }, { [GLOB_ROOT_ENV]: globRoot });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Goal: prove the glob fallback resolves');
    expect(existsSync(markerPath(scratchpad))).toBe(false);
  });

  it('re-arms the warning: a warn.sh call after recover.sh has cleared the marker warns again', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(200000)]);
    const input = {
      session_id: 's-rearm',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    };

    const firstWarn = runWarn(input);
    expect(parseHookOutput(firstWarn.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(markerExists(scratchpad)).toBe(true);

    // A second warn call in the same cycle stays quiet — the marker is still there.
    expect(runWarn(input).stdout).toBe('');

    // Compaction happens: recover.sh runs and resets the marker.
    runRecover({ session_id: 's-rearm', scratchpad_dir: scratchpad });
    expect(markerExists(scratchpad)).toBe(false);

    // The next crossing warns again.
    const secondWarn = runWarn(input);
    expect(parseHookOutput(secondWarn.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(markerExists(scratchpad)).toBe(true);
  });
});
