import { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { chromeInstalled, openChromeWindow } from './browser.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: string[],
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, '', '');
    },
  ),
}));

describe('chromeInstalled', () => {
  it('reflects whatever the injected existence check reports', () => {
    expect(chromeInstalled(() => true)).toBe(true);
    expect(chromeInstalled(() => false)).toBe(false);
  });

  it('checks the fixed Chrome app path', () => {
    let checked: string | undefined;
    chromeInstalled((path) => {
      checked = path;
      return false;
    });
    expect(checked).toBe('/Applications/Google Chrome.app');
  });
});

describe('openChromeWindow', () => {
  it('passes -n so `open` launches a new instance and forwards --args to Chrome', async () => {
    await openChromeWindow('http://localhost:1234');

    expect(execFile).toHaveBeenCalledWith(
      'open',
      ['-na', 'Google Chrome', '--args', '--app=http://localhost:1234'],
      expect.any(Function),
    );
  });
});
