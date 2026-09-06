import { describe, expect, it } from 'vitest';
import { terminalTheme } from './theme';

describe('terminalTheme', () => {
  it('maps each theme color to its own token', () => {
    const theme = terminalTheme((name) => `resolved(${name})`);
    expect(theme).toEqual({
      background: 'resolved(--ground)',
      foreground: 'resolved(--text)',
      cursor: 'resolved(--accent)',
      cursorAccent: 'resolved(--ground)',
      selectionBackground: 'resolved(--accent-dim)',
    });
  });
});
