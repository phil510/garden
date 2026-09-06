import { describe, expect, it } from 'vitest';
import { terminalTheme } from './theme';

describe('terminalTheme', () => {
  it('resolves every color through the injected reader rather than a hardcoded literal', () => {
    // If a field were a hardcoded literal instead of readVar(...), it would not track what the
    // reader returns for a completely different lookup implementation.
    const theme = terminalTheme(() => 'resolved');
    for (const value of Object.values(theme)) {
      expect(value).toBe('resolved');
    }
  });

  it('reads only real CSS custom properties', () => {
    const names: string[] = [];
    terminalTheme((name) => {
      names.push(name);
      return name;
    });
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^--[a-z][a-z-]*$/);
    }
  });
});
