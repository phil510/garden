import { describe, expect, it } from 'vitest';
import { evaluateTmuxVersion } from './preflight.js';

describe('evaluateTmuxVersion', () => {
  it('accepts a version at exactly the minimum', () => {
    expect(evaluateTmuxVersion('tmux 3.2\n')).toEqual({ ok: true });
  });

  it('accepts a newer major version', () => {
    expect(evaluateTmuxVersion('tmux 4.0\n')).toEqual({ ok: true });
  });

  it('accepts a patch-lettered version at or above the minimum', () => {
    expect(evaluateTmuxVersion('tmux 3.6a\n')).toEqual({ ok: true });
  });

  it('rejects a version below the minimum with the found and required versions', () => {
    const result = evaluateTmuxVersion('tmux 3.1c\n');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/requires tmux 3\.2 or newer, found 3\.1/);
  });

  it('rejects an older major version even with a higher minor', () => {
    expect(evaluateTmuxVersion('tmux 2.9\n').ok).toBe(false);
  });

  it('rejects output with no parseable version', () => {
    const result = evaluateTmuxVersion('not tmux at all');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/could not read a version/);
  });
});
