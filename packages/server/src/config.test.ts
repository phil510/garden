import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appDirPath,
  configFilePath,
  ConfigWriteRefusedError,
  DEFAULT_CONFIG_FILE,
  ensureConfigFile,
  loadConfig,
  parseConfigFile,
  patchConfigFile,
  readConfigFile,
  resolveClaudeCommand,
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
      loadConfig({ GARDEN_PORT: '5000' }, { ...DEFAULT_CONFIG_FILE, port: 4400, roots: [] }, '/h')
        .port,
    ).toBe(5000);
  });

  it('falls back to the config file port when GARDEN_PORT is unset', () => {
    expect(loadConfig({}, { ...DEFAULT_CONFIG_FILE, port: 4400, roots: [] }, '/h').port).toBe(4400);
  });

  it('expands a leading ~ in a root against the given home and leaves absolute roots alone', () => {
    const config = loadConfig(
      {},
      { ...DEFAULT_CONFIG_FILE, roots: ['~/Desktop/Extend', '/srv/code'] },
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

  it('passes a file-configured permissionMode through unchanged, with no env override', () => {
    expect(
      loadConfig(
        {},
        { ...DEFAULT_CONFIG_FILE, roots: [], permissionMode: 'bypassPermissions' },
        '/h',
      ).permissionMode,
    ).toBe('bypassPermissions');
  });
});

describe('resolveClaudeCommand', () => {
  // main.ts's readClaudeCommand binding calls this against a fresh configPort.read() on every
  // session spawn; the override must keep winning across those changing reads, not just once.
  it('keeps GARDEN_CLAUDE_COMMAND winning as the file value changes between calls', () => {
    const env = { GARDEN_CLAUDE_COMMAND: 'ec bedrock launch claude --' };
    expect(resolveClaudeCommand(env, { claudeCommand: 'claude' })).toEqual([
      'ec',
      'bedrock',
      'launch',
      'claude',
      '--',
    ]);
    expect(resolveClaudeCommand(env, { claudeCommand: 'tsx scripts/fake-claude.ts' })).toEqual([
      'ec',
      'bedrock',
      'launch',
      'claude',
      '--',
    ]);
  });

  it('splits GARDEN_CLAUDE_COMMAND on whitespace', () => {
    expect(
      resolveClaudeCommand(
        { GARDEN_CLAUDE_COMMAND: 'tsx  scripts/fake-claude.ts' },
        DEFAULT_CONFIG_FILE,
      ),
    ).toEqual(['tsx', 'scripts/fake-claude.ts']);
  });

  it('defaults to ["claude"] when GARDEN_CLAUDE_COMMAND is unset and the file names no command', () => {
    expect(resolveClaudeCommand({}, DEFAULT_CONFIG_FILE)).toEqual(['claude']);
  });

  it('falls back when GARDEN_CLAUDE_COMMAND names no command', () => {
    // An empty argv would put the session flag in argv[0] at spawn time, which
    // fails far from here; a value that splits to nothing is treated as unset.
    for (const raw of ['', '   ', '\t\n']) {
      expect(resolveClaudeCommand({ GARDEN_CLAUDE_COMMAND: raw }, DEFAULT_CONFIG_FILE)).toEqual([
        'claude',
      ]);
    }
  });

  it('prefers GARDEN_CLAUDE_COMMAND over the claudeCommand in the config file', () => {
    expect(
      resolveClaudeCommand(
        { GARDEN_CLAUDE_COMMAND: 'tsx scripts/fake-claude.ts' },
        { claudeCommand: 'ec bedrock launch claude --' },
      ),
    ).toEqual(['tsx', 'scripts/fake-claude.ts']);
  });

  it('splits the file-configured claudeCommand on whitespace when GARDEN_CLAUDE_COMMAND is unset', () => {
    expect(resolveClaudeCommand({}, { claudeCommand: 'ec  bedrock launch claude --' })).toEqual([
      'ec',
      'bedrock',
      'launch',
      'claude',
      '--',
    ]);
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

  it('rejects a deadSessionCap of the wrong type', () => {
    expect(() => parseConfigFile('{"deadSessionCap": "10"}', '/c.json')).toThrow(
      /"deadSessionCap"/,
    );
  });

  it.each([0, 1001])('rejects a deadSessionCap outside the valid range (%d)', (value) => {
    expect(() => parseConfigFile(`{"deadSessionCap": ${String(value)}}`, '/c.json')).toThrow(
      /"deadSessionCap"/,
    );
  });

  it('resolves a valid deadSessionCap', () => {
    expect(parseConfigFile('{"deadSessionCap": 25}', '/c.json').deadSessionCap).toBe(25);
  });

  it('rejects a terminalFontSize of the wrong type', () => {
    expect(() => parseConfigFile('{"terminalFontSize": "13"}', '/c.json')).toThrow(
      /"terminalFontSize"/,
    );
  });

  it.each([5, 73])('rejects a terminalFontSize outside the valid range (%d)', (value) => {
    expect(() => parseConfigFile(`{"terminalFontSize": ${String(value)}}`, '/c.json')).toThrow(
      /"terminalFontSize"/,
    );
  });

  it('resolves a valid terminalFontSize', () => {
    expect(parseConfigFile('{"terminalFontSize": 18}', '/c.json').terminalFontSize).toBe(18);
  });

  it.each([1, '', '   '])('rejects a claudeCommand of the wrong type or blank (%j)', (value) => {
    expect(() => parseConfigFile(`{"claudeCommand": ${JSON.stringify(value)}}`, '/c.json')).toThrow(
      /"claudeCommand"/,
    );
  });

  it('names the source path in the claudeCommand rejection message', () => {
    expect(() => parseConfigFile('{"claudeCommand": ""}', '/h/.garden/config.json')).toThrow(
      /^\/h\/\.garden\/config\.json: "claudeCommand"/,
    );
  });

  it('resolves a valid claudeCommand', () => {
    expect(
      parseConfigFile('{"claudeCommand": "ec bedrock launch claude --"}', '/c.json').claudeCommand,
    ).toBe('ec bedrock launch claude --');
  });

  it('defaults claudeCommand to "claude" when the file omits it', () => {
    expect(parseConfigFile('{}', '/c.json').claudeCommand).toBe('claude');
  });
});

describe('ensureConfigFile', () => {
  let home: string;
  let configPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'garden-config-'));
    configPath = join(home, '.garden', 'config.json');
    mkdirSync(join(home, '.garden'), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('writes and returns the default config when no file is present', () => {
    const logger = { warn: vi.fn() };
    expect(ensureConfigFile(home, logger)).toEqual(DEFAULT_CONFIG_FILE);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(DEFAULT_CONFIG_FILE);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to defaults, warns, and leaves the file untouched on malformed JSON', () => {
    writeFileSync(configPath, '{ not valid json', 'utf8');
    const logger = { warn: vi.fn() };

    expect(ensureConfigFile(home, logger)).toEqual(DEFAULT_CONFIG_FILE);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0]?.[0] as string;
    expect(message).toContain('not valid JSON');
    // The path must appear so the operator knows which file to fix, but only once —
    // parseConfigFile's error message already names it, so the warning must not repeat it.
    expect(message.split(configPath)).toHaveLength(2);
    expect(readFileSync(configPath, 'utf8')).toBe('{ not valid json');
  });

  it('falls back to defaults, warns, and leaves the file untouched when one field is invalid', () => {
    writeFileSync(configPath, JSON.stringify({ port: 0 }), 'utf8');
    const logger = { warn: vi.fn() };

    expect(ensureConfigFile(home, logger)).toEqual(DEFAULT_CONFIG_FILE);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0]?.[0] as string;
    expect(message).toContain('"port" must be an integer between 1 and 65535');
    expect(message.split(configPath)).toHaveLength(2);
    expect(readFileSync(configPath, 'utf8')).toBe(JSON.stringify({ port: 0 }));
  });

  it('round-trips a valid file unchanged, without warning', () => {
    const file = { ...DEFAULT_CONFIG_FILE, port: 5000 };
    writeFileSync(configPath, JSON.stringify(file), 'utf8');
    const logger = { warn: vi.fn() };

    expect(ensureConfigFile(home, logger)).toEqual(file);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

function withTempAppDir(fn: (appDir: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'garden-config-write-'));
  try {
    fn(join(home, '.garden'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('readConfigFile', () => {
  it('resolves the defaults when no file is present', () => {
    withTempAppDir((appDir) => {
      expect(readConfigFile(configFilePath(appDir))).toEqual(DEFAULT_CONFIG_FILE);
    });
  });

  it('resolves the defaults when the file is unusable, without writing or throwing', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);
      writeFileSync(path, '{ not valid json', 'utf8');
      expect(readConfigFile(path)).toEqual(DEFAULT_CONFIG_FILE);
      expect(readFileSync(path, 'utf8')).toBe('{ not valid json');
    });
  });

  it("resolves a valid file's claudeCommand verbatim, not the default", () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);
      writeFileSync(
        path,
        JSON.stringify({ ...DEFAULT_CONFIG_FILE, claudeCommand: 'ec bedrock launch claude --' }),
        'utf8',
      );
      expect(readConfigFile(path).claudeCommand).toBe('ec bedrock launch claude --');
    });
  });

  it('recovers a valid claudeCommand even when a sibling field fails validation', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);
      writeFileSync(
        path,
        JSON.stringify({
          ...DEFAULT_CONFIG_FILE,
          port: 99999,
          claudeCommand: 'ec bedrock launch claude --',
        }),
        'utf8',
      );
      expect(readConfigFile(path).claudeCommand).toBe('ec bedrock launch claude --');
    });
  });

  it('falls back to the default claudeCommand when the field itself is invalid, sibling errors aside', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);
      writeFileSync(path, JSON.stringify({ port: 99999, claudeCommand: '' }), 'utf8');
      expect(readConfigFile(path).claudeCommand).toBe(DEFAULT_CONFIG_FILE.claudeCommand);
    });
  });
});

