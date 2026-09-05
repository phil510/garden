import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { initialState, reduce } from './reduce.js';
import type { GardenEvent, TranscriptRecord } from './types.js';

const now = 1_700_000_000_000;
const fold = (events: GardenEvent[]) => events.reduce(reduce, initialState);

const mapped: GardenEvent = { type: 'store-loaded', tmuxNames: { 'sid-1': 'repo' } };

const transcript = (o: Partial<TranscriptRecord> = {}, mtime = now): GardenEvent => ({
  type: 'transcript-changed',
  path: '/t.jsonl',
  mtime,
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

const snapshot = (paneDead: boolean, name = 'repo'): GardenEvent => ({
  type: 'tmux-snapshot',
  sessions: [{ name, paneDead, exitCode: paneDead ? 1 : null, attached: !paneDead }],
});

const hook = (name: string, id = 'sid-1'): GardenEvent => ({
  type: 'hook',
  payload: aHookEvent({ session_id: id, hook_event_name: name }),
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
      attached: true,
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
        attached: false,
      },
    );
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
});
