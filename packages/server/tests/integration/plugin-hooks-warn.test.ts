// Exercises plugins/garden/hooks/scripts/warn.sh as a real subprocess against fixture
// transcripts and a per-test temp scratchpad — see docs/testing.md: execFile is never mocked,
// so the argument-building and guard logic here can only be proven by actually running it.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTempDirs,
  fillerLines,
  markerExists,
  parseHookOutput,
  pathWithoutJq,
  runScript,
  tempScratchpad,
  usageLine,
  WARN_SH,
  writeTranscript,
} from './support/plugin-hooks.js';

function runWarn(input: Record<string, unknown>, envOverrides: NodeJS.ProcessEnv = {}) {
  return runScript(WARN_SH, input, envOverrides);
}

describe('plugins/garden/hooks/scripts/warn.sh', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it('emits nothing below 175K, and leaves the marker untouched', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(174999)]);

    const result = runWarn({
      session_id: 's-below',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(markerExists(scratchpad)).toBe(false);
  });

  it('emits the reminder once at 175K, then suppresses later calls in the same cycle', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(175000)]);
    const input = { session_id: 's-at', transcript_path: transcript, scratchpad_dir: scratchpad };

    const first = runWarn(input);
    expect(first.code).toBe(0);
    const parsed = parseHookOutput(first.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('compaction-status.md');
    expect(markerExists(scratchpad)).toBe(true);

    const second = runWarn(input);
    expect(second.code).toBe(0);
    expect(second.stdout).toBe('');
  });

  it('emits nothing and leaves the marker untouched when the input carries agent_id, even past 175K', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(200000)]);

    const result = runWarn({
      session_id: 's-subagent',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
      agent_id: 'agent-uuid-1',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(markerExists(scratchpad)).toBe(false);
  });

  it('still finds the matching line when it falls outside a naively small tail window', () => {
    const scratchpad = tempScratchpad();
    // The matching assistant usage line comes first, followed by far more filler lines than
    // any reasonable bounded tail would cover — proving the retry-against-the-whole-file
    // fallback, not just the common case where the match sits near the end.
    const transcript = writeTranscript(scratchpad, [usageLine(180000), ...fillerLines(200)]);

    const result = runWarn({
      session_id: 's-window',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(result.code).toBe(0);
    expect(parseHookOutput(result.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(markerExists(scratchpad)).toBe(true);
  });

  it('governs occupancy by the last assistant usage line, not the first', () => {
    // Early line is below threshold, later line is above it. Summing the two lines (210000)
    // or taking the first (20000) would both disagree with taking the last (190000) — this
    // is the direction that rules out "first line wins".
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(20000), usageLine(190000)]);

    const result = runWarn({
      session_id: 's-last-not-first',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(result.code).toBe(0);
    expect(parseHookOutput(result.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(markerExists(scratchpad)).toBe(true);
  });

  it('governs occupancy by the last assistant usage line, not a sum over all lines', () => {
    // Early line is above threshold, later line is below it. Summing the two lines (210000)
    // would fire; taking the first (190000) would also fire; only taking the last (20000)
    // stays quiet — this is the direction that rules out "sum of all lines".
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(190000), usageLine(20000)]);

    const result = runWarn({
      session_id: 's-last-not-sum',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(markerExists(scratchpad)).toBe(false);
  });

  it('exits 0 silently when jq is not installed', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(200000)]);
    const binDir = pathWithoutJq();

    const result = runWarn(
      { session_id: 's-no-jq', transcript_path: transcript, scratchpad_dir: scratchpad },
      { PATH: binDir },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(markerExists(scratchpad)).toBe(false);
  });

  it('exits 0 silently when the transcript is unreadable', () => {
    const scratchpad = tempScratchpad();

    const result = runWarn({
      session_id: 's-bad-transcript',
      transcript_path: join(scratchpad, 'does-not-exist.jsonl'),
      scratchpad_dir: scratchpad,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(markerExists(scratchpad)).toBe(false);
  });

  it('exits 0 silently when no scratchpad directory matches', () => {
    const transcript = writeTranscript(tempScratchpad(), [usageLine(200000)]);

    const result = runWarn({
      session_id: 'totally-unknown-session-id-does-not-exist',
      transcript_path: transcript,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('falls back to globbing /private/tmp/claude-*/*/<session_id>/scratchpad when scratchpad_dir is absent', () => {
    // The glob fallback is hardcoded to /private/tmp/claude-*/*/<session_id>/scratchpad, so
    // this test builds a real path of that exact shape rather than using the generic temp dir
    // the other tests pass explicitly via scratchpad_dir.
    const sessionId = `garden-hooks-test-glob-${process.pid}-${Date.now()}`;
    // Nested directly under /private/tmp, matching the script's literal glob shape
    // (claude-*/*/<session_id>/scratchpad) — the fixture's own top-level dir IS the "claude-*"
    // segment, so cleanup removes exactly that one directory rather than sharing /private/tmp.
    const root = join('/private/tmp', `claude-garden-hooks-test-${process.pid}-${Date.now()}`);
    const scratchpad = join(root, 'encoded-project', sessionId, 'scratchpad');
    try {
      mkdirSync(scratchpad, { recursive: true });
      const transcript = writeTranscript(scratchpad, [usageLine(200000)]);

      const result = runWarn({ session_id: sessionId, transcript_path: transcript });

      expect(result.code).toBe(0);
      expect(parseHookOutput(result.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
      expect(existsSync(join(scratchpad, '.compaction-warned'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
