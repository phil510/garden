import type { SessionState } from '@garden/shared';
import { formatRelativeTime } from './relativeTime';

/** `''` reaches here the same as `null` would — a registry entry can name a session with an
 *  empty string, and the sidebar has nothing useful to show either way. */
export function sessionIdentityLabel(claudeSessionName: string | null): string | null {
  return claudeSessionName === null || claudeSessionName === '' ? null : claudeSessionName;
}

export interface MetaLineSegment {
  key: 'name' | 'branch' | 'time';
  text: string;
  mono: boolean;
}

/** The meta line's segments, in display order, with absent fields dropped rather than
 *  rendered empty — the caller joins what comes back with separators, so an omitted segment
 *  never produces a stray `·`. */
export function metaLineSegments(
  session: Pick<SessionState, 'claudeSessionName' | 'branch' | 'lastActivity'>,
  now: number,
): MetaLineSegment[] {
  const segments: MetaLineSegment[] = [];
  const name = sessionIdentityLabel(session.claudeSessionName);
  if (name !== null) segments.push({ key: 'name', text: name, mono: false });
  if (session.branch !== null) segments.push({ key: 'branch', text: session.branch, mono: true });
  segments.push({ key: 'time', text: formatRelativeTime(session.lastActivity, now), mono: true });
  return segments;
}

/** `branch` and `time` keep the layout classes their standalone spans had before the meta
 *  line was generalized into a segment list; `name` (the Claude session name) is new and
 *  gets no special treatment. */
export function metaLineSegmentClassName(segment: MetaLineSegment): string | undefined {
  const layout = segment.key === 'branch' ? 'row-branch' : segment.key === 'time' ? 'row-time' : '';
  const mono = segment.mono ? 'mono' : '';
  return [layout, mono].filter((part) => part !== '').join(' ') || undefined;
}
