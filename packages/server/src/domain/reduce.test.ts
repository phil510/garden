import { aHarnessSignal } from './signals.fixture.js';
import type { Alert, Status, WatchSummary } from '@garden/shared';
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

const signalEvent = (
  status: Status | null,
  id = 'sid-1',
  ended: boolean | null = null,
): GardenEvent => ({
  type: 'harness-signal',
  signal: aHarnessSignal({
    sessionId: id,
    reported: status === null ? undefined : { status, reason: null },
    ended,
  }),
});

const sessionMetadata = (
  names: Record<string, string>,
  nativeTitles: Record<string, string> = {},
): GardenEvent => ({
  type: 'session-metadata-loaded',
  names,
  nativeTitles,
});

const aWatchSummary = (overrides: Partial<WatchSummary> = {}): WatchSummary => ({
  repo: 'acme/widgets',
  pr: 7,
  kinds: ['review', 'closed'],
  pendingDigest: false,
  ignoredChecks: [],
  status: 'active',
  ...overrides,
});

const watchesChanged = (watches: WatchSummary[], sessionId = 'sid-1'): GardenEvent => ({
  type: 'watches-changed',
  sessionId,
  watches,
});

const anAlert = (overrides: Partial<Alert> = {}): Alert => ({
  text: 'needs a look',
  raisedAt: now,
  updatedAt: now,
  ...overrides,
});

const alertChanged = (alert: Alert | null, sessionId = 'sid-1'): GardenEvent => ({
  type: 'alert-changed',
  sessionId,
  alert,
});

