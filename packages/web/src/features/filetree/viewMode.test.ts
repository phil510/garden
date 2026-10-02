import { describe, expect, it } from 'vitest';
import { resetModeForOpenedFile, shouldResetMode } from './viewMode';

describe('resetModeForOpenedFile', () => {
  it('opens a non-markdown file rendered regardless of the requested line', () => {
    expect(resetModeForOpenedFile(false, 42)).toBe('rendered');
  });

  it('opens a markdown file rendered when no line was requested', () => {
    expect(resetModeForOpenedFile(true, null)).toBe('rendered');
  });

  it('opens a markdown file in source mode for a jump to line 1', () => {
    expect(resetModeForOpenedFile(true, 1)).toBe('source');
  });

  it('opens a markdown file in source mode for a jump past line 1', () => {
    expect(resetModeForOpenedFile(true, 42)).toBe('source');
  });
});

describe('shouldResetMode', () => {
  it('keeps the mode when the same source refetched with no line pending', () => {
    expect(shouldResetMode('root /a x.md', 'root /a x.md', null)).toBe(false);
  });

  it('resets when the source changes', () => {
    expect(shouldResetMode('root /a x.md', 'root /a y.md', null)).toBe(true);
    expect(shouldResetMode(null, 'root /a x.md', null)).toBe(true);
    expect(shouldResetMode('root /a x.md', null, null)).toBe(true);
  });

  it('resets when a line request is pending', () => {
    expect(shouldResetMode('root /a x.md', 'root /a x.md', 3)).toBe(true);
  });
});
