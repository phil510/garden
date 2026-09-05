import type { Liveness } from '@garden/shared';
import type { TmuxSessionFact } from './types.js';

export interface LivenessInput {
  /** The tmux fact for this session's pane, absent when tmux has no such session. */
  fact: TmuxSessionFact | undefined;
  ended: boolean;
}

export interface LivenessResult {
  liveness: Liveness;
  exitCode: number | null;
}

/** Pure in tmux facts alone: no clock, no transcript, so the answer is the same at any time. */
export function deriveLiveness(input: LivenessInput): LivenessResult {
  const { fact, ended } = input;
  if (!ended && fact !== undefined && !fact.paneDead) return { liveness: 'live', exitCode: null };
  // An exit code exists only while tmux still holds the dead pane.
  return { liveness: 'dead', exitCode: fact?.exitCode ?? null };
}
