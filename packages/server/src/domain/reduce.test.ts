import { aHookEvent } from '@garden/shared/fixtures';
import type { HookPayload, WatchSummary } from '@garden/shared';
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

const resolvedBranch = (cwd: string, branch: string | null): GardenEvent => ({
  type: 'branch-resolved',
  cwd,
  branch,
});

const hook = (name: string, id = 'sid-1', source?: HookPayload['source']): GardenEvent => ({
  type: 'hook',
  payload: aHookEvent({
    session_id: id,
    hook_event_name: name,
    ...(source !== undefined ? { source } : {}),
  }),
});

const claudeSessionNames = (names: Record<string, string>): GardenEvent => ({
  type: 'claude-session-names-loaded',
  names,
});

const aWatchSummary = (overrides: Partial<WatchSummary> = {}): WatchSummary => ({
  repo: 'acme/widgets',
  pr: 7,
  kinds: ['review', 'closed'],
  pendingDigest: false,
  status: 'active',
  ...overrides,
});

const watchesChanged = (watches: WatchSummary[], sessionId = 'sid-1'): GardenEvent => ({
  type: 'watches-changed',
  sessionId,
  watches,
});

describe('reduce', () => {
  it('creates a session from a hook alone, under the hook id and with the hook cwd', () => {
    const state = fold([hook('UserPromptSubmit', 'sid-9')]);
    expect(state.sessions['sid-9']).toMatchObject({ id: 'sid-9', cwd: '/Users/dev/repo' });
  });

  it('keeps the status of a hook that arrived before the tmux snapshot confirmed the pane', () => {
    const state = fold([
      mapped,
      transcript(),
      resolvedBranch('/Users/dev/repo', 'main'),
      hook('UserPromptSubmit'),
      snapshot(false),
    ]);
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

  it('keeps the previous cwd when a slice carries none of its own', () => {
    const state = fold([transcript({ cwd: '/Users/dev/repo' }), transcript({ cwd: null })]);
    expect(state.sessions['sid-1']?.cwd).toBe('/Users/dev/repo');
  });

  it('moves a session to its new cwd, losing the branch resolved for the old one', () => {
    const state = fold([
      transcript({ cwd: '/Users/dev/repo' }),
      resolvedBranch('/Users/dev/repo', 'main'),
      transcript({ cwd: '/Users/dev/repo/.worktrees/feat-x' }),
    ]);
    expect(state.sessions['sid-1']).toMatchObject({
      cwd: '/Users/dev/repo/.worktrees/feat-x',
      branch: null,
    });
  });

  it('takes a session branch from the resolution for its cwd', () => {
    const state = fold([transcript(), resolvedBranch('/Users/dev/repo', 'main')]);
    expect(state.sessions['sid-1']?.branch).toBe('main');
  });

  it('gives every session sharing one cwd the same resolved branch', () => {
    const second = transcript({ sessionId: 'sid-2' });
    const state = fold([transcript(), second, resolvedBranch('/Users/dev/repo', 'main')]);
    expect(state.sessions['sid-1']?.branch).toBe('main');
    expect(state.sessions['sid-2']?.branch).toBe('main');
  });

  it('reads a resolution of null the same as a cwd nothing has resolved yet, both as null', () => {
    const neverSwept = fold([transcript()]).sessions['sid-1']?.branch;
    const sweptAndFailed = fold([
      transcript(),
      resolvedBranch('/Users/dev/repo', 'main'),
      resolvedBranch('/Users/dev/repo', null),
    ]).sessions['sid-1']?.branch;
    expect(neverSwept).toBeNull();
    expect(sweptAndFailed).toBeNull();
  });

  it('holds a branch resolution for a cwd no session has yet until one appears there', () => {
    const state = fold([
      resolvedBranch('/Users/dev/repo', 'main'),
      transcript({ cwd: '/Users/dev/repo' }),
    ]);
    expect(state.sessions['sid-1']?.branch).toBe('main');
  });

  it('short-circuits a resolution that repeats the current branch for a cwd, without rederiving', () => {
    const before = fold([transcript(), resolvedBranch('/Users/dev/repo', 'main')]);
    const after = reduce(before, resolvedBranch('/Users/dev/repo', 'main'));
    expect(after).toBe(before);
  });

  it('still lands the first resolution for a cwd even when it resolves to null', () => {
    const before = fold([transcript()]);
    const after = reduce(before, resolvedBranch('/Users/dev/repo', null));
    expect(after).not.toBe(before);
    expect(after.branches['/Users/dev/repo']).toBeNull();
  });

  it('brings a session back to live when a genuine SessionStart follows SessionEnd on the same pane', () => {
    const ended = [mapped, snapshot(false), hook('SessionEnd')];
    expect(fold(ended).sessions['sid-1']?.liveness).toBe('dead');
    expect(fold([...ended, hook('SessionStart')]).sessions['sid-1']).toMatchObject({
      liveness: 'live',
      status: 'waiting',
    });
  });

  it('leaves a resumed session waiting until a prompt is submitted', () => {
    const resumed = [mapped, snapshot(false), hook('SessionStart', 'sid-1', 'resume')];
    expect(fold(resumed).sessions['sid-1']).toMatchObject({
      liveness: 'live',
      status: 'waiting',
    });
    expect(fold([...resumed, hook('UserPromptSubmit')]).sessions['sid-1']?.status).toBe('working');
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

  it('drops the tmux name on unregister but keeps the session, dead', () => {
    const state = fold([
      transcript(),
      { type: 'session-registered', id: 'sid-1', tmuxName: 'repo', cwd: '/Users/dev/repo' },
      snapshot(false),
      { type: 'session-unregistered', id: 'sid-1' },
    ]);
    expect(state.tmuxNames).not.toHaveProperty('sid-1');
    expect(state.sessions['sid-1']).toMatchObject({ tmuxName: null, liveness: 'dead' });
  });

  it('returns the same state when unregistering an id with no tmux name', () => {
    const state = fold([transcript()]);
    expect(reduce(state, { type: 'session-unregistered', id: 'sid-1' })).toBe(state);
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

  describe('a hook carrying the garden session id', () => {
    const keyed = (
      name: string,
      claudeId: string,
      source?: HookPayload['source'],
    ): GardenEvent => ({
      type: 'hook',
      payload: aHookEvent({
        session_id: claudeId,
        hook_event_name: name,
        ...(source !== undefined ? { source } : {}),
      }),
      gardenSessionId: 'sid-1',
    });

    it('keeps the session live across /clear, though every payload id after it is new', () => {
      const state = fold([
        mapped,
        snapshot(false),
        keyed('SessionStart', 'sid-1', 'startup'),
        keyed('SessionEnd', 'sid-1'),
        keyed('SessionStart', 'claude-after-clear', 'clear'),
        keyed('UserPromptSubmit', 'claude-after-clear'),
      ]);

      expect(state.sessions['sid-1']).toMatchObject({ liveness: 'live', status: 'working' });
      expect(Object.keys(state.sessions)).toEqual(['sid-1']);
    });

    it('keys on the payload session id when the header is absent', () => {
      expect(Object.keys(fold([hook('Stop', 'claude-x')]).sessions)).toEqual(['claude-x']);
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

  describe('watches', () => {
    it('shows a session its watch summaries', () => {
      const summary = aWatchSummary();
      const state = fold([mapped, transcript(), watchesChanged([summary])]);
      expect(state.sessions['sid-1']?.watches).toEqual([summary]);
    });

    it('applies a summary that arrived before its session existed once the session appears', () => {
      const summary = aWatchSummary();
      const early = fold([watchesChanged([summary])]);
      expect(early.sessions['sid-1']).toBeUndefined();
      const state = [transcript()].reduce(reduce, early);
      expect(state.sessions['sid-1']?.watches).toEqual([summary]);
    });

    it("clears a session's watches when an empty list arrives", () => {
      const state = fold([transcript(), watchesChanged([aWatchSummary()]), watchesChanged([])]);
      expect(state.sessions['sid-1']?.watches).toEqual([]);
    });

    it("leaves other sessions' watches alone", () => {
      const summary = aWatchSummary();
      const state = fold([
        transcript(),
        transcript({ sessionId: 'sid-2' }),
        watchesChanged([summary], 'sid-2'),
        watchesChanged([aWatchSummary({ pr: 9 })]),
      ]);
      expect(state.sessions['sid-2']?.watches).toEqual([summary]);
    });
  });

  describe('pipe-changed', () => {
    const pipeChanged = (connected: boolean, lastConnectedAt: number | null): GardenEvent => ({
      type: 'pipe-changed',
      sessionId: 'sid-1',
      connected,
      lastConnectedAt,
    });

    it('flips pipeConnected on connect and back on disconnect, keeping the last connection time', () => {
      const connected = fold([transcript(), pipeChanged(true, now)]);
      expect(connected.sessions['sid-1']).toMatchObject({
        pipeConnected: true,
        pipeLastConnectedAt: now,
      });
      const disconnected = reduce(connected, pipeChanged(false, now + 1));
      expect(disconnected.sessions['sid-1']).toMatchObject({
        pipeConnected: false,
        pipeLastConnectedAt: now + 1,
      });
    });

    it('applies an entry that landed before its session appeared', () => {
      const state = fold([pipeChanged(true, now), transcript()]);
      expect(state.sessions['sid-1']).toMatchObject({
        pipeConnected: true,
        pipeLastConnectedAt: now,
      });
    });

    it('reads false and null for a session with no entry', () => {
      expect(fold([transcript()]).sessions['sid-1']).toMatchObject({
        pipeConnected: false,
        pipeLastConnectedAt: null,
      });
    });
  });
});
