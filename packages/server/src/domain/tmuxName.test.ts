import { describe, expect, it } from 'vitest';
import { deriveTmuxName } from './tmuxName.js';

describe('deriveTmuxName', () => {
  it('uses the cwd folder name when it is not taken', () => {
    expect(deriveTmuxName('/Users/dev/garden', [])).toBe('garden');
  });

  it('ignores a trailing slash on the cwd', () => {
    expect(deriveTmuxName('/Users/dev/garden/', [])).toBe('garden');
  });

  it('strips a leading dash so tmux does not read the name as a flag', () => {
    expect(deriveTmuxName('/Users/dev/-weird', [])).toBe('weird');
  });

  it('replaces a colon, which tmux reads as the session:window.pane separator', () => {
    expect(deriveTmuxName('/Users/dev/a:b', [])).toBe('a-b');
  });

  it('falls back to a fixed name when the folder name sanitises to nothing', () => {
    expect(deriveTmuxName('/Users/dev/---', [])).toBe('session');
  });

  it('suffixes with -2 when the base name is already taken', () => {
    expect(deriveTmuxName('/Users/dev/garden', ['garden'])).toBe('garden-2');
  });

  it('finds the first free suffix when several are already taken', () => {
    expect(deriveTmuxName('/Users/dev/garden', ['garden', 'garden-2', 'garden-3'])).toBe(
      'garden-4',
    );
  });
});
