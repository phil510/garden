import { describe, expect, it } from 'vitest';
import { paneCloseDisposition } from './paneSocket';

describe('paneCloseDisposition', () => {
  it('disposes when the server refused a state no retry moves', () => {
    expect(paneCloseDisposition(4000)).toBe('dispose');
    expect(paneCloseDisposition(4001)).toBe('dispose');
    expect(paneCloseDisposition(4004)).toBe('dispose');
  });

  it('disposes on a normal close, which is the pty having exited', () => {
    expect(paneCloseDisposition(1000)).toBe('dispose');
  });

  it('reconnects on a refusal the server can stop making', () => {
    expect(paneCloseDisposition(4009)).toBe('reconnect');
    expect(paneCloseDisposition(4500)).toBe('reconnect');
  });

  it('reconnects on a close the server never attributed to a state', () => {
    expect(paneCloseDisposition(1006)).toBe('reconnect');
    expect(paneCloseDisposition(1001)).toBe('reconnect');
    expect(paneCloseDisposition(1011)).toBe('reconnect');
  });
});
