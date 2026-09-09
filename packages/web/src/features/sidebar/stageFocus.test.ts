import { describe, expect, it } from 'vitest';
import { focusedSessionId } from './stageFocus';

describe('focusedSessionId', () => {
  it('returns the session id at the focused slot', () => {
    expect(focusedSessionId(['a', 'b', null], 1)).toBe('b');
  });

  it('ignores a different in-range slot', () => {
    expect(focusedSessionId(['a', 'b', 'c'], 0)).toBe('a');
  });

  it('returns null when the focused slot is empty', () => {
    expect(focusedSessionId([null, 'b', null], 0)).toBeNull();
  });

  it('returns null for an out-of-range focused slot', () => {
    expect(focusedSessionId(['a', 'b'], 5)).toBeNull();
  });
});
