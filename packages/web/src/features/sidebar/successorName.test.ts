import { aSession } from '@garden/shared/fixtures';
import type { SessionMap, SessionPlacement } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { resolveSuccessorName } from './successorName';

describe('resolveSuccessorName', () => {
  it('returns null when the session has no successor', () => {
    const sessions: SessionMap = {};
    const placements: Record<string, SessionPlacement> = {};

    expect(resolveSuccessorName(placements, sessions, 'sid-1')).toBeNull();
  });

  it("returns the successor's claudeSessionName", () => {
    const successor = aSession({ id: 'sid-2', claudeSessionName: 'garden-7a' });
    const sessions: SessionMap = { [successor.id]: successor };
    const placements: Record<string, SessionPlacement> = { 'sid-1': { successor: 'sid-2' } };

    expect(resolveSuccessorName(placements, sessions, 'sid-1')).toBe('garden-7a');
  });

  it('returns null when the successor names a session garden no longer knows about', () => {
    const sessions: SessionMap = {};
    const placements: Record<string, SessionPlacement> = { 'sid-1': { successor: 'pruned-id' } };

    expect(resolveSuccessorName(placements, sessions, 'sid-1')).toBeNull();
  });

  it('returns null when the successor is known but has no claudeSessionName yet', () => {
    const successor = aSession({ id: 'sid-2', claudeSessionName: null });
    const sessions: SessionMap = { [successor.id]: successor };
    const placements: Record<string, SessionPlacement> = { 'sid-1': { successor: 'sid-2' } };

    expect(resolveSuccessorName(placements, sessions, 'sid-1')).toBeNull();
  });
});
