import type { SessionState } from '@garden/shared';
import { formatRelativeTime } from './relativeTime';

/** `''` reaches here the same as `null` would — a registry entry can name a session with an
 *  empty string, and the sidebar has nothing useful to show either way. */
export function sessionIdentityLabel(claudeSessionName: string | null): string | null {
  return claudeSessionName === null || claudeSessionName === '' ? null : claudeSessionName;
}

export interface MetaLineSegment {
  key: 'name' | 'time';
  text: string;
}

/** The meta line's segments, in display order, with absent fields dropped rather than
 *  rendered empty — the caller joins what comes back with separators, so an omitted segment
 *  never produces a stray `·`. */
export function metaLineSegments(
  session: Pick<SessionState, 'claudeSessionName' | 'lastActivity'>,
  now: number,
): MetaLineSegment[] {
  const segments: MetaLineSegment[] = [];
  const name = sessionIdentityLabel(session.claudeSessionName);
  if (name !== null) segments.push({ key: 'name', text: name });
  segments.push({ key: 'time', text: formatRelativeTime(session.lastActivity, now) });
  return segments;
}

/** Every key gets its own layout class, so a key with no arm here is a compile error rather
 *  than a silent fall-through. */
const META_LINE_SEGMENT_CLASS_NAME: Record<MetaLineSegment['key'], string> = {
  name: 'row-name',
  time: 'row-time mono',
};

export function metaLineSegmentClassName(segment: MetaLineSegment): string {
  return META_LINE_SEGMENT_CLASS_NAME[segment.key];
}
