import type { SessionState, WatchKind, WatchSummary } from '@garden/shared';

/** How long a live, watching session may be disconnected before it counts as a fault, so a
 *  session that is just starting doesn't flash red. */
export const PIPE_GRACE_MS = 5000;

export const PIPE_FAULT = {
  label: 'pipe not connected',
  fix: 'Digests are held until the session reconnects.',
};

export function watchPrUrl(watch: WatchSummary): string {
  return `https://github.com/${watch.repo}/pull/${String(watch.pr)}`;
}

export type RowWatchState = { tone: 'watching' | 'fault'; count: number } | null;

export function rowWatchState(session: SessionState, pipeFaulted: boolean): RowWatchState {
  if (session.watches.length === 0) return null;
  const faulted = pipeFaulted || session.watches.some((watch) => watch.status === 'error');
  return { tone: faulted ? 'fault' : 'watching', count: session.watches.length };
}

export interface WatchLineState {
  tone: 'error' | 'pending' | 'closed' | 'watching';
  label: string;
}

/** For an error watch the label is just "error"; the reason is rendered on its own line. */
export function watchLineState(watch: WatchSummary): WatchLineState {
  if (watch.status === 'error') return { tone: 'error', label: 'error' };
  if (watch.status === 'closed') {
    return watch.pendingDigest
      ? { tone: 'pending', label: 'closed · digest pending' }
      : { tone: 'closed', label: 'closed' };
  }
  return watch.pendingDigest
    ? { tone: 'pending', label: 'digest pending' }
    : { tone: 'watching', label: 'watching' };
}

/** `checks:all` implies `checks`, so it replaces it rather than listing both. */
export function kindsLabel(kinds: readonly WatchKind[]): string {
  const checksAll = kinds.includes('checks:all');
  return kinds
    .filter((kind) => !(checksAll && kind === 'checks'))
    .map((kind) => {
      if (kind === 'checks:all') return 'checks (all)';
      if (kind === 'checks') return 'checks (failures)';
      return kind;
    })
    .join(' · ');
}

/** The row glyph's tooltip: the pipe fault, then each distinct watch error reason. */
export function faultSummary(session: SessionState, pipeFaulted: boolean): string {
  const reasons = session.watches.flatMap((watch) =>
    watch.status === 'error' && watch.errorReason !== undefined ? [watch.errorReason] : [],
  );
  return [...new Set([...(pipeFaulted ? [PIPE_FAULT.label] : []), ...reasons])].join('; ');
}
