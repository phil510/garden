import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appDirPath,
  DEFAULT_CONFIG_FILE,
  loadConfig,
  parseConfigFile,
  TMUX_SOCKET,
} from './config.js';

describe('loadConfig', () => {
  it('reads the port from GARDEN_PORT', () => {
    expect(loadConfig({ GARDEN_PORT: '5000' }, DEFAULT_CONFIG_FILE, '/h').port).toBe(5000);
  });

  it('treats an empty GARDEN_PORT as unset rather than as an error', () => {
    expect(loadConfig({ GARDEN_PORT: '' }, DEFAULT_CONFIG_FILE, '/h').port).toBe(
      DEFAULT_CONFIG_FILE.port,
    );
  });

  it.each(['0', '65536', '4310.5', 'abc'])('rejects GARDEN_PORT=%s', (raw) => {
    expect(() => loadConfig({ GARDEN_PORT: raw }, DEFAULT_CONFIG_FILE, '/h')).toThrow(
      /GARDEN_PORT/,
    );
  });
});

describe('loadConfig precedence and root expansion', () => {
  it('prefers GARDEN_PORT over the port in the config file', () => {
    expect(
      loadConfig(
        { GARDEN_PORT: '5000' },
        { port: 4400, roots: [], permissionMode: 'default' },
        '/h',
      ).port,
    ).toBe(5000);
  });

  it('falls back to the config file port when GARDEN_PORT is unset', () => {
    expect(loadConfig({}, { port: 4400, roots: [], permissionMode: 'default' }, '/h').port).toBe(
      4400,
    );
  });

  it('expands a leading ~ in a root against the given home and leaves absolute roots alone', () => {
    const config = loadConfig(
      {},
      { port: 4310, roots: ['~/Desktop/Extend', '/srv/code'], permissionMode: 'default' },
      '/h',
    );
    expect(config.roots).toEqual(['/h/Desktop/Extend', '/srv/code']);
  });

  it('reads the tmux socket from GARDEN_TMUX_SOCKET', () => {
    expect(
      loadConfig({ GARDEN_TMUX_SOCKET: 'garden-sandbox' }, DEFAULT_CONFIG_FILE, '/h').tmuxSocket,
    ).toBe('garden-sandbox');
  });

  it('falls back to the default tmux socket when GARDEN_TMUX_SOCKET is unset', () => {
    expect(loadConfig({}, DEFAULT_CONFIG_FILE, '/h').tmuxSocket).toBe(TMUX_SOCKET);
  });

  it('reads the app dir from GARDEN_APP_DIR', () => {
    expect(
      loadConfig({ GARDEN_APP_DIR: '/tmp/sandbox-app' }, DEFAULT_CONFIG_FILE, '/h').appDir,
    ).toBe('/tmp/sandbox-app');
  });

  it('falls back to the default app dir when GARDEN_APP_DIR is unset', () => {
    expect(loadConfig({}, DEFAULT_CONFIG_FILE, '/h').appDir).toBe(appDirPath('/h', {}));
  });

  it('reads the transcripts dir from GARDEN_TRANSCRIPTS_DIR', () => {
    expect(
      loadConfig({ GARDEN_TRANSCRIPTS_DIR: '/tmp/sandbox-transcripts' }, DEFAULT_CONFIG_FILE, '/h')
        .transcriptsDir,
    ).toBe('/tmp/sandbox-transcripts');
  });

  it('falls back to a transcripts dir under the given home when GARDEN_TRANSCRIPTS_DIR is unset', () => {
    const config = loadConfig({}, DEFAULT_CONFIG_FILE, '/h');
    expect(config.transcriptsDir).toBe(join('/h', '.claude', 'projects'));
  });

  it('splits GARDEN_CLAUDE_COMMAND on whitespace', () => {
    expect(
      loadConfig(
        { GARDEN_CLAUDE_COMMAND: 'tsx  scripts/fake-claude.ts' },
        DEFAULT_CONFIG_FILE,
        '/h',
      ).claudeCommand,
    ).toEqual(['tsx', 'scripts/fake-claude.ts']);
  });

  it('defaults claudeCommand to ["claude"] when GARDEN_CLAUDE_COMMAND is unset', () => {
    expect(loadConfig({}, DEFAULT_CONFIG_FILE, '/h').claudeCommand).toEqual(['claude']);
  });

  it('falls back when GARDEN_CLAUDE_COMMAND names no command', () => {
    // An empty argv would put the session flag in argv[0] at spawn time, which
    // fails far from here; a value that splits to nothing is treated as unset.
    for (const raw of ['', '   ', '\t\n']) {
      expect(
        loadConfig({ GARDEN_CLAUDE_COMMAND: raw }, DEFAULT_CONFIG_FILE, '/h').claudeCommand,
      ).toEqual(['claude']);
    }
  });

  it('passes a file-configured permissionMode through unchanged, with no env override', () => {
    expect(
      loadConfig({}, { port: 4310, roots: [], permissionMode: 'bypassPermissions' }, '/h')
        .permissionMode,
    ).toBe('bypassPermissions');
  });
});

describe('appDirPath', () => {
  it('prefers GARDEN_APP_DIR over the home-derived default', () => {
    expect(appDirPath('/h', { GARDEN_APP_DIR: '/tmp/sandbox-app' })).toBe('/tmp/sandbox-app');
  });

  it('treats an empty GARDEN_APP_DIR as unset', () => {
    expect(appDirPath('/h', { GARDEN_APP_DIR: '' })).toBe(appDirPath('/h', {}));
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

  it('resolves a valid permissionMode', () => {
    expect(
      parseConfigFile('{"permissionMode":"bypassPermissions"}', '/c.json').permissionMode,
    ).toBe('bypassPermissions');
  });

  it('rejects an unrecognized permissionMode', () => {
    expect(() => parseConfigFile('{"permissionMode":"yolo"}', '/c.json')).toThrow(
      /"permissionMode"/,
    );
  });

  it('supplies defaults for keys the file omits', () => {
    expect(parseConfigFile('{}', '/c.json')).toEqual(DEFAULT_CONFIG_FILE);
  });
});
