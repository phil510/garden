import { describe, expect, it } from 'vitest';
import { evaluateTmuxVersion } from './preflight.js';

// Parse-and-compare cases (patch letters, older majors, unparseable strings) live with
// @garden/shared's parseTmuxVersion/tmuxVersionAtLeast. These cover what this module adds:
// the 3.2 threshold and its two message shapes.
describe('evaluateTmuxVersion', () => {
  it('accepts a version at exactly the minimum', () => {
    expect(evaluateTmuxVersion('tmux 3.2\n')).toEqual({ ok: true });
  });

  it('rejects a version below the minimum with the found and required versions', () => {
    const result = evaluateTmuxVersion('tmux 3.1c\n');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/requires tmux 3\.2 or newer, found 3\.1/);
  });

  it('rejects output with no parseable version', () => {
    const result = evaluateTmuxVersion('not tmux at all');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/could not read a version/);
  });
});
