import { describe, expect, it } from 'vitest';
import { assertTmuxVersion } from './tmux.js';

// The `tmux -V` process boundary (checkTmuxVersion) is proven by an integration test,
// not a mocked one — see tests/integration/tmux-version-gate.test.ts. This covers the
// pure half: parsing, the 3.6 threshold, and the real output shapes tmux produces.
describe('assertTmuxVersion', () => {
  it('throws below the minimum, naming the version found and required', () => {
    expect(() => assertTmuxVersion('tmux 3.4\n')).toThrow(
      'garden requires tmux 3.6 or newer, found 3.4',
    );
  });

  it('accepts a version at exactly the minimum', () => {
    expect(() => assertTmuxVersion('tmux 3.6\n')).not.toThrow();
  });

  it('accepts a version above the minimum', () => {
    expect(() => assertTmuxVersion('tmux 3.7\n')).not.toThrow();
    expect(() => assertTmuxVersion('tmux 4.0\n')).not.toThrow();
  });

  it('ignores a trailing patch letter', () => {
    expect(() => assertTmuxVersion('tmux 3.6a\n')).not.toThrow();
  });

  it('reads a version behind a branch prefix', () => {
    expect(() => assertTmuxVersion('tmux next-3.4\n')).toThrow(/3\.4/);
  });

  it('throws on an unparseable version string, naming the offending output', () => {
    expect(() => assertTmuxVersion('not tmux at all')).toThrow(/could not read a version/);
  });
});
