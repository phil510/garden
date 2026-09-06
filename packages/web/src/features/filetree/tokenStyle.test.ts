import type { ThemedToken } from 'shiki';
import { describe, expect, it } from 'vitest';
import { tokenStyle } from './tokenStyle';

function token(overrides: Partial<ThemedToken> = {}): ThemedToken {
  return { content: 'x', offset: 0, color: '#ffffff', ...overrides };
}

describe('tokenStyle', () => {
  it('carries the color through with no font style set', () => {
    expect(tokenStyle(token())).toEqual({ color: '#ffffff' });
  });

  it('maps the italic bit', () => {
    expect(tokenStyle(token({ fontStyle: 1 }))).toEqual({
      color: '#ffffff',
      fontStyle: 'italic',
    });
  });

  it('maps the bold bit', () => {
    expect(tokenStyle(token({ fontStyle: 2 }))).toEqual({
      color: '#ffffff',
      fontWeight: 'bold',
    });
  });

  it('combines italic and underline when both bits are set', () => {
    expect(tokenStyle(token({ fontStyle: 1 | 4 }))).toEqual({
      color: '#ffffff',
      fontStyle: 'italic',
      textDecoration: 'underline',
    });
  });
});
