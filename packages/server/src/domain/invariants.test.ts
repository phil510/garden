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
