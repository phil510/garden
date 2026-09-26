import type { SessionMap, SessionPlacement } from '@garden/shared';

/** The successor session's `claudeSessionName` — a session's durable identity, distinct
 *  from its free-text title — for the "handed off → X" marker. Null when the session has no
 *  successor, or the successor names a session garden no longer knows about. */
export function resolveSuccessorName(
  placements: Record<string, SessionPlacement>,
  sessions: SessionMap,
  sessionId: string,
): string | null {
  const successorId = placements[sessionId]?.successor;
  if (successorId === undefined) return null;
  return sessions[successorId]?.claudeSessionName ?? null;
}
