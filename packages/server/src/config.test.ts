import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('reads the port from GARDEN_PORT', () => {
    expect(loadConfig({ GARDEN_PORT: '5000' }).port).toBe(5000);
  });

  it('falls back to the default port when GARDEN_PORT is unset', () => {
    expect(loadConfig({}).port).toBe(loadConfig({ GARDEN_PORT: '' }).port);
  });

  it('treats an empty GARDEN_PORT as unset rather than as an error', () => {
    expect(() => loadConfig({ GARDEN_PORT: '' })).not.toThrow();
  });

  it.each(['0', '65536', '4310.5', 'abc'])('rejects GARDEN_PORT=%s', (raw) => {
    expect(() => loadConfig({ GARDEN_PORT: raw })).toThrow(/GARDEN_PORT/);
  });
});
