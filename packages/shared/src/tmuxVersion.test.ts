import { describe, expect, it } from 'vitest';
import { parseTmuxVersion, tmuxVersionAtLeast } from './tmuxVersion.js';

describe('parseTmuxVersion', () => {
  it('reads major and minor from a plain version string', () => {
    expect(parseTmuxVersion('tmux 3.6\n')).toEqual({ major: 3, minor: 6 });
  });

  it('ignores a trailing patch letter', () => {
    expect(parseTmuxVersion('tmux 3.6a\n')).toEqual({ major: 3, minor: 6 });
  });

  it('reads a version behind a branch prefix', () => {
    expect(parseTmuxVersion('tmux next-3.4\n')).toEqual({ major: 3, minor: 4 });
  });

  it('returns null when no version can be read', () => {
    expect(parseTmuxVersion('not tmux at all')).toBeNull();
  });
});

describe('tmuxVersionAtLeast', () => {
  const minimum = { major: 3, minor: 6 };

  it('accepts a version exactly at the minimum', () => {
    expect(tmuxVersionAtLeast({ major: 3, minor: 6 }, minimum)).toBe(true);
  });

  it('accepts a newer major version', () => {
    expect(tmuxVersionAtLeast({ major: 4, minor: 0 }, minimum)).toBe(true);
  });

  it('rejects a version below the minimum', () => {
    expect(tmuxVersionAtLeast({ major: 3, minor: 4 }, minimum)).toBe(false);
  });

  it('rejects an older major version even with a higher minor', () => {
    expect(tmuxVersionAtLeast({ major: 2, minor: 9 }, minimum)).toBe(false);
  });
});
