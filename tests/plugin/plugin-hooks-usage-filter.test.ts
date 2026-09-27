// warn.sh and orchestrate-sessions/scripts/context_tokens.sh share one occupancy definition
// (plugins/garden/lib/usage-filter.jq) rather than each carrying its own copy.
// This pins that sharing: the same fixture transcript must produce the same number out of
// context_tokens.sh that it produces as warn.sh's pass/no-pass threshold decision — a filter
// that forked between the two scripts would disagree here without either one erroring.
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTempDirs,
  CONTEXT_TOKENS_SH,
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
      session_id: 's-shared-filter',
      transcript_path: transcript,
      scratchpad_dir: scratchpad,
    });
    expect(parseHookOutput(warned.stdout).hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(markerExists(scratchpad)).toBe(true);
  });
});
