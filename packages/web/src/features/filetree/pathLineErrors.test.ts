import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { displayPath, openFailureMessage } from './pathLineErrors';

describe('openFailureMessage', () => {
  it('reports a 404 as a missing file at the resolved path', () => {
    expect(openFailureMessage(new ApiError('no such path: x', 404), '/r/x.ts')).toBe(
      'File not found: /r/x.ts',
    );
  });

  it('carries the server reason for a 400', () => {
    expect(openFailureMessage(new ApiError('path escapes root: ../x', 400), '/r/x.ts')).toBe(
      "Can't open /r/x.ts: path escapes root: ../x",
    );
  });

  it('leaves other failures to the caller', () => {
    expect(openFailureMessage(new ApiError('boom', 500), '/r/x.ts')).toBeNull();
    expect(openFailureMessage(new TypeError('Failed to fetch'), '/r/x.ts')).toBeNull();
  });
});

describe('displayPath', () => {
  it('resolves against the cwd when it is known', () => {
    expect(displayPath('/work/repo', 'src/../a.ts')).toBe('/work/repo/a.ts');
  });

  it('falls back to the clicked path when the cwd is gone', () => {
    expect(displayPath(undefined, 'src/a.ts')).toBe('src/a.ts');
  });
});
