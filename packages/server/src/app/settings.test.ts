import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_FILE } from '../config.js';
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
      terminalFontSize: 18,
    });

    expect(result).toEqual({
      deadSessionCap: 25,
      terminalFontSize: 18,
      claudeCommand: 'ec bedrock launch claude --',
    });
  });
});

describe('updateSettings', () => {
  it('validates claudeCommand before calling write', () => {
    const writes: unknown[] = [];
    const deps = {
      configPort: fakeConfigPort({
        write: (patch) => {
          writes.push(patch);
        },
      }),
      deadSessionCap: 10,
      terminalFontSize: 13,
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
      terminalFontSize: 13,
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
      terminalFontSize: 13,
    };

    expect(() => updateSettings(deps, { claudeCommand: 'claude' })).toThrow(
      'existing file is invalid',
    );
  });
});