describe('patchConfigFile', () => {
  it('round-trips a patch against a missing file, merged over the defaults, with no stray .tmp', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);

      patchConfigFile(path, { claudeCommand: 'ec bedrock launch claude --' });

      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
        ...DEFAULT_CONFIG_FILE,
        claudeCommand: 'ec bedrock launch claude --',
      });
      expect(existsSync(`${path}.tmp`)).toBe(false);
    });
  });

  it('throws and leaves the file untouched when the existing file is invalid JSON', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);
      writeFileSync(path, '{ not valid json', 'utf8');

      expect(() => patchConfigFile(path, { claudeCommand: 'claude' })).toThrow(
        ConfigWriteRefusedError,
      );
      expect(readFileSync(path, 'utf8')).toBe('{ not valid json');
      expect(existsSync(`${path}.tmp`)).toBe(false);
    });
  });

  it('throws and leaves the file untouched when an existing field fails validation', () => {
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);
      const original = JSON.stringify({ port: 0 });
      writeFileSync(path, original, 'utf8');

      expect(() => patchConfigFile(path, { claudeCommand: 'claude' })).toThrow(
        ConfigWriteRefusedError,
      );
      expect(readFileSync(path, 'utf8')).toBe(original);
    });
  });

  it('merges the patch over the raw file, not over every ConfigFile default', () => {
    // The case a round-trip test alone can't catch: a sparse file that only ever set one key
    // must stay sparse plus the patch, not gain the other four ConfigFile fields' defaults.
    withTempAppDir((appDir) => {
      mkdirSync(appDir, { recursive: true });
      const path = configFilePath(appDir);
      writeFileSync(path, JSON.stringify({ port: 5000 }), 'utf8');

      patchConfigFile(path, { claudeCommand: 'claude' });

      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
        port: 5000,
        claudeCommand: 'claude',
      });
    });
  });
});
