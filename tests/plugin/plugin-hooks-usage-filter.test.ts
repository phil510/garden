// warn.sh and orchestrate-sessions/scripts/context_tokens.sh share one occupancy definition
// (plugins/garden/lib/usage-filter.jq) rather than each carrying its own copy.
// This pins that sharing: the same fixture transcript must produce the same number out of
// context_tokens.sh that it produces as warn.sh's pass/no-pass threshold decision — a filter
// that forked between the two scripts would disagree here without either one erroring.
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTempDirs,
  compactBoundaryLine,
  CONTEXT_TOKENS_SH,
  fillerLines,
  markerExists,
  parseHookOutput,
  runScript,
  tempScratchpad,
  usageLine,
  WARN_SH,
  writeTranscript,
} from './support/plugin-hooks.js';

describe('shared occupancy definition (warn.sh vs. context_tokens.sh)', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it('report the same token count for the same transcript', () => {
    const scratchpad = tempScratchpad();
    // Earlier line would read as 20000 or as a 210000 sum; only "last line wins" gives 190000,
    // so agreement on this exact number rules out either script silently reverting to those.
    const transcript = writeTranscript(scratchpad, [usageLine(20000), usageLine(190000)]);

    const reported = execFileSync(CONTEXT_TOKENS_SH, [transcript], { encoding: 'utf8' }).trim();
    expect(reported).toBe('190000');

    const warned = runScript(WARN_SH, {
      hook_event_name: 'PostToolUse',
      session_id: 's-shared-filter',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });
    expect(parseHookOutput(warned.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(markerExists(scratchpad)).toBe(true);
  });
});

describe('usage filter compaction boundary (via context_tokens.sh)', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  function contextTokens(lines: string[]) {
    const transcript = writeTranscript(tempScratchpad(), lines);
    const result = spawnSync(CONTEXT_TOKENS_SH, [transcript], { encoding: 'utf8', stdio: 'pipe' });
    return { ...result, transcript };
  }

  function expectNoUsageYet(lines: string[]) {
    const { status, stdout, stderr, transcript } = contextTokens(lines);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain(`no assistant turns yet in ${transcript}`);
  }

  it('reports the only usage line in the transcript', () => {
    expect(contextTokens([usageLine(42000)]).stdout.trim()).toBe('42000');
  });

  it('reports no usage yet when the last usage precedes the compact boundary', () => {
    expectNoUsageYet([usageLine(190000), compactBoundaryLine()]);
  });

  it('reports the same no-usage-yet result as a transcript with no usage at all', () => {
    expectNoUsageYet(fillerLines(3));
  });

  it('reports usage recorded after the compact boundary', () => {
    expect(
      contextTokens([usageLine(190000), compactBoundaryLine(), usageLine(30000)]).stdout.trim(),
    ).toBe('30000');
  });

  it('keeps post-boundary usage when non-usage lines follow it', () => {
    const { stdout } = contextTokens([
      usageLine(190000),
      compactBoundaryLine(),
      usageLine(30000),
      ...fillerLines(3),
    ]);
    expect(stdout.trim()).toBe('30000');
  });

  it('counts only the latest of several compact boundaries', () => {
    expectNoUsageYet([
      usageLine(190000),
      compactBoundaryLine(),
      usageLine(30000),
      compactBoundaryLine(),
    ]);
  });
});
