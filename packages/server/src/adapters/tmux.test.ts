import { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { checkTmuxVersionWarning, describeTmuxVersionWarning } from './tmux.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Parse-and-compare cases (patch letters, newer majors) live with @garden/shared's
// parseTmuxVersion/tmuxVersionAtLeast. These cover what this module adds: the 3.6
// floor, its warning message, and the unparseable-string case at this call site.
describe('describeTmuxVersionWarning', () => {
  it('warns below the floor, naming the version found and required', () => {
    const message = describeTmuxVersionWarning('tmux 3.4\n');
    expect(message).toMatch(/3\.4/);
    expect(message).toMatch(/3\.6/);
  });

  it('accepts a version at exactly the floor', () => {
    expect(describeTmuxVersionWarning('tmux 3.6\n')).toBeNull();
  });

  it('does not warn on an unparseable version string', () => {
    expect(describeTmuxVersionWarning('not tmux at all')).toBeNull();
  });
});

describe('checkTmuxVersionWarning', () => {
  it('resolves to null rather than throwing when tmux -V fails to run', async () => {
    vi.mocked(execFile).mockImplementation(
      // execFile's real overloads don't cover a callback-only invocation with no
      // options, but that's exactly how execFileAsync (promisify(execFile)) calls it.
      ((_file: string, _args: string[], callback: (error: Error) => void) => {
        callback(new Error('ENOENT'));
      }) as unknown as typeof execFile,
    );

    await expect(checkTmuxVersionWarning()).resolves.toBeNull();
  });
});
