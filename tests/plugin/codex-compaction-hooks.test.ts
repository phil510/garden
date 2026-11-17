import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  utimesSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const session = '019aa111-1111-7111-8111-111111111111';
const second = '019aa222-2222-7222-8222-222222222222';
const script = resolve('plugins/garden-codex/hooks/compaction.mjs');
function output(text: string) {
  return JSON.parse(text) as {
    decision?: string;
    reason?: string;
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
}
let temp: string;
let root: string;
let transcript: string;
const record = (type: string, payload: unknown) =>
  JSON.stringify({ timestamp: '2026-11-16T12:00:00Z', type, payload });
const meta = (id = session, source: unknown = 'cli') =>
  record('session_meta', { id, session_id: id, source, cli_version: '0.169.0' });
const usage = (tokens: unknown) =>
  record('event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: { total_tokens: 900000 },
      last_token_usage: {
        input_tokens: 160000,
        cached_input_tokens: 140000,
        output_tokens: 15000,
        reasoning_output_tokens: 10000,
        total_tokens: tokens,
      },
      model_context_window: 1000000,
    },
    rate_limits: null,
  });
function rollout(...lines: string[]) {
  writeFileSync(transcript, `${lines.join('\n')}\n`);
}
function hook(event = 'PostToolUse', overrides: Record<string, unknown> = {}) {
  const input = {
    session_id: session,
    cwd: temp,
    transcript_path: transcript,
    hook_event_name: event,
    model: 'gpt-5.4',
    permission_mode: 'default',
    turn_id: 'turn-1',
    tool_name: 'exec_command',
    tool_input: { cmd: 'true' },
    tool_response: { output: '' },
    tool_use_id: 'tool-1',
    stop_hook_active: false,
    last_assistant_message: null,
    ...overrides,
  };
  return execFileSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp },
    timeout: 5000,
  });
}
function directory(id = session) {
  return join(root, id);
}
function marker(id = session) {
  return join(directory(id), '.compaction-warned');
}
function note(id = session) {
  return join(directory(id), 'compaction-status.md');
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'garden-codex-compaction-test-'));
  root = join(temp, `garden-codex-compaction-${process.getuid!()}`);
  transcript = join(temp, 'rollout.jsonl');
  rollout(meta(), usage(175000));
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe('Codex compaction hooks', () => {
  it('uses the last native usage total without double-counting cached or reasoning tokens', () => {
    rollout(meta(), usage(174999));
    expect(hook()).toBe('');
    rollout(meta(), usage(175000));
    const result = output(hook());
    expect(result.hookSpecificOutput).toMatchObject({ hookEventName: 'PostToolUse' });
    expect(result.hookSpecificOutput.additionalContext).toContain(note());
    expect(statSync(directory()).mode & 0o777).toBe(0o700);
    expect(statSync(note()).mode & 0o777).toBe(0o600);
    expect(hook('UserPromptSubmit')).toBe('');
    expect(hook('Stop')).toBe('');
  });

  it('blocks Stop only once and resets at compact recovery without copying the note', () => {
    expect(output(hook('Stop'))).toMatchObject({ decision: 'block' });
    expect(hook('Stop', { stop_hook_active: true })).toBe('');
    writeFileSync(note(), 'PRIVATE NOTE CONTENT');
    const recovery = output(hook('SessionStart', { source: 'compact' }));
    expect(recovery.hookSpecificOutput.additionalContext).toContain(note());
    expect(recovery.hookSpecificOutput.additionalContext).not.toContain('PRIVATE NOTE CONTENT');
    expect(recovery.hookSpecificOutput.additionalContext).toContain(
      'compaction does not imply they stopped',
    );
    expect(existsSync(marker())).toBe(false);
    rollout(
      meta(),
      usage(175000),
      record('compacted', { message: 'summary', replacement_history: [] }),
    );
    expect(hook()).toBe('');
    rollout(meta(), record('compacted', { message: 'summary' }), usage(175001));
    expect(output(hook('UserPromptSubmit')).hookSpecificOutput.hookEventName).toBe(
      'UserPromptSubmit',
    );
  });

  it('does not start a Stop-hook continuation loop when another hook is already active', () => {
    expect(hook('Stop', { stop_hook_active: true })).toBe('');
    expect(existsSync(marker())).toBe(false);
  });

  it('keeps sessions isolated and removes only the ending session', () => {
    hook();
    writeFileSync(note(), 'first');
    rollout(meta(second), usage(175000));
    hook('PostToolUse', { session_id: second });
    writeFileSync(note(second), 'second');
    expect(hook('SessionEnd')).toBe('');
    expect(existsSync(directory())).toBe(false);
    expect(readFileSync(note(second), 'utf8')).toBe('second');
    expect(existsSync(marker(second))).toBe(true);
  });

  it('recovers without a note and does not reset markers on ordinary starts', () => {
    hook();
    expect(hook('SessionStart', { source: 'resume' })).toBe('');
    expect(existsSync(marker())).toBe(true);
    expect(
      output(hook('SessionStart', { source: 'compact' })).hookSpecificOutput.additionalContext,
    ).toContain('no continuity note');
    expect(existsSync(marker())).toBe(false);
  });

  it('ignores subagent events and transcripts, mismatched metadata and invalid usage', () => {
    expect(hook('PostToolUse', { agent_id: second })).toBe('');
    expect(hook('SubagentStop')).toBe('');
    for (const lines of [
      [meta(session, { subagent: { thread_spawn: { parent_thread_id: second } } }), usage(175000)],
      [meta(second), usage(175000)],
      [meta(), usage(175000), usage('175000')],
      [meta(), usage(-1)],
      [meta(), '{broken'],
    ]) {
      rollout(...lines);
      expect(hook()).toBe('');
      expect(existsSync(marker())).toBe(false);
    }
  });

  it('tolerates unrelated malformed records and rate-limit-only updates', () => {
    rollout(
      meta(),
      '{broken',
      usage(175000),
      record('event_msg', { type: 'token_count', info: null, rate_limits: {} }),
      '{partial',
    );
    expect(output(hook()).hookSpecificOutput.additionalContext).toContain('175K');
  });

  it('rejects traversal and symlinked storage without modifying their targets', () => {
    expect(hook('SessionEnd', { session_id: '../outside' })).toBe('');
    mkdirSync(root, { mode: 0o700 });
    const outside = join(temp, 'outside');
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(join(outside, 'compaction-status.md'), 'untouched');
    symlinkSync(outside, directory());
    expect(hook()).toBe('');
    expect(hook('SessionEnd')).toBe('');
    expect(readFileSync(join(outside, 'compaction-status.md'), 'utf8')).toBe('untouched');
  });

  it('rejects symlinked root and note files and leaves unknown cleanup contents', () => {
    mkdirSync(root, { mode: 0o700 });
    mkdirSync(directory(), { mode: 0o700 });
    const outside = join(temp, 'outside.md');
    writeFileSync(outside, 'untouched');
    symlinkSync(outside, note());
    expect(hook()).toBe('');
    expect(hook('SessionEnd')).toBe('');
    expect(readFileSync(outside, 'utf8')).toBe('untouched');
    rmSync(note());
    writeFileSync(join(directory(), 'unrecognized'), 'keep');
    hook('SessionEnd');
    expect(readFileSync(join(directory(), 'unrecognized'), 'utf8')).toBe('keep');
    rmSync(root, { recursive: true });
    symlinkSync(temp, root);
    expect(hook()).toBe('');
  });

  it('prunes old owned sessions while recent hook activity protects a long-lived session', () => {
    hook();
    rollout(meta(second), usage(175000));
    hook('PostToolUse', { session_id: second });
    const old = new Date(Date.now() - 8 * 86400000);
    utimesSync(directory(), old, old);
    utimesSync(directory(second), old, old);
    hook('UserPromptSubmit');
    hook('SessionStart', { source: 'startup' });
    expect(existsSync(directory())).toBe(true);
    expect(existsSync(directory(second))).toBe(false);
  });

  it('bounds stale cleanup work and never recurses into unknown directories', () => {
    mkdirSync(root, { mode: 0o700 });
    const old = new Date(Date.now() - 8 * 86400000);
    for (let index = 0; index < 105; index++) {
      const id = `019aa333-3333-7333-8333-${String(index).padStart(12, '0')}`;
      mkdirSync(directory(id), { mode: 0o700 });
      utimesSync(directory(id), old, old);
    }
    hook('SessionStart', { source: 'startup' });
    expect(readdirSync(root).length).toBeGreaterThanOrEqual(6);
    expect(readdirSync(root).length).toBeLessThanOrEqual(7);
  });
});
