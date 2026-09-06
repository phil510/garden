import { describe, expect, it } from 'vitest';
import { languageGuess } from './language';

describe('languageGuess', () => {
  it('takes the extension after the final dot, lowercased', () => {
    expect(languageGuess('src/index.TS')).toBe('ts');
  });

  it('takes only the last extension of a multi-dot filename', () => {
    expect(languageGuess('src/api/client.test.ts')).toBe('ts');
  });

  it('falls back to the bare filename for an extension-less file', () => {
    expect(languageGuess('Dockerfile')).toBe('dockerfile');
  });

  it('does not read a leading dot as an extension separator', () => {
    expect(languageGuess('.gitignore')).toBe('.gitignore');
  });

  it('resolves against the final path segment', () => {
    expect(languageGuess('packages/web/src/App.tsx')).toBe('tsx');
  });
});
