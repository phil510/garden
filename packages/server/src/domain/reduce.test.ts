import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { initialState, reduce } from './reduce.js';
import type { GardenEvent, TranscriptRecord } from './types.js';

const now = 1_700_000_000_000;
const fold = (events: GardenEvent[]) => events.reduce(reduce, initialState);

const mapped: GardenEvent = { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' } };

const transcript = (o: Partial<TranscriptRecord> = {}): GardenEvent => ({
  type: 'transcript-changed',
  path: '/t.jsonl',
  record: {
    sessionId: 'sid-1',
    cwd: '/Users/dev/repo',
    gitBranch: 'main',
    title: 'Wire up the fold',
    lastPrompt: 'wire up the fold please',
    recap: 'Done.',
    lastActivity: now,
    ...o,
  },
});

const snapshot = (paneDead: boolean, name = 'repo'): GardenEvent => ({
  type: 'tmux-snapshot',
  sessions: [{ name, paneDead, exitCode: paneDead ? 1 : null }],
});

const resolvedRoot = (cwd: string, repoRoot: string): GardenEvent => ({
  type: 'repo-root-resolved',
  cwd,
  repoRoot,
});

const hook = (name: string, id = 'sid-1'): GardenEvent => ({
  type: 'hook',
  payload: aHookEvent({ session_id: id, hook_event_name: name }),
});

const claudeSessionNames = (names: Record<string, string>): GardenEvent => ({
  type: 'claude-session-names-loaded',
  names,
});

describe('reduce', () => {
  it('creates a session from a hook alone, under the hook id and with the hook cwd', () => {
    const state = fold([hook('UserPromptSubmit', 'sid-9')]);
    expect(state.sessions['sid-9']).toMatchObject({ id: 'sid-9', cwd: '/Users/dev/repo' });
  });

  it('keeps the status of a hook that arrived before the tmux snapshot confirmed the pane', () => {
    const state = fold([mapped, transcript(), hook('UserPromptSubmit'), snapshot(false)]);
    expect(state.sessions['sid-1']).toMatchObject({
      liveness: 'live',
      status: 'working',
      tmuxName: 'repo',
      title: 'Wire up the fold',
      branch: 'main',
      recap: 'Done.',
    });
  });

  it('keeps a notification reason a hook set before the tmux snapshot confirmed the pane', () => {
    const notification: GardenEvent = {
      type: 'hook',
      payload: aHookEvent({
        session_id: 'sid-1',
        hook_event_name: 'Notification',
        message: 'Claude needs your permission to run rm',
      }),
    };
    expect(fold([mapped, notification, snapshot(false)]).sessions['sid-1']).toMatchObject({
      status: 'waiting',
      statusReason: 'Claude needs your permission to run rm',
    });
  });

  it('reports dead and drops the status when a hook says working after the pane died', () => {
    const state = fold([mapped, transcript(), snapshot(true), hook('UserPromptSubmit')]);
    expect(state.sessions['sid-1']).toMatchObject({
      liveness: 'dead',
      exitCode: 1,
      status: null,
    });
  });

  it('reports a session garden never started as dead with no status', () => {
    expect(fold([transcript()]).sessions['sid-1']).toMatchObject({
      liveness: 'dead',
      status: null,
      exitCode: null,
      tmuxName: null,
    });
  });

  it('reports a mapped session dead once tmux no longer has that session', () => {
    const vanished: GardenEvent = { type: 'tmux-snapshot', sessions: [] };
    expect(fold([mapped, transcript(), snapshot(false), vanished]).sessions['sid-1']).toMatchObject(
      {
        liveness: 'dead',
        status: null,
        exitCode: null,
      },
    );
  });

  it('falls back to the last prompt when the transcript has no ai-title', () => {
    expect(fold([transcript({ title: null })]).sessions['sid-1']?.title).toBe(
      'wire up the fold please',
    );
  });

  it('leaves the recap to the transcript when a hook carries a last assistant message', () => {
    const stop: GardenEvent = {
      type: 'hook',
      payload: aHookEvent({
        session_id: 'sid-1',
        hook_event_name: 'Stop',
        last_assistant_message: 'From the hook.',
      }),
    };
    expect(
      fold([transcript({ recap: 'From the transcript.' }), stop]).sessions['sid-1']?.recap,
    ).toBe('From the transcript.');
    expect(fold([stop]).sessions['sid-1']?.recap).toBeNull();
  });

  it('takes last activity from the transcript record, not from a later file mtime', () => {
    const lastLine = now - 6 * 60 * 60 * 1000;
    expect(fold([transcript({ lastActivity: lastLine })]).sessions['sid-1']?.lastActivity).toBe(
      lastLine,
    );
  });

  it('keeps the last activity it already had when a slice carries no timestamped line', () => {
    const state = fold([transcript({ lastActivity: now }), transcript({ lastActivity: null })]);
    expect(state.sessions['sid-1']?.lastActivity).toBe(now);
  });

  it('reports no activity for a session whose only slice carries no timestamped line', () => {
    expect(fold([transcript({ lastActivity: null })]).sessions['sid-1']?.lastActivity).toBe(0);
  });

  it('ignores a transcript slice whose session id could not be read', () => {
    expect(Object.keys(fold([transcript({ sessionId: null })]).sessions)).toEqual([]);
  });

  it('clears the branch rather than keeping the previous one when a new cwd carries no branch', () => {
    const state = fold([
      transcript({ cwd: '/Users/dev/repo', gitBranch: 'main' }),
      transcript({ cwd: '/tmp/scratch', gitBranch: null }),
    ]);
    expect(state.sessions['sid-1']).toMatchObject({ cwd: '/tmp/scratch', branch: null });
  });

  it('keeps the previous cwd and branch together when a slice carries neither', () => {
    const state = fold([
      transcript({ cwd: '/Users/dev/repo', gitBranch: 'main' }),
      transcript({ cwd: null, gitBranch: null }),
    ]);
    expect(state.sessions['sid-1']).toMatchObject({ cwd: '/Users/dev/repo', branch: 'main' });
  });

  it('brings a session back to live when SessionStart follows SessionEnd on the same pane', () => {
    const ended = [mapped, snapshot(false), hook('SessionEnd')];
    expect(fold(ended).sessions['sid-1']?.liveness).toBe('dead');
    expect(fold([...ended, hook('SessionStart')]).sessions['sid-1']).toMatchObject({
      liveness: 'live',
      status: 'working',
    });
  });

  it('records a tmux name for a session created before its transcript exists', () => {
    const created: GardenEvent = {
      type: 'session-registered',
      id: 'sid-2',
      tmuxName: 'repo-2',
      cwd: '/Users/dev/repo',
    };
    expect(fold([created]).sessions['sid-2']).toMatchObject({
      tmuxName: 'repo-2',
      cwd: '/Users/dev/repo',
    });
  });

  it('reports no repo root for a session whose cwd nothing has resolved', () => {
    expect(fold([transcript()]).sessions['sid-1']?.repoRoot).toBeNull();
  });

  it('takes a session repo root from the resolution for its cwd', () => {
    const state = fold([transcript(), resolvedRoot('/Users/dev/repo', '/Users/dev/repo')]);
    expect(state.sessions['sid-1']?.repoRoot).toBe('/Users/dev/repo');
  });

  it('folds a worktree session into the root its cwd resolved to, not its own directory', () => {
    const worktree = '/Users/dev/repo/.worktrees/feat/x';
    const state = fold([transcript({ cwd: worktree }), resolvedRoot(worktree, '/Users/dev/repo')]);
    expect(state.sessions['sid-1']?.repoRoot).toBe('/Users/dev/repo');
  });

  it('gives every session in one directory that root, whichever arrived first', () => {
    const resolution = resolvedRoot('/Users/dev/repo', '/Users/dev/repo');
    const second = transcript({ sessionId: 'sid-2' });
    const before = fold([resolution, transcript(), second]);
    const after = fold([transcript(), second, resolution]);
    expect(before).toEqual(after);
    expect(before.sessions['sid-1']?.repoRoot).toBe('/Users/dev/repo');
    expect(before.sessions['sid-2']?.repoRoot).toBe('/Users/dev/repo');
  });

  it('clears the ended flag when a resumed session is registered again', () => {
    const ended = [mapped, snapshot(false), hook('SessionEnd')];
    expect(fold(ended).sessions['sid-1']?.liveness).toBe('dead');
    const resumed: GardenEvent = {
      type: 'session-registered',
      id: 'sid-1',
      tmuxName: 'repo',
      cwd: '/Users/dev/repo',
    };
    expect(fold([...ended, resumed]).sessions['sid-1']).toMatchObject({
      liveness: 'live',
      status: 'unknown',
    });
  });

  it('leaves a session at needs-approval when the delayed permission_prompt notification arrives', () => {
    const permissionRequest: GardenEvent = {
      type: 'hook',
      payload: aHookEvent({ session_id: 'sid-1', hook_event_name: 'PermissionRequest' }),
    };
    const notification: GardenEvent = {
      type: 'hook',
      payload: aHookEvent({
        session_id: 'sid-1',
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to run rm',
      }),
    };
    expect(
      fold([mapped, permissionRequest, snapshot(false), notification]).sessions['sid-1'],
    ).toMatchObject({
      status: 'needs-approval',
    });
  });

  it('holds a newly registered session dead until a tmux snapshot reports its pane', () => {
    const created: GardenEvent = {
      type: 'session-registered',
      id: 'sid-2',
      tmuxName: 'repo-2',
      cwd: '/Users/dev/repo',
    };
    expect(fold([created]).sessions['sid-2']?.liveness).toBe('dead');
    expect(fold([created, snapshot(false, 'repo-2')]).sessions['sid-2']).toMatchObject({
      liveness: 'live',
      status: 'unknown',
    });
  });

  it('picks up a Claude-side name for a session the registry snapshot names', () => {
    const state = fold([transcript(), claudeSessionNames({ 'sid-1': 'garden-7a' })]);
    expect(state.sessions['sid-1']?.claudeSessionName).toBe('garden-7a');
  });

  it('leaves a session the registry snapshot does not name at null', () => {
    const state = fold([
      transcript(),
      transcript({ sessionId: 'sid-2' }),
      claudeSessionNames({ 'sid-1': 'garden-7a' }),
    ]);
    expect(state.sessions['sid-2']?.claudeSessionName).toBeNull();
  });

  it('reverts to null when a name present in one snapshot is absent from the next', () => {
    const state = fold([
      transcript(),
      claudeSessionNames({ 'sid-1': 'garden-7a' }),
      claudeSessionNames({}),
    ]);
    expect(state.sessions['sid-1']?.claudeSessionName).toBeNull();
  });

  it('lands a Claude-side name that arrived before the session was otherwise known', () => {
    const state = fold([claudeSessionNames({ 'sid-1': 'garden-7a' }), transcript()]);
    expect(state.sessions['sid-1']?.claudeSessionName).toBe('garden-7a');
  });
});
