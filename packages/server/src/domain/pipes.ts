import type { Watch } from './watches.js';

const NO_PIPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Clears the digest with `digestId` on the session's watches. An id that no longer matches (a
 *  late ack for a digest since replaced, or another session's) changes nothing and returns the
 *  input array. */
export function ackDigest(
  watches: readonly Watch[],
  sessionId: string,
  digestId: string,
): readonly Watch[] {
  const matches = (w: Watch) => w.sessionId === sessionId && w.pendingDigest?.id === digestId;
  if (!watches.some(matches)) return watches;
  return watches.map((w) => (matches(w) ? { ...w, pendingDigest: null } : w));
}

/** Drops the watches of sessions with no pipe connected for more than seven days, counted from
 *  the later of the watch's creation and the session's last connection. Returns the input
 *  array when nothing ends. */
export function endUnpipedWatches(
  watches: readonly Watch[],
  lastPipeAt: Readonly<Record<string, number>>,
  connected: ReadonlySet<string>,
  now: number,
): readonly Watch[] {
  const kept = watches.filter(
    (w) =>
      connected.has(w.sessionId) ||
      now - Math.max(w.createdAt, lastPipeAt[w.sessionId] ?? -Infinity) <= NO_PIPE_TTL_MS,
  );
  return kept.length === watches.length ? watches : kept;
}

/** Drops connection times more than seven days old for unconnected sessions: past that point a
 *  time can no longer change what `endUnpipedWatches` decides. Returns the input object when
 *  nothing is dropped. */
export function prunePipeTimes(
  lastPipeAt: Readonly<Record<string, number>>,
  connected: ReadonlySet<string>,
  now: number,
): Readonly<Record<string, number>> {
  const entries = Object.entries(lastPipeAt);
  const kept = entries.filter(([sid, at]) => connected.has(sid) || now - at <= NO_PIPE_TTL_MS);
  return kept.length === entries.length ? lastPipeAt : Object.fromEntries(kept);
}
