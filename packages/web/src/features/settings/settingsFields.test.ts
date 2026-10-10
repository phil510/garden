import { describe, expect, it } from 'vitest';
import {
  fieldsFromSettings,
  parseAuthors,
  parseMinutes,
  settingsProblem,
  toSettingsRequest,
  type SettingsFields,
} from './settingsFields';

const valid: SettingsFields = {
  claudeCommand: 'claude',
  ignoreAuthors: 'dependabot, renovate',
  quietWindowMinutes: '3',
  pollIntervalMinutes: '5',
};

describe('parseAuthors', () => {
  it('splits on commas and whitespace, dropping empties and repeats', () => {
    expect(parseAuthors(' a,b  c,, a\n d ')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is empty for blank text', () => {
    expect(parseAuthors('  ')).toEqual([]);
  });
});

describe('parseMinutes', () => {
  it('accepts whole numbers at or above the minimum', () => {
    expect(parseMinutes(' 0 ', 0)).toBe(0);
    expect(parseMinutes('12', 1)).toBe(12);
  });

  it.each(['', ' ', '1.5', '-1', 'abc', '1e2'])('rejects %j', (text) => {
    expect(parseMinutes(text, 0)).toBeNull();
  });

  it('rejects a value below the minimum', () => {
    expect(parseMinutes('0', 1)).toBeNull();
  });
});

describe('toSettingsRequest', () => {
  it('builds one request carrying every field', () => {
    expect(toSettingsRequest(valid)).toEqual({
      claudeCommand: 'claude',
      ignoreAuthors: ['dependabot', 'renovate'],
      quietWindowMinutes: 3,
      pollIntervalMinutes: 5,
    });
  });

  it.each<Partial<SettingsFields>>([
    { claudeCommand: '  ' },
    { quietWindowMinutes: '-1' },
    { pollIntervalMinutes: '0' },
  ])('is null when a field is invalid (%j)', (override) => {
    expect(toSettingsRequest({ ...valid, ...override })).toBeNull();
  });
});

describe('settingsProblem', () => {
  it('is null when every field is valid', () => {
    expect(settingsProblem(valid)).toBeNull();
  });

  it('blames the command, not the minutes, when only the command is blank', () => {
    expect(settingsProblem({ ...valid, claudeCommand: ' ' })).toMatch(/command/i);
  });

  it.each<Partial<SettingsFields>>([{ quietWindowMinutes: '-1' }, { pollIntervalMinutes: '0' }])(
    'blames the minutes when they are invalid (%j)',
    (override) => {
      expect(settingsProblem({ ...valid, ...override })).toMatch(/minutes/i);
    },
  );
});

describe('fieldsFromSettings', () => {
  it('round-trips through toSettingsRequest', () => {
    const settings = {
      deadSessionCap: 10,
      claudeCommand: 'claude',
      ignoreAuthors: ['a', 'b'],
      quietWindowMinutes: 0,
      pollIntervalMinutes: 5,
    };
    expect(toSettingsRequest(fieldsFromSettings(settings))).toEqual({
      claudeCommand: 'claude',
      ignoreAuthors: ['a', 'b'],
      quietWindowMinutes: 0,
      pollIntervalMinutes: 5,
    });
  });
});
