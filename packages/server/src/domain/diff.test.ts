import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { diff } from './diff.js';
import { initialState } from './reduce.js';
import type { GardenState } from './types.js';

const withSessions = (...sessions: ReturnType<typeof aSession>[]): GardenState => ({
  ...initialState,
  sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
});

describe('diff', () => {
  it('emits a whole session when it first appears', () => {
    const session = aSession({ id: 'sid-1' });
    expect(diff(initialState, withSessions(session))).toEqual([{ type: 'session-added', session }]);
  });

  it('emits only the fields that changed', () => {
    const prev = withSessions(aSession({ id: 'sid-1', status: 'working' }));
    const next = withSessions(aSession({ id: 'sid-1', status: 'waiting', recap: 'Done.' }));
    expect(diff(prev, next)).toEqual([
      { type: 'session-changed', id: 'sid-1', changes: { status: 'waiting', recap: 'Done.' } },
    ]);
  });

  it('emits nothing when an equal session is rebuilt as a new object', () => {
    const prev = withSessions(aSession({ id: 'sid-1' }));
    const next = withSessions(aSession({ id: 'sid-1' }));
    expect(diff(prev, next)).toEqual([]);
  });

  it('reports every field that differs, so a field added to a session cannot be missed', () => {
    const before = aSession({ id: 'sid-1' });
    const after: typeof before = {
      ...before,
      cwd: '/Users/dev/other',
      repoRoot: '/Users/dev/other',
      branch: 'topic',
      title: 'Another session',
      recap: 'Done.',
      liveness: 'dead',
      status: 'waiting',
      statusReason: 'Needs approval',
      exitCode: 130,
      tmuxName: 'other',
      lastActivity: before.lastActivity + 1,
      claudeSessionName: 'garden-7a',
    };
    const [delta] = diff(withSessions(before), withSessions(after));
    const changed = delta?.type === 'session-changed' ? Object.keys(delta.changes) : [];
    expect(changed.sort()).toEqual(
      Object.keys(before)
        .filter((key) => key !== 'id')
        .sort(),
    );
  });

  it('ignores sessions that are only in the previous state, because garden never forgets one', () => {
    expect(diff(withSessions(aSession({ id: 'sid-1' })), initialState)).toEqual([]);
  });
});
