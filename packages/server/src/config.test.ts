import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfigFile } from './config.js';

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

describe('loadConfig precedence and root expansion', () => {
  it('prefers GARDEN_PORT over the port in the config file', () => {
    expect(loadConfig({ GARDEN_PORT: '5000' }, { port: 4400, roots: [] }, '/h').port).toBe(5000);
  });

  it('falls back to the config file port when GARDEN_PORT is unset', () => {
    expect(loadConfig({}, { port: 4400, roots: [] }, '/h').port).toBe(4400);
  });

  it('expands a leading ~ in a root against the given home and leaves absolute roots alone', () => {
    const config = loadConfig({}, { port: 4310, roots: ['~/Desktop/Extend', '/srv/code'] }, '/h');
    expect(config.roots).toEqual(['/h/Desktop/Extend', '/srv/code']);
  });
});

describe('parseConfigFile', () => {
  it('names the file in the error when the JSON is malformed', () => {
    expect(() => parseConfigFile('{ port: ', '/h/.garden/config.json')).toThrow(
      /\/h\/\.garden\/config\.json is not valid JSON/,
    );
  });

  it('rejects a roots value that is not an array of strings', () => {
    expect(() => parseConfigFile('{"roots": "~/code"}', '/c.json')).toThrow(/"roots"/);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => parseConfigFile('{"port": 0}', '/c.json')).toThrow(/"port"/);
  });

  it('supplies defaults for keys the file omits', () => {
    expect(parseConfigFile('{}', '/c.json')).toEqual({ port: 4310, roots: ['~/Desktop/Extend'] });
  });
});
