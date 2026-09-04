import type { Liveness } from '@garden/shared';
import type { TmuxSessionFact } from './types.js';

export const EXTERNAL_WINDOW_MS = 10 * 60 * 1000;

export interface LivenessInput {
  tmuxName: string | null;
  fact: TmuxSessionFact | undefined;
  ended: boolean;
  lastActivity: number;
  at: number;
}

export interface LivenessResult {
  liveness: Liveness;
  exitCode: number | null;
}

export function deriveLiveness(input: LivenessInput): LivenessResult {
  const { tmuxName, fact, ended, lastActivity, at } = input;
  if (ended) return { liveness: 'exited', exitCode: fact?.exitCode ?? null };
  if (tmuxName !== null && fact !== undefined) {
    return fact.paneDead
      ? { liveness: 'exited', exitCode: fact.exitCode }
      : { liveness: 'live', exitCode: null };
  }
  // No pane to ask, so recent transcript activity is the only evidence a process is running.
  const recent = lastActivity > 0 && at - lastActivity < EXTERNAL_WINDOW_MS;
  return { liveness: recent ? 'external' : 'dead', exitCode: null };
}
