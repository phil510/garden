import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCodexHarness } from './codex.js';

const nativeA = '01999999-aaaa-7777-bbbb-0123456789ab';
const nativeB = '01999999-aaaa-7777-bbbb-0123456789ac';
const logger = { warn: () => {} };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'garden-codex-unit-'));
  const appDir = join(directory, 'app');
  const rollouts = join(directory, 'sessions');
  mkdirSync(rollouts);
  const options = { appDir, transcriptRoots: [rollouts], logger };
  const pathA = join(rollouts, 'rollout-a.jsonl');
  const pathB = join(rollouts, 'rollout-b.jsonl');
  const hook = (overrides = {}) => ({
    session_id: nativeA,
    transcript_path: pathA,
    cwd: directory,
    hook_event_name: 'SessionStart',
    source: 'startup',
    ...overrides,
  });
  return {
    directory,
    appDir,
    pathA,
    pathB,
    options,
    hook,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

describe('Codex lifecycle persistence', () => {
  it('persists pending before launch, rolls a failed launch back, and resumes the current bound id after clear', () => {
    const f = fixture();
    try {
      const harness = createCodexHarness(f.options);
      const rollback = harness.beforeLaunch({ id: 'failed', cwd: f.directory });
      expect(createCodexHarness(f.options).pendingSessions()).toEqual([
        { id: 'failed', cwd: f.directory },
      ]);
      rollback.rollback();
      expect(createCodexHarness(f.options).pendingSessions()).toEqual([]);
      harness.beforeLaunch({ id: 'garden', cwd: f.directory });
      expect(harness.resumeCommand({ id: 'garden', cwd: f.directory })).not.toContain('resume');
      harness.parseHook(f.hook(), 'garden');
      const cleared = harness.parseHook(
        f.hook({ session_id: nativeB, transcript_path: f.pathB, source: 'clear' }),
        'garden',
      );
      expect(cleared?.conversationCleared).toBe(true);
      const restarted = createCodexHarness(f.options);
      expect(restarted.resumeCommand({ id: 'garden', cwd: f.directory })).toEqual(
        expect.arrayContaining(['resume', nativeB]),
      );
      expect(restarted.pendingSessions()).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('rejects foreign paths, unknown garden ids and another session claiming the same native binding', () => {
    const f = fixture();
    try {
      const harness = createCodexHarness(f.options);
      harness.beforeLaunch({ id: 'garden', cwd: f.directory });
      harness.beforeLaunch({ id: 'other', cwd: f.directory });
      expect(harness.parseHook(f.hook(), 'unknown')).toBeNull();
      expect(
        harness.parseHook(f.hook({ transcript_path: '/outside/secret.jsonl' }), 'garden'),
      ).toBeNull();
      expect(
        harness.parseHook(f.hook({ transcript_path: null }), 'garden')?.transcriptPath,
      ).toBeNull();
      expect(harness.pendingSessions()).toHaveLength(2);
      harness.parseHook(f.hook(), 'garden');
      expect(harness.parseHook(f.hook(), 'other')).toBeNull();
      expect(
        harness.parseHook(
          f.hook({ session_id: nativeB, transcript_path: f.pathB, source: 'resume' }),
          'garden',
        ),
      ).toBeNull();
      expect(
        harness.parseHook(f.hook({ session_id: nativeB, hook_event_name: 'Stop' }), 'garden'),
      ).toBeNull();
    } finally {
      f.close();
    }
  });

  it('ignores older binding retries while accepting an epoch order after process or machine restart', () => {
    const f = fixture();
    try {
      const first = createCodexHarness(f.options);
      first.beforeLaunch({ id: 'garden', cwd: f.directory });
      first.parseHook(f.hook({ _garden_order: '1794787200000001' }), 'garden');
      const second = createCodexHarness(f.options);
      second.parseHook(
        f.hook({
          session_id: nativeB,
          transcript_path: f.pathB,
          source: 'clear',
          _garden_order: '1794873600000001',
        }),
        'garden',
      );
      expect(second.parseHook(f.hook({ _garden_order: '1794787200000001' }), 'garden')).toBeNull();
      expect(
        second.parseHook(
          f.hook({
            session_id: nativeB,
            transcript_path: f.pathB,
            source: 'clear',
            _garden_order: '1794873600000001',
          }),
          'garden',
        )?.conversationCleared,
      ).toBe(false);
      expect(
        createCodexHarness(f.options).resumeCommand({ id: 'garden', cwd: f.directory }),
      ).toContain(nativeB);
    } finally {
      f.close();
    }
  });
});

describe('Codex bound transcript reads', () => {
  it('reads records written before binding, lists only bound files, and invalidates reads overtaken by clear', async () => {
    const f = fixture();
    try {
      const contents = [
        JSON.stringify({ type: 'session_meta', payload: { id: nativeA, cwd: f.directory } }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'before binding' },
        }),
        ' '.repeat(140_000),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'earlier answer' },
        }),
      ].join('\n');
      writeFileSync(f.pathA, contents);
      writeFileSync(join(f.options.transcriptRoots[0]!, 'subagent.jsonl'), contents);
      let release: (() => void) | undefined;
      let reading: (() => void) | undefined;
      const entered = new Promise<void>((resolve) => {
        reading = resolve;
      });
      const harness = createCodexHarness({
        ...f.options,
        readText: async (path) => {
          const text = readFileSync(path, 'utf8');
          reading?.();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return text;
        },
      });
      harness.beforeLaunch({ id: 'garden', cwd: f.directory });
      harness.parseHook(f.hook(), 'garden');
      expect(await harness.transcripts.listFiles()).toEqual([f.pathA]);
      const read = harness.transcripts.readRecord(f.pathA);
      await entered;
      harness.parseHook(
        f.hook({ session_id: nativeB, transcript_path: f.pathB, source: 'clear' }),
        'garden',
      );
      release!();
      expect(await read).toBeNull();
      expect(harness.transcripts.accepts(f.pathA)).toBe(false);
      expect(harness.transcripts.accepts(f.pathB)).toBe(true);
      const restored = createCodexHarness(f.options);
      writeFileSync(f.pathB, contents);
      expect((await restored.transcripts.readRecord(f.pathB))?.record).toMatchObject({
        sessionId: 'garden',
        lastPrompt: 'before binding',
        recap: 'earlier answer',
      });
    } finally {
      f.close();
    }
  });
});