describe('reduce', () => {
  it('keeps the newest prompt as a fallback while a native title and handle stay independent', () => {
    const metadata = sessionMetadata({ 'sid-1': 'garden-7a' }, { 'sid-1': 'Native title' });
    const state = fold([
      metadata,
      transcript({ title: null, lastPrompt: 'first prompt' }),
      transcript({ title: null, lastPrompt: 'ok' }),
      transcript({ title: null, lastPrompt: null }),
    ]);
    expect(state.sessions['sid-1']).toMatchObject({
      title: 'Native title',
      sessionName: 'garden-7a',
    });
    const cleared = reduce(state, sessionMetadata({ 'sid-1': 'garden-7a' }));
    expect(cleared.sessions['sid-1']).toMatchObject({ title: 'ok', sessionName: 'garden-7a' });
  });

  it('clears both title sources when a binding changes while keeping the same handle', () => {
    const state = fold([
      transcript(),
      sessionMetadata({ 'sid-1': 'garden-7a' }, { 'sid-1': 'Previous native title' }),
      {
        type: 'harness-signal',
        signal: aHarnessSignal({ sessionId: 'sid-1', resetConversation: true }),
      },
    ]);
    expect(state.sessions['sid-1']).toMatchObject({ title: null, sessionName: 'garden-7a' });
    const next = reduce(state, transcript({ title: null, lastPrompt: 'new conversation' }));
    expect(next.sessions['sid-1']?.title).toBe('new conversation');
  });

  it('creates a session from a hook alone, under the hook id and with the hook cwd', () => {
    const state = fold([signalEvent('working', 'sid-9')]);
    expect(state.sessions['sid-9']).toMatchObject({ id: 'sid-9', cwd: '/Users/dev/repo' });
  });

  it('keeps the status of a hook that arrived before the tmux snapshot confirmed the pane', () => {
    const state = fold([
      mapped,
      transcript(),
      resolvedBranch('/Users/dev/repo', 'main'),
      signalEvent('working'),
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
      type: 'harness-signal',
      signal: aHarnessSignal({
        sessionId: 'sid-1',
        reported: { status: 'waiting', reason: 'Claude needs your permission to run rm' },
      }),
    };
    expect(fold([mapped, notification, snapshot(false)]).sessions['sid-1']).toMatchObject({
      status: 'waiting',
      statusReason: 'Claude needs your permission to run rm',
    });
  });

  it('reports dead and drops the status when a hook says working after the pane died', () => {
    const state = fold([mapped, transcript(), snapshot(true), signalEvent('working')]);
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
      type: 'harness-signal',
      signal: aHarnessSignal({ sessionId: 'sid-1', reported: { status: 'waiting', reason: null } }),
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

  describe('transcripts-replayed', () => {
    const replayed = (records: TranscriptRecord[]): GardenEvent => ({
      type: 'transcripts-replayed',
      records,
    });
    const rec = (o: Partial<TranscriptRecord> = {}): TranscriptRecord => ({
      sessionId: 'sid-1',
      cwd: '/Users/dev/repo',
      title: 'Wire up the fold',
      lastPrompt: null,
      recap: null,
      lastActivity: now,
      ...o,
    });

    it('returns the same state for an empty batch', () => {
      const state = fold([mapped]);
      expect(reduce(state, replayed([]))).toBe(state);
    });

    it('returns the same state when no record names a session', () => {
      const state = fold([mapped]);
      expect(reduce(state, replayed([rec({ sessionId: null })]))).toBe(state);
    });

    it('skips a record with no session id and still folds the rest', () => {
      const state = reduce(initialState, replayed([rec({ sessionId: null }), rec()]));
      expect(Object.keys(state.sessions)).toEqual(['sid-1']);
    });

    it('resolves two records for one session the way two events in the same order would', () => {
      const first = rec({ title: 'First', recap: 'Early recap', lastActivity: now + 5 });
      const second = rec({ title: 'Second', recap: null, lastActivity: now });
      expect(reduce(initialState, replayed([first, second])).sessions['sid-1']).toMatchObject({
        title: 'Second',
        recap: 'Early recap',
        lastActivity: now + 5,
      });
    });
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
    const ended = [mapped, snapshot(false), signalEvent(null, 'sid-1', true)];
    expect(fold(ended).sessions['sid-1']?.liveness).toBe('dead');
    expect(
      fold([...ended, signalEvent('waiting', 'sid-1', false)]).sessions['sid-1'],
    ).toMatchObject({
      liveness: 'live',
      status: 'waiting',
    });
  });

  it('leaves a resumed session waiting until a prompt is submitted', () => {
    const resumed = [mapped, snapshot(false), signalEvent('waiting', 'sid-1', false)];
    expect(fold(resumed).sessions['sid-1']).toMatchObject({
      liveness: 'live',
      status: 'waiting',
    });
    expect(fold([...resumed, signalEvent('working')]).sessions['sid-1']?.status).toBe('working');
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
    const ended = [mapped, snapshot(false), signalEvent(null, 'sid-1', true)];
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
    const keyed = (status: Status | null, ended: boolean | null = null): GardenEvent =>
      signalEvent(status, 'sid-1', ended);

    it('keeps the session live across /clear, though every payload id after it is new', () => {
      const state = fold([
        mapped,
        snapshot(false),
        keyed('waiting', false),
        keyed(null, true),
        keyed('waiting', false),
        keyed('working'),
      ]);

      expect(state.sessions['sid-1']).toMatchObject({ liveness: 'live', status: 'working' });
      expect(Object.keys(state.sessions)).toEqual(['sid-1']);
    });

    it('keys on the payload session id when the header is absent', () => {
      expect(Object.keys(fold([signalEvent('waiting', 'claude-x')]).sessions)).toEqual([
        'claude-x',
      ]);
    });
  });

  it('leaves a session at needs-approval when the delayed permission_prompt notification arrives', () => {
    const permissionRequest: GardenEvent = {
      type: 'harness-signal',
      signal: aHarnessSignal({
        sessionId: 'sid-1',
        reported: { status: 'needs-approval', reason: null },
      }),
    };
    const notification: GardenEvent = {
      type: 'harness-signal',
      signal: aHarnessSignal({
        sessionId: 'sid-1',
        reported: { status: 'needs-approval', reason: 'Claude needs your permission to run rm' },
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
    const state = fold([transcript(), sessionMetadata({ 'sid-1': 'garden-7a' })]);
    expect(state.sessions['sid-1']?.sessionName).toBe('garden-7a');
  });

  it('leaves a session the registry snapshot does not name at null', () => {
    const state = fold([
      transcript(),
      transcript({ sessionId: 'sid-2' }),
      sessionMetadata({ 'sid-1': 'garden-7a' }),
    ]);
    expect(state.sessions['sid-2']?.sessionName).toBeNull();
  });

  it('reverts to null when a name present in one snapshot is absent from the next', () => {
    const state = fold([
      transcript(),
      sessionMetadata({ 'sid-1': 'garden-7a' }),
      sessionMetadata({}),
    ]);
    expect(state.sessions['sid-1']?.sessionName).toBeNull();
  });

  it('lands a Claude-side name that arrived before the session was otherwise known', () => {
    const state = fold([sessionMetadata({ 'sid-1': 'garden-7a' }), transcript()]);
    expect(state.sessions['sid-1']?.sessionName).toBe('garden-7a');
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

  describe('alerts', () => {
    const registered: GardenEvent = {
      type: 'session-registered',
      id: 'sid-1',
      tmuxName: 'repo',
      cwd: '/Users/dev/repo',
    };

    it('shows a session its alert and clears it on null', () => {
      const alert = anAlert();
      const raised = fold([mapped, transcript(), alertChanged(alert)]);
      expect(raised.sessions['sid-1']?.alert).toEqual(alert);
      expect(reduce(raised, alertChanged(null)).sessions['sid-1']?.alert).toBeNull();
    });

    it('leaves status untouched by raising and clearing', () => {
      const before = fold([mapped, transcript(), signalEvent('working'), snapshot(false)]);
      const raised = reduce(before, alertChanged(anAlert()));
      const cleared = reduce(raised, alertChanged(null));
      expect(raised.sessions['sid-1']?.status).toBe('working');
      expect(cleared.sessions['sid-1']?.status).toBe('working');
    });

    it('applies an alert that arrived before its session existed once the session appears', () => {
      const alert = anAlert();
      const early = fold([alertChanged(alert)]);
      expect(early.sessions['sid-1']).toBeUndefined();
      expect(reduce(early, transcript()).sessions['sid-1']?.alert).toEqual(alert);
    });

    it('keeps the alert when the session ends, its pane dies, and it is resumed', () => {
      const alert = anAlert();
      const live = fold([mapped, transcript(), signalEvent('working'), snapshot(false)]);
      const raised = reduce(live, alertChanged(alert));
      const ended = reduce(raised, signalEvent(null, 'sid-1', true));
      expect(ended.sessions['sid-1']).toMatchObject({ liveness: 'dead', alert });
      const dead = reduce(ended, snapshot(true));
      expect(dead.sessions['sid-1']).toMatchObject({ liveness: 'dead', alert });
      const resumed = [registered, snapshot(false)].reduce(reduce, dead);
      expect(resumed.sessions['sid-1']).toMatchObject({ liveness: 'live', alert });
    });

    it("leaves other sessions' alerts alone", () => {
      const state = fold([
        transcript(),
        transcript({ sessionId: 'sid-2' }),
        alertChanged(anAlert(), 'sid-2'),
      ]);
      expect(state.sessions['sid-1']?.alert).toBeNull();
      expect(state.sessions['sid-2']?.alert).toEqual(anAlert());
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

describe('harness-neutral signals', () => {
  it('preserves the reported status and reason when the signal has no status', () => {
    const working: GardenEvent = {
      type: 'harness-signal',
      signal: {
        sessionId: 'sid-1',
        cwd: '/repo',
        transcriptPath: '/t',
        reported: { status: 'needs-approval', reason: 'Allow tool' },
        ended: null,
        conversationCleared: false,
      },
    };
    const rebound: GardenEvent = {
      type: 'harness-signal',
      signal: {
        sessionId: 'sid-1',
        cwd: '/repo',
        transcriptPath: '/new',
        ended: false,
        conversationCleared: false,
      },
    };
    const state = fold([mapped, snapshot(false), working, rebound]);
    expect(state.sessions['sid-1']).toMatchObject({
      status: 'needs-approval',
      statusReason: 'Allow tool',
    });
  });
});
