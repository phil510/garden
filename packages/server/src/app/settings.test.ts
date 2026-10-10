import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_FILE, patchConfigFile, readConfigFile } from '../config.js';
import type { ConfigPort } from './ports.js';
import { getSettings, updateSettings } from './settings.js';

function fakeConfigPort(overrides: Partial<ConfigPort> = {}): ConfigPort {
  return {
    read: () => {
      throw new Error('not used by this test');
    },
    write: () => {
      throw new Error('not used by this test');
    },
    ...overrides,
  };
}

describe('getSettings', () => {
  it("returns the deps' static fields plus the config port's live claudeCommand", () => {
    const result = getSettings({
      configPort: fakeConfigPort({
        read: () => ({ ...DEFAULT_CONFIG_FILE, claudeCommand: 'ec bedrock launch claude --' }),
      }),
      deadSessionCap: 25,
    });

    expect(result).toEqual({
      deadSessionCap: 25,
      claudeCommand: 'ec bedrock launch claude --',
      ignoreAuthors: [],
      quietWindowMinutes: 3,
      pollIntervalMinutes: 5,
    });
  });
});

describe('getSettings watch settings', () => {
  it('reports the values the config port holds right now', () => {
    let file = { ...DEFAULT_CONFIG_FILE };
    const deps = {
      configPort: fakeConfigPort({ read: () => file }),
      deadSessionCap: 10,
    };

    file = {
      ...file,
      ignoreAuthors: ['dependabot'],
      quietWindowMinutes: 0,
      pollIntervalMinutes: 9,
    };

    expect(getSettings(deps)).toMatchObject({
      ignoreAuthors: ['dependabot'],
      quietWindowMinutes: 0,
      pollIntervalMinutes: 9,
    });
  });
});

describe('settings round trip', () => {
  it('serves a saved value on the next read without a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'garden-settings-'));
    try {
      const path = join(dir, 'config.json');
      const deps = {
        configPort: {
          read: () => readConfigFile(path),
          write: (patch: Parameters<typeof patchConfigFile>[1]) => patchConfigFile(path, patch),
        },
        deadSessionCap: 10,
      };

      updateSettings(deps, { pollIntervalMinutes: 12, ignoreAuthors: ['bot'] });

      expect(getSettings(deps)).toMatchObject({ pollIntervalMinutes: 12, ignoreAuthors: ['bot'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('updateSettings', () => {
  const deps = () => {
    const writes: unknown[] = [];
    return {
      writes,
      deps: {
        configPort: fakeConfigPort({
          write: (patch) => {
            writes.push(patch);
          },
        }),
        deadSessionCap: 10,
      },
    };
  };

  it('writes a subset that omits claudeCommand', () => {
    const { writes, deps: d } = deps();
    updateSettings(d, { quietWindowMinutes: 0, ignoreAuthors: ['bot'] });
    expect(writes).toEqual([{ quietWindowMinutes: 0, ignoreAuthors: ['bot'] }]);
  });

  it.each([
    [{ quietWindowMinutes: -1 }],
    [{ quietWindowMinutes: 1.5 }],
    [{ pollIntervalMinutes: 0 }],
    [{ pollIntervalMinutes: 2.5 }],
    [{ ignoreAuthors: ['ok', 3] }],
    [{ ignoreAuthors: 'bot' }],
    [{ unknownKey: 1 }],
    [{}],
  ])('rejects %j without writing', (body) => {
    const { writes, deps: d } = deps();
    expect(() => updateSettings(d, body as never)).toThrow();
    expect(writes).toHaveLength(0);
  });

  it('validates claudeCommand before calling write', () => {
    const writes: unknown[] = [];
    const deps = {
      configPort: fakeConfigPort({
        write: (patch) => {
          writes.push(patch);
        },
      }),
      deadSessionCap: 10,
    };

    for (const invalid of ['', '   ']) {
      expect(() => updateSettings(deps, { claudeCommand: invalid })).toThrow(/claudeCommand/);
    }
    expect(writes).toHaveLength(0);
  });

  it('calls configPort.write with the validated patch', () => {
    const writes: unknown[] = [];
    const deps = {
      configPort: fakeConfigPort({
        write: (patch) => {
          writes.push(patch);
        },
      }),
      deadSessionCap: 10,
    };

    updateSettings(deps, { claudeCommand: 'tsx scripts/fake-claude.ts' });

    expect(writes).toEqual([{ claudeCommand: 'tsx scripts/fake-claude.ts' }]);
  });

  it("lets the port's refusal propagate rather than swallowing it", () => {
    const deps = {
      configPort: fakeConfigPort({
        write: () => {
          throw new Error('existing file is invalid');
        },
      }),
      deadSessionCap: 10,
    };

    expect(() => updateSettings(deps, { claudeCommand: 'claude' })).toThrow(
      'existing file is invalid',
    );
  });
});
