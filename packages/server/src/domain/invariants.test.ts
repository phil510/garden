import { applyDelta } from '@garden/shared';
import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { diff } from './diff.js';
import { initialState, reduce } from './reduce.js';
import type { GardenEvent, TranscriptRecord } from './types.js';

const now = 1_700_000_000_000;

const record = (o: Partial<TranscriptRecord> = {}): TranscriptRecord => ({
  sessionId: 'sid-1',
  cwd: '/Users/dev/repo',
  title: 'A session',
  lastPrompt: 'do the thing',
  recap: 'Done.',
  lastActivity: 1_700_000_000_000,
  ...o,
});

const transcript = (o: Partial<TranscriptRecord>, lastActivity: number): GardenEvent => ({
  type: 'transcript-changed',
  path: '/t.jsonl',
  record: record({ lastActivity, ...o }),
});

const snapshot = (paneDead: boolean): GardenEvent => ({
  type: 'tmux-snapshot',
  sessions: [{ name: 'repo', paneDead, exitCode: paneDead ? 130 : null }],
});

const storeLoaded: GardenEvent = { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' } };

const rootResolved: GardenEvent = {
  type: 'repo-root-resolved',
  cwd: '/Users/dev/repo',
  repoRoot: '/Users/dev/repo',
};

const branchResolved: GardenEvent = {
  type: 'branch-resolved',
  cwd: '/Users/dev/repo',
  branch: 'main',
};

const watchesChanged: GardenEvent = {
  type: 'watches-changed',
  sessionId: 'sid-1',
  watches: [
    {
      repo: 'acme/widgets',
      pr: 7,
      kinds: ['closed'],
      pendingDigest: true,
      status: 'active',
      ignoredChecks: [],
    },
  ],
};

const alertChanged: GardenEvent = {
  type: 'alert-changed',
  sessionId: 'sid-1',
  alert: { text: 'needs a look', raisedAt: now, updatedAt: now },
};

const pipeChanged: GardenEvent = {
  type: 'pipe-changed',
  sessionId: 'sid-1',
  connected: true,
  lastConnectedAt: now,
};

const sequences: GardenEvent[][] = [
  [],
  [storeLoaded],
  [transcript({}, now)],
  [transcript({}, now), snapshot(false)],
  [
    storeLoaded,
    transcript({}, now),
    { type: 'hook', payload: aHookEvent({ session_id: 'sid-1', hook_event_name: 'Stop' }) },
    snapshot(false),
  ],
  [storeLoaded, transcript({}, now), snapshot(true)],
  [transcript({}, now), transcript({ sessionId: 'sid-2', title: 'Another' }, now)],
  [rootResolved, transcript({}, now)],
  [transcript({}, now), rootResolved],
  [branchResolved, transcript({}, now)],
  [transcript({}, now), branchResolved],
  [
    transcript({}, now),
    {
      type: 'hook',
      payload: aHookEvent({
        session_id: 'sid-1',
        hook_event_name: 'Notification',
        message: 'Claude needs your permission to run rm',
      }),
    },
  ],
  [transcript({}, now), watchesChanged],
  [watchesChanged, transcript({}, now)],
  [transcript({}, now), alertChanged],
  [alertChanged, transcript({}, now)],
  [transcript({}, now), alertChanged, { ...alertChanged, alert: null }],
  [transcript({}, now), pipeChanged],
  [pipeChanged, transcript({}, now)],
  [
    transcript({}, now),
    { type: 'hook', payload: aHookEvent({ session_id: 'sid-3' }) },
    { type: 'session-registered', id: 'sid-3', tmuxName: 'repo-2', cwd: '/Users/dev/repo' },
  ],
  [
    storeLoaded,
    transcript({}, now),
    snapshot(false),
    { type: 'session-unregistered', id: 'sid-1' },
  ],
];

describe('the delta round trip', () => {
  it('reproduces the next session map from the previous one plus its deltas', () => {
    const prev = reduce(initialState, transcript({ sessionId: 'sid-0', title: 'Existing' }, now));
    for (const events of sequences) {
      const next = events.reduce(reduce, prev);
      expect(applyDelta(prev.sessions, diff(prev, next))).toEqual(next.sessions);
    }
  });
});

const boot: GardenEvent[] = [
  storeLoaded,
  snapshot(false),
  transcript({}, now),
  transcript({ sessionId: 'sid-2', title: 'Another' }, now),
  rootResolved,
  branchResolved,
  watchesChanged,
  alertChanged,
  pipeChanged,
];

describe('boot replay equals steady state', () => {
  it('does not depend on whether the tmux snapshot or the transcripts arrive first', () => {
    const files = [transcript({}, now), transcript({ sessionId: 'sid-2', title: 'Another' }, now)];
    const snapshotFirst = [storeLoaded, snapshot(false), ...files].reduce(reduce, initialState);
    const transcriptsFirst = [storeLoaded, ...files, snapshot(false)].reduce(reduce, initialState);
    expect(transcriptsFirst).toEqual(snapshotFirst);
  });

  it('does not depend on whether a status-bearing hook or the tmux snapshot arrives first', () => {
    const prompt: GardenEvent = {
      type: 'hook',
      payload: aHookEvent({ session_id: 'sid-1', hook_event_name: 'UserPromptSubmit' }),
    };
    const hookFirst = [storeLoaded, prompt, snapshot(false)].reduce(reduce, initialState);
    const snapshotFirst = [storeLoaded, snapshot(false), prompt].reduce(reduce, initialState);
    expect(hookFirst).toEqual(snapshotFirst);
    expect(hookFirst.sessions['sid-1']).toMatchObject({ liveness: 'live', status: 'working' });
  });

  it('does not depend on whether the watch summaries or the transcript arrive first', () => {
    const watchesFirst = [storeLoaded, watchesChanged, transcript({}, now)].reduce(
      reduce,
      initialState,
    );
    const transcriptFirst = [storeLoaded, transcript({}, now), watchesChanged].reduce(
      reduce,
      initialState,
    );
    expect(watchesFirst).toEqual(transcriptFirst);
    expect(watchesFirst.sessions['sid-1']?.watches).toHaveLength(1);
  });

  it('does not depend on whether the alert or the transcript arrives first', () => {
    const alertFirst = [storeLoaded, alertChanged, transcript({}, now)].reduce(
      reduce,
      initialState,
    );
    const transcriptFirst = [storeLoaded, transcript({}, now), alertChanged].reduce(
      reduce,
      initialState,
    );
    expect(alertFirst).toEqual(transcriptFirst);
    expect(alertFirst.sessions['sid-1']?.alert).not.toBeNull();
  });

  it('folds a batched transcript replay to the same state as one transcript-changed per file', () => {
    const files = [
      transcript({}, now),
      transcript({ sessionId: 'sid-2', title: 'Another' }, now),
      transcript({ title: 'Renamed', recap: null }, now + 1),
    ];
    const batch: GardenEvent = {
      type: 'transcripts-replayed',
      records: files.flatMap((file) => (file.type === 'transcript-changed' ? [file.record] : [])),
    };
    const perFile = [storeLoaded, snapshot(false), ...files].reduce(reduce, initialState);
    const batched = [storeLoaded, snapshot(false), batch].reduce(reduce, initialState);
    expect(batched).toEqual(perFile);
  });

  it('is a no-op when the same boot batch is replayed onto the state it produced', () => {
    const booted = boot.reduce(reduce, initialState);
    const replayed = boot.reduce(reduce, booted);
    expect(diff(booted, replayed)).toEqual([]);
    expect(replayed).toEqual(booted);
  });
});

// Keyed by variant so a new event type fails to compile until it has a row here.
const everyVariant: Record<GardenEvent['type'], GardenEvent> = {
  'store-loaded': storeLoaded,
  'session-registered': {
    type: 'session-registered',
    id: 'sid-1',
    tmuxName: 'repo',
    cwd: '/Users/dev/repo',
  },
  'session-unregistered': { type: 'session-unregistered', id: 'sid-1' },
  'transcript-changed': transcript({}, now),
  'transcripts-replayed': {
    type: 'transcripts-replayed',
    records: [record({}), record({ sessionId: 'sid-2', title: 'Another' })],
  },
  'repo-root-resolved': rootResolved,
  'branch-resolved': branchResolved,
  hook: { type: 'hook', payload: aHookEvent({ session_id: 'sid-1' }) },
  'tmux-snapshot': snapshot(false),
  'watches-changed': watchesChanged,
  'alert-changed': alertChanged,
  'pipe-changed': pipeChanged,
  'claude-session-names-loaded': {
    type: 'claude-session-names-loaded',
    names: { 'sid-1': 'garden-7a' },
  },
};

const states = {
  empty: initialState,
  'unknown session id': reduce(initialState, transcript({ sessionId: 'sid-other' }, now)),
  booted: boot.reduce(reduce, initialState),
};

describe('reduce is total', () => {
  for (const event of Object.values(everyVariant)) {
    for (const [label, state] of Object.entries(states)) {
      it(`folds ${event.type} into the ${label} state idempotently and without losing sessions`, () => {
        const once = reduce(state, event);
        expect(Object.keys(once.sessions)).toEqual(
          expect.arrayContaining(Object.keys(state.sessions)),
        );
        // With no clock in the state, re-applying an event can never move anything.
        expect(reduce(once, event)).toEqual(once);
      });
    }
  }
});
