import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { initialState, reduce } from './reduce.js';
import type { GardenEvent, TranscriptRecord } from './types.js';

const now = 1_700_000_000_000;
const fold = (events: GardenEvent[]) => events.reduce(reduce, initialState);

const mapped: GardenEvent = { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' }, at: now };

const transcript = (o: Partial<TranscriptRecord> = {}, at = now): GardenEvent => ({
  type: 'transcript-changed',
  path: '/t.jsonl',
  mtime: at,
  at,
  record: {
    sessionId: 'sid-1',
    cwd: '/Users/dev/repo',
    gitBranch: 'main',
    title: 'Wire up the fold',
    lastPrompt: 'wire up the fold please',
    recap: 'Done.',
    ...o,
  },
});

const snapshot = (paneDead: boolean, at = now): GardenEvent => ({
  type: 'tmux-snapshot',
  sessions: [{ name: 'repo', paneDead, exitCode: paneDead ? 1 : null, attached: !paneDead }],
  at,
});

const hook = (name: string, at = now, id = 'sid-1'): GardenEvent => ({
  type: 'hook',
  payload: aHookEvent({ session_id: id, hook_event_name: name }),
  at,
});

describe('reduce', () => {
  it('stores a hook for a session with no transcript yet under its own id', () => {
    const state = fold([hook('UserPromptSubmit', now, 'sid-9')]);
    expect(state.sessions['sid-9']).toMatchObject({ cwd: '/Users/dev/repo', status: 'working' });
  });

  it('keeps a live session working after a tmux snapshot confirms the pane', () => {
    const state = fold([mapped, transcript(), hook('UserPromptSubmit'), snapshot(false)]);
    expect(state.sessions['sid-1']).toMatchObject({
      liveness: 'live',
      status: 'working',
      attached: true,
      tmuxName: 'repo',
      title: 'Wire up the fold',
      branch: 'main',
      recap: 'Done.',
    });
  });

  it('reports exited and drops the status when a hook says working after the pane died', () => {
    const state = fold([mapped, transcript(), snapshot(true), hook('UserPromptSubmit', now + 1)]);
    expect(state.sessions['sid-1']).toMatchObject({
      liveness: 'exited',
      exitCode: 1,
      status: 'unknown',
    });
  });

  it('ages an unmapped session out to dead on a tick eleven minutes later', () => {
    expect(fold([transcript()]).sessions['sid-1']?.liveness).toBe('external');
    const tick: GardenEvent = { type: 'tick', at: now + 11 * 60_000 };
    expect(fold([transcript(), tick]).sessions['sid-1']?.liveness).toBe('dead');
  });

  it('does not revive a dead session when an event arrives with an older timestamp', () => {
    const aged = fold([transcript(), { type: 'tick', at: now + 11 * 60_000 }]);
    expect(reduce(aged, { type: 'tick', at: now }).sessions['sid-1']?.liveness).toBe('dead');
  });

  it('falls back to the last prompt when the transcript has no ai-title', () => {
    expect(fold([transcript({ title: null })]).sessions['sid-1']?.title).toBe(
      'wire up the fold please',
    );
  });

  it('ignores a transcript slice whose session id could not be read', () => {
    expect(Object.keys(fold([transcript({ sessionId: null })]).sessions)).toEqual([]);
  });

  it('brings a session back to live when SessionStart follows SessionEnd on the same pane', () => {
    const ended = [mapped, snapshot(false), hook('SessionEnd')];
    expect(fold(ended).sessions['sid-1']?.liveness).toBe('exited');
    expect(fold([...ended, hook('SessionStart', now + 1)]).sessions['sid-1']).toMatchObject({
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
      at: now,
    };
    expect(fold([created]).sessions['sid-2']).toMatchObject({
      tmuxName: 'repo-2',
      cwd: '/Users/dev/repo',
    });
  });
});