describe('actual generated Codex hook commands', () => {
  it('durably spools only a failed SessionStart, replays it once and keeps a failed replay retryable', async () => {
    const f = fixture();
    try {
      const harness = createCodexHarness(f.options);
      harness.beforeLaunch({ id: 'garden', cwd: f.directory });
      const args = harness.spawnCommand({ id: 'garden', cwd: f.directory });
      const overlay = args.find((arg) => arg.startsWith('hooks.SessionStart='))!;
      const command = JSON.parse(overlay.match(/command=(.*),timeout=/)![1]!) as string;
      const execute = (payload: unknown) =>
        new Promise<void>((resolve, reject) => {
          const child = execFile(
            'sh',
            ['-c', command],
            {
              env: { ...process.env, GARDEN_SESSION_ID: 'garden', GARDEN_PORT: '1' },
              timeout: 5000,
            },
            (error) => (error ? reject(new Error(error.message)) : resolve()),
          );
          child.stdin!.end(JSON.stringify(payload));
        });
      await execute(f.hook());
      const spool = join(f.appDir, 'codex-session-start-spool');
      expect(readdirSync(spool)).toHaveLength(1);
      await execute(f.hook({ hook_event_name: 'Stop' }));
      expect(readdirSync(spool)).toHaveLength(1);
      const restarted = createCodexHarness(f.options);
      expect(restarted.replaySpool()).toHaveLength(1);
      expect(readdirSync(spool)).toEqual([]);
      expect(restarted.replaySpool()).toEqual([]);
      expect(restarted.resumeCommand({ id: 'garden', cwd: f.directory })).toContain(nativeA);
      writeFileSync(join(spool, 'broken.jsonl'), '{broken');
      restarted.replaySpool();
      expect(readdirSync(spool)).toEqual(['broken.jsonl']);
    } finally {
      f.close();
    }
  });
});

describe('launch status ordering', () => {
  it('resets stale status on resume but preserves a hook observed during the new launch', () => {
    const f = fixture();
    try {
      const harness = createCodexHarness(f.options);
      const initial = harness.beforeLaunch({ id: 'garden', cwd: f.directory });
      expect(initial.registrationStatus()?.status).toBe('waiting');
      harness.parseHook(f.hook(), 'garden');
      harness.parseHook(f.hook({ hook_event_name: 'PreToolUse' }), 'garden');
      expect(
        harness.beforeLaunch({ id: 'garden', cwd: f.directory }).registrationStatus()?.status,
      ).toBe('waiting');
      const resumed = harness.beforeLaunch({ id: 'garden', cwd: f.directory });
      harness.parseHook(f.hook({ hook_event_name: 'UserPromptSubmit' }), 'garden');
      expect(resumed.registrationStatus()).toBeUndefined();
    } finally {
      f.close();
    }
  });
});
