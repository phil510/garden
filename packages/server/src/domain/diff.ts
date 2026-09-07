import type { Delta, SessionState } from '@garden/shared';
import type { GardenState } from './types.js';

function changedFields(before: SessionState, after: SessionState): Partial<SessionState> | null {
  const changes: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(after) as (keyof SessionState)[]) {
    if (!Object.is(before[key], after[key])) {
      changes[key] = after[key];
      count += 1;
    }
  }
  return count === 0 ? null : changes;
}

export function diff(prev: GardenState, next: GardenState): Delta[] {
  const deltas: Delta[] = [];
  for (const [id, session] of Object.entries(next.sessions)) {
    const before = prev.sessions[id];
    if (before === undefined) {
      deltas.push({ type: 'session-added', session });
      continue;
    }
    const changes = changedFields(before, session);
    if (changes !== null) deltas.push({ type: 'session-changed', id, changes });
  }
  return deltas;
}
