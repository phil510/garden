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
  gitBranch: 'main',
  title: 'A session',
  lastPrompt: 'do the thing',
  recap: 'Done.',
  ...o,
});

const transcript = (o: Partial<TranscriptRecord>, at: number): GardenEvent => ({
  type: 'transcript-changed',
  path: '/t.jsonl',
  record: record(o),
  mtime: at,
  at,
});

const snapshot = (paneDead: boolean, at: number): GardenEvent => ({
  type: 'tmux-snapshot',
  sessions: [{ name: 'repo', paneDead, exitCode: paneDead ? 130 : null, attached: !paneDead }],
  at,
});

const sequences: GardenEvent[][] = [
  [],
  [{ type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' }, at: now }],
  [transcript({}, now)],
  [transcript({}, now), snapshot(false, now)],
  [
    { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' }, at: now },
    transcript({}, now),
    {
      type: 'hook',
      payload: aHookEvent({ session_id: 'sid-1', hook_event_name: 'Stop' }),
      at: now,
    },
    snapshot(false, now),
  ],
  [
    { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' }, at: now },
    transcript({}, now),
    snapshot(true, now),
  ],
  [
    transcript({}, now),
    transcript({ sessionId: 'sid-2', title: 'Another' }, now),
    { type: 'tick', at: now + 11 * 60_000 },
  ],
  [
    transcript({}, now),
    {
      type: 'hook',
      payload: aHookEvent({
        session_id: 'sid-1',
        hook_event_name: 'Notification',
        message: 'Claude needs your permission to run rm',
      }),
      at: now,
    },
  ],
  [
    transcript({}, now),
    { type: 'hook', payload: aHookEvent({ session_id: 'sid-3' }), at: now },
    {
      type: 'session-registered',
      id: 'sid-3',
      tmuxName: 'repo-2',
      cwd: '/Users/dev/repo',
      at: now,
    },
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
  { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' }, at: now },
  snapshot(false, now),
  transcript({}, now),
  transcript({ sessionId: 'sid-2', title: 'Another' }, now),
];

describe('boot replay equals steady state', () => {
  it('does not depend on whether the tmux snapshot or the transcripts arrive first', () => {
    const storeLoaded: GardenEvent = {
      type: 'store-loaded',
      tmuxNames: { 'sid-1': 'repo' },
      at: now,
    };
    const files = [transcript({}, now), transcript({ sessionId: 'sid-2', title: 'Another' }, now)];
    const snapshotFirst = [storeLoaded, snapshot(false, now), ...files].reduce(
      reduce,
      initialState,
    );
    const transcriptsFirst = [storeLoaded, ...files, snapshot(false, now)].reduce(
      reduce,
      initialState,
    );
    expect(transcriptsFirst).toEqual(snapshotFirst);
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
  'store-loaded': { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' }, at: now },
  'session-registered': {
    type: 'session-registered',
    id: 'sid-1',
    tmuxName: 'repo',
    cwd: '/Users/dev/repo',
    at: now,
  },
  'transcript-changed': transcript({}, now),
  hook: { type: 'hook', payload: aHookEvent({ session_id: 'sid-1' }), at: now },
  'tmux-snapshot': snapshot(false, now),
  tick: { type: 'tick', at: now },
};

const aged = [
  transcript({}, now),
  { type: 'tick', at: now + 11 * 60_000 } satisfies GardenEvent,
].reduce(reduce, initialState);

const states = {
  empty: initialState,
  'unknown session id': reduce(initialState, transcript({ sessionId: 'sid-other' }, now)),
  aged,
};

describe('reduce is total', () => {
  for (const event of Object.values(everyVariant)) {
    for (const [label, state] of Object.entries(states)) {
      it(`folds ${event.type} into the ${label} state idempotently and without losing sessions`, () => {
        const once = reduce(state, event);
        expect(Object.keys(once.sessions)).toEqual(
          expect.arrayContaining(Object.keys(state.sessions)),
        );
        expect(reduce(once, event)).toEqual(once);
        // An event from before the state's clock must not move derivation time backwards.
        const stale = reduce(once, { ...event, at: now - 60 * 60_000 });
        expect(stale.lastEventAt).toBe(once.lastEventAt);
      });
    }
  }
});
