import { describe, expect, it } from 'vitest';
import { EXTERNAL_WINDOW_MS, deriveLiveness } from './sessions.js';
import type { TmuxSessionFact } from './types.js';

const fact = (o: Partial<TmuxSessionFact> = {}): TmuxSessionFact => ({
  name: 'repo',
  paneDead: false,
  exitCode: null,
  attached: false,
  ...o,
});

const now = 1_700_000_000_000;
const base = { tmuxName: 'repo', fact: fact(), ended: false, lastActivity: now, at: now };

describe('deriveLiveness', () => {
  it('resolves to exited rather than external when the pane is dead and the transcript is fresh', () => {
    expect(deriveLiveness({ ...base, fact: fact({ paneDead: true, exitCode: 130 }) })).toEqual({
      liveness: 'exited',
      exitCode: 130,
    });
  });

  it('resolves to exited on a SessionEnd hook before tmux has been polled', () => {
    expect(deriveLiveness({ ...base, ended: true })).toEqual({
      liveness: 'exited',
      exitCode: null,
    });
  });

  it('resolves to external when the tmux mapping is gone but the transcript is fresh', () => {
    expect(deriveLiveness({ ...base, tmuxName: null, fact: undefined })).toEqual({
      liveness: 'external',
      exitCode: null,
    });
  });

  it('resolves to external when the mapping exists but tmux has no such session', () => {
    expect(deriveLiveness({ ...base, fact: undefined })).toEqual({
      liveness: 'external',
      exitCode: null,
    });
  });

  it('treats a transcript touched exactly ten minutes ago as dead, not external', () => {
    const input = { ...base, tmuxName: null, fact: undefined };
    expect(deriveLiveness({ ...input, lastActivity: now - EXTERNAL_WINDOW_MS }).liveness).toBe(
      'dead',
    );
    expect(deriveLiveness({ ...input, lastActivity: now - EXTERNAL_WINDOW_MS + 1 }).liveness).toBe(
      'external',
    );
  });

  it('treats a session with no recorded activity as dead', () => {
    expect(
      deriveLiveness({ ...base, tmuxName: null, fact: undefined, lastActivity: 0 }).liveness,
    ).toBe('dead');
  });
});
