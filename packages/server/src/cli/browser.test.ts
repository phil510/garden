import { describe, expect, it } from 'vitest';
import { chromeInstalled, chromeWindowArgs } from './browser.js';

describe('chromeInstalled', () => {
  it('reflects whatever the injected existence check reports', () => {
    expect(chromeInstalled(() => true)).toBe(true);
    expect(chromeInstalled(() => false)).toBe(false);
  });
});

describe('chromeWindowArgs', () => {
  it('passes -n so `open` launches a new instance and forwards --args to Chrome', () => {
    expect(chromeWindowArgs('http://localhost:1234')).toEqual([
      'open',
      ['-na', 'Google Chrome', '--args', '--app=http://localhost:1234'],
    ]);
  });
});
