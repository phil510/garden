// Exercises plugins/garden/hooks/scripts/warn.sh as a real subprocess against fixture
// transcripts and a per-test temp scratchpad — see docs/testing.md: execFile is never mocked,
// so the argument-building and guard logic here can only be proven by actually running it.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTempDirs,
  compactBoundaryLine,
  fillerLines,
  GLOB_ROOT_ENV,
  markerExists,
  parseHookOutput,
  pathWithoutJq,
  runScript,
  tempGlobRoot,
  tempScratchpad,
  usageLine,
  WARN_SH,
  writeTranscript,
} from './support/plugin-hooks.js';

function runWarn(input: Record<string, unknown>, envOverrides: NodeJS.ProcessEnv = {}) {
  return runScript(WARN_SH, { hook_event_name: 'PostToolUse', ...input }, envOverrides);
}

const HOOKS_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'plugins',
  'garden',
  'hooks',
  'hooks.json',
);

/** Every event hooks.json wires to warn.sh, read from the file so an event the script's
 * allowlist rejects can't be registered without failing here. */
function warnEvents(): string[] {
  const { hooks } = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  return Object.entries(hooks)
    .filter(([, groups]) =>
      groups.some((group) => group.hooks.some((hook) => hook.command.endsWith('/warn.sh'))),
    )
    .map(([event]) => event);
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

  it('falls back to globbing <root>/claude-*/*/<session_id>/scratchpad when scratchpad_dir is absent', () => {
    // The glob fallback matches <root>/claude-*/*/<session_id>/scratchpad (root defaults to
    // /private/tmp; GLOB_ROOT_ENV points it at a hermetic dir here), so this test builds a real
    // path of that exact shape rather than using the generic temp dir the other tests pass
    // explicitly via scratchpad_dir.
    const globRoot = tempGlobRoot();
    const sessionId = `garden-hooks-test-glob-${process.pid}-${Date.now()}`;
    // The "claude-*" and "*" segments the glob expects, nested under the hermetic root.
    const scratchpad = join(
      globRoot,
      'claude-garden-hooks-test',
      'encoded-project',
      sessionId,
      'scratchpad',
    );
    mkdirSync(scratchpad, { recursive: true });
    const transcript = writeTranscript(scratchpad, [usageLine(200000)]);

    const result = runWarn(
      { session_id: sessionId, transcript_path: transcript },
      { [GLOB_ROOT_ENV]: globRoot },
    );

    expect(result.code).toBe(0);
    expect(parseHookOutput(result.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(existsSync(join(scratchpad, '.compaction-warned'))).toBe(true);
  });

  it('registers warn.sh on PostToolUse, UserPromptSubmit and Stop', () => {
    expect(warnEvents().sort()).toEqual(['PostToolUse', 'Stop', 'UserPromptSubmit']);
  });

  it.each(warnEvents())('delivers the warning on %s, echoing the event name', (event) => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(180000)]);

    const result = runWarn({
      hook_event_name: event,
      session_id: `s-event-${event}`,
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(result.code).toBe(0);
    expect(parseHookOutput(result.stdout).hookSpecificOutput.hookEventName).toBe(event);
    expect(markerExists(scratchpad)).toBe(true);
  });

  it('warns once per cycle across events', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(180000)]);
    const input = {
      session_id: 's-cross',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    };

    const first = runWarn({ ...input, hook_event_name: 'UserPromptSubmit' });
    expect(parseHookOutput(first.stdout).hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');

    expect(runWarn({ ...input, hook_event_name: 'Stop' }).stdout).toBe('');
    expect(runWarn({ ...input, hook_event_name: 'PostToolUse' }).stdout).toBe('');
  });

  it.each([undefined, 'PreCompact'])(
    'exits 0 silently and leaves the marker untouched for hook_event_name %s',
    (event) => {
      const scratchpad = tempScratchpad();
      const transcript = writeTranscript(scratchpad, [usageLine(200000)]);

      const result = runWarn({
        hook_event_name: event,
        session_id: 's-bad-event',
        transcript_path: transcript,
        scratchpad_dir: scratchpad,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
      expect(markerExists(scratchpad)).toBe(false);
    },
  );

  it('stays quiet when a compact boundary follows the last usage line', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(190000), compactBoundaryLine()]);

    const result = runWarn({
      hook_event_name: 'UserPromptSubmit',
      session_id: 's-boundary',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(markerExists(scratchpad)).toBe(false);
  });

  it('stays quiet on a boundary even when the last usage line is outside the tail window', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [
      usageLine(190000),
      ...fillerLines(200),
      compactBoundaryLine(),
    ]);

    const result = runWarn({
      session_id: 's-boundary-tail',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(result.stdout).toBe('');
    expect(markerExists(scratchpad)).toBe(false);
  });

  it('warns on a usage line past 175K that comes after a compact boundary', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [compactBoundaryLine(), usageLine(180000)]);

    const result = runWarn({
      session_id: 's-after-boundary',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(parseHookOutput(result.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(markerExists(scratchpad)).toBe(true);
  });

  it('asks the agent to record skills in the status file', () => {
    const scratchpad = tempScratchpad();
    const transcript = writeTranscript(scratchpad, [usageLine(180000)]);

    const result = runWarn({
      session_id: 's-skills',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });

    expect(parseHookOutput(result.stdout).hookSpecificOutput.additionalContext).toContain(
      'skills the user called out',
    );
  });
});
