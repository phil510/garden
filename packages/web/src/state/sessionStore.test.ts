import { aSession } from '@garden/shared/fixtures';
import type { Delta } from '@garden/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from './sessionStore';

const fold = (deltas: Delta[]) => {
  useSessionStore.getState().applyDeltas(deltas);
  return useSessionStore.getState().sessions;
};

const added = (session: ReturnType<typeof aSession>): Delta => ({ type: 'session-added', session });

beforeEach(() => {
  useSessionStore.setState({ sessions: {} });
});

describe('sessionStore', () => {
  it('starts empty', () => {
    expect(useSessionStore.getState().sessions).toEqual({});
  });

  it('seeds the map from a snapshot, keyed by id', () => {
    useSessionStore.getState().setSnapshot([aSession({ id: 'sid-1' }), aSession({ id: 'sid-2' })]);
    expect(Object.keys(useSessionStore.getState().sessions).sort()).toEqual(['sid-1', 'sid-2']);
  });

  it('replaces the whole map on a later snapshot, dropping sessions the new one omits', () => {
    useSessionStore.getState().setSnapshot([aSession({ id: 'sid-1' })]);
    useSessionStore.getState().setSnapshot([aSession({ id: 'sid-2' })]);
    expect(Object.keys(useSessionStore.getState().sessions)).toEqual(['sid-2']);
  });

  it('adds a session under its id', () => {
    const session = aSession({ id: 'sid-1' });
    expect(fold([added(session)])).toEqual({ 'sid-1': session });
  });

  it('merges only the changed fields into a known session', () => {
    fold([added(aSession({ id: 'sid-1', status: 'working' }))]);
    const state = fold([{ type: 'session-changed', id: 'sid-1', changes: { status: 'waiting' } }]);
    expect(state['sid-1']).toMatchObject({ status: 'waiting', liveness: 'live' });
  });

  it('ignores a change for a session it has never seen', () => {
    const state = fold([{ type: 'session-changed', id: 'sid-9', changes: { status: 'waiting' } }]);
    expect(state).toEqual({});
  });

  it('applies deltas in order, so a later change in the same batch wins', () => {
    fold([added(aSession({ id: 'sid-1', status: 'working' }))]);
    const state = fold([
      { type: 'session-changed', id: 'sid-1', changes: { status: 'waiting' } },
      { type: 'session-changed', id: 'sid-1', changes: { status: 'needs-approval' } },
    ]);
    expect(state['sid-1']?.status).toBe('needs-approval');
  });

  it('replaces a session entirely when it is added again under the same id', () => {
    fold([added(aSession({ id: 'sid-1', title: 'Before' }))]);
    const state = fold([added(aSession({ id: 'sid-1', title: 'After' }))]);
    expect(state['sid-1']?.title).toBe('After');
  });
});
