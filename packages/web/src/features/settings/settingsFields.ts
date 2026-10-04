import type { SettingsRequest, SettingsResponse } from '@garden/shared';

/** The modal's editable fields as the strings the inputs hold. */
export interface SettingsFields {
  claudeCommand: string;
  ignoreAuthors: string;
  quietWindowMinutes: string;
  pollIntervalMinutes: string;
}

export function fieldsFromSettings(settings: SettingsResponse): SettingsFields {
  return {
    claudeCommand: settings.claudeCommand,
    ignoreAuthors: settings.ignoreAuthors.join(', '),
    quietWindowMinutes: String(settings.quietWindowMinutes),
    pollIntervalMinutes: String(settings.pollIntervalMinutes),
  };
}

/** Splits on commas and whitespace; drops empties and repeats, keeping first-seen order. */
export function parseAuthors(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

/** A whole number of at least `min`, or null — blank, fractional and non-numeric text are all invalid. */
export function parseMinutes(text: string, min: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min ? value : null;
}

/** The message naming the invalid field, or null when every field is valid. */
export function settingsProblem(fields: SettingsFields): string | null {
  if (fields.claudeCommand.trim() === '') return 'Claude command must not be blank.';
  if (
    parseMinutes(fields.quietWindowMinutes, 0) === null ||
    parseMinutes(fields.pollIntervalMinutes, 1) === null
  ) {
    return 'Minutes must be whole numbers: quiet window 0 or more, poll interval 1 or more.';
  }
  return null;
}

/** The request the fields describe, or null when any field is invalid. */
export function toSettingsRequest(fields: SettingsFields): Required<SettingsRequest> | null {
  const quietWindowMinutes = parseMinutes(fields.quietWindowMinutes, 0);
  const pollIntervalMinutes = parseMinutes(fields.pollIntervalMinutes, 1);
  if (fields.claudeCommand.trim() === '') return null;
  if (quietWindowMinutes === null || pollIntervalMinutes === null) return null;
  return {
    claudeCommand: fields.claudeCommand,
    ignoreAuthors: parseAuthors(fields.ignoreAuthors),
    quietWindowMinutes,
    pollIntervalMinutes,
  };
}
