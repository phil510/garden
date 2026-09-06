import { describe, expect, it, vi } from 'vitest';
import { deriveLiveness, type LivenessInput, type LivenessResult } from './sessions.js';
import type { TmuxSessionFact } from './types.js';

const fact = (o: Partial<TmuxSessionFact> = {}): TmuxSessionFact => ({
  name: 'repo',
  paneDead: false,
  exitCode: null,
  ...o,
});

const base = { fact: fact(), ended: false };

/** Every combination of the two inputs, so the derivation is pinned exhaustively. */
const cases: { name: string; input: LivenessInput; expected: LivenessResult }[] = [
  {
    name: 'is live while tmux reports a pane that is not dead',
    input: base,
    expected: { liveness: 'live', exitCode: null },
  },
  {
    name: 'is dead with the pane exit code once the pane is dead',
    input: { ...base, fact: fact({ paneDead: true, exitCode: 130 }) },
    expected: { liveness: 'dead', exitCode: 130 },
  },
  {
    name: 'is dead with no exit code when the pane died without reporting one',
    input: { ...base, fact: fact({ paneDead: true }) },
    expected: { liveness: 'dead', exitCode: null },
  },
  {
    name: 'is dead when tmux has no session for it, whether garden never started one or tmux lost it',
    input: { ...base, fact: undefined },
    expected: { liveness: 'dead', exitCode: null },
  },
  {
    name: 'is dead on a SessionEnd hook before tmux has been polled',
    input: { ...base, ended: true },
    expected: { liveness: 'dead', exitCode: null },
  },
  {
    name: 'surfaces the pane exit code when a SessionEnd hook and a tmux snapshot both landed',
    input: { fact: fact({ paneDead: true, exitCode: 1 }), ended: true },
    expected: { liveness: 'dead', exitCode: 1 },
  },
  {
    name: 'is dead with no exit code when it ended and the dead pane reported none',
    input: { fact: fact({ paneDead: true }), ended: true },
    expected: { liveness: 'dead', exitCode: null },
  },
  {
    name: 'is dead with no exit code when it ended and tmux no longer holds the session',
    input: { fact: undefined, ended: true },
    expected: { liveness: 'dead', exitCode: null },
  },
];

describe('deriveLiveness', () => {
  for (const { name, input, expected } of cases) {
    it(`a session ${name}`, () => {
      expect(deriveLiveness(input)).toEqual(expected);
    });
  }

  it('answers identically at any wall-clock time, so no clock can leak back into the derivation', () => {
    const instants = [0, 1_700_000_000_000, 4_100_000_000_000];
    vi.useFakeTimers();
    try {
      for (const { input, expected } of cases) {
        for (const instant of instants) {
          vi.setSystemTime(instant);
          expect(deriveLiveness(input)).toEqual(expected);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
