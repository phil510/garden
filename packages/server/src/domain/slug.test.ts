import { describe, expect, it } from 'vitest';
import { inScopeDirs, slugify } from './slug.js';

describe('slugify', () => {
  it('replaces slashes, dots and underscores with a dash', () => {
    expect(slugify('/Users/phil/dbt_snowflake/.worktrees/chore/tidy-2')).toBe(
      '-Users-phil-dbt-snowflake--worktrees-chore-tidy-2',
    );
  });

  it('passes digits, case and existing dashes through unchanged', () => {
    expect(slugify('aB3-xyz')).toBe('aB3-xyz');
  });
});

describe('inScopeDirs', () => {
  const roots = ['/Users/phil/Desktop/Extend'];

  it('keeps a directory nested under a configured root', () => {
    const dir = slugify('/Users/phil/Desktop/Extend/garden');
    expect(inScopeDirs([dir], roots)).toEqual([dir]);
  });

  it('keeps a directory that is exactly a configured root', () => {
    const dir = slugify('/Users/phil/Desktop/Extend');
    expect(inScopeDirs([dir], roots)).toEqual([dir]);
  });

  it('drops a sibling directory whose slug merely shares a string prefix', () => {
    const sibling = slugify('/Users/phil/Desktop/Extend2/garden');
    expect(inScopeDirs([sibling], roots)).toEqual([]);
  });

  it('drops a directory outside every configured root', () => {
    const outside = slugify('/Users/phil/Downloads/scratch');
    expect(inScopeDirs([outside], roots)).toEqual([]);
  });
});
