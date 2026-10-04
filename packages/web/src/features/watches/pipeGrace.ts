import type { SessionState } from '@garden/shared';
import { PIPE_GRACE_MS } from './watchStatus';

/** First-seen-disconnected timestamps, keyed by session id. */
export type DownSince = Readonly<Record<string, number>>;

/** Only a live session with a watch can be pipe-faulted: a dead one has no pipe by design. */
export function trackPipeDown(
  prev: DownSince,
  sessions: readonly SessionState[],
  now: number,
): DownSince {
  const next: Record<string, number> = {};
  for (const session of sessions) {
    if (session.liveness !== 'live' || session.pipeConnected || session.watches.length === 0) {
      continue;
    }
    next[session.id] = prev[session.id] ?? now;
  }
  return next;
}

export function isPipeFaulted(id: string, downSince: DownSince, now: number): boolean {
  const since = downSince[id];
  return since !== undefined && now - since >= PIPE_GRACE_MS;
}

export function pipeFaultedIds(downSince: DownSince, now: number): ReadonlySet<string> {
  return new Set(Object.keys(downSince).filter((id) => isPipeFaulted(id, downSince, now)));
}

/** When the next tracked session crosses its grace period, or null if none is waiting. */
export function nextGraceExpiry(downSince: DownSince, now: number): number | null {
  const pending = Object.values(downSince)
    .map((since) => since + PIPE_GRACE_MS)
    .filter((expiry) => expiry > now);
  return pending.length === 0 ? null : Math.min(...pending);
}
