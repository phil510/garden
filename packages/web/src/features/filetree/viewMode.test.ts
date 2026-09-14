import { describe, expect, it } from 'vitest';
import { resetModeForOpenedFile } from './viewMode';

describe('resetModeForOpenedFile', () => {
  it('opens a non-markdown file rendered regardless of the requested line', () => {
    expect(resetModeForOpenedFile(false, 42)).toBe('rendered');
  });

  it('opens a markdown file rendered when no line was requested', () => {
    expect(resetModeForOpenedFile(true, null)).toBe('rendered');
  });

  it('opens a markdown file rendered for the tree-click default of line 1', () => {
    expect(resetModeForOpenedFile(true, 1)).toBe('rendered');
  });

  it('opens a markdown file in source mode for a jump past line 1', () => {
    expect(resetModeForOpenedFile(true, 42)).toBe('source');
  });
});
