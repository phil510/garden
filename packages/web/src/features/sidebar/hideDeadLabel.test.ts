import { describe, expect, it } from 'vitest';
import { hideDeadLabel } from './hideDeadLabel';

describe('hideDeadLabel', () => {
  it('reads "Show dead" once dead sessions are hidden', () => {
    expect(hideDeadLabel(true)).toBe('Show dead');
  });

  it('reads "Hide dead" while dead sessions are shown', () => {
    expect(hideDeadLabel(false)).toBe('Hide dead');
  });
});
