import { describe, expect, it } from 'vitest';
import { lastPathSegment } from './lastPathSegment';

describe('lastPathSegment', () => {
  it('takes the folder name from an absolute path', () => {
    expect(lastPathSegment('/Users/philip/Desktop/Extend/garden')).toBe('garden');
  });

  it('ignores a trailing separator', () => {
    expect(lastPathSegment('/Users/philip/garden/')).toBe('garden');
  });

  it('ignores repeated separators', () => {
    expect(lastPathSegment('/Users//philip///garden')).toBe('garden');
  });

  it('falls back to the path itself when it holds no segment', () => {
    expect(lastPathSegment('/')).toBe('/');
  });
});
