import { describe, expect, it } from 'vitest';
import { entryPaths } from './entryPaths';

describe('entryPaths', () => {
  it('joins a top-level file onto the root and leaves the relative path as listed', () => {
    expect(entryPaths('/repos/garden', 'package.json')).toEqual({
      absolute: '/repos/garden/package.json',
      relative: 'package.json',
    });
  });

  it('joins a nested directory path onto the root', () => {
    expect(entryPaths('/repos/garden', 'packages/web/src')).toEqual({
      absolute: '/repos/garden/packages/web/src',
      relative: 'packages/web/src',
    });
  });
});
