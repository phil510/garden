import { describe, expect, it } from 'vitest';
import { chromeInstalled } from './browser.js';

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
