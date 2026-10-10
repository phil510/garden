import type { SettingsRequest, SettingsResponse } from '@garden/shared';
import {
  isClaudeCommand,
  isIgnoreAuthors,
  isPollIntervalMinutes,
  isQuietWindowMinutes,
} from '../config.js';
import type { ConfigPort } from './ports.js';

/** `deadSessionCap` stays a boot-time-static dep — the editable keys go
 *  through the `ConfigPort` for a live read. */
export interface SettingsDeps {
  readonly configPort: ConfigPort;
  readonly deadSessionCap: number;
}

/**
 * Reads `configPort.read()`'s raw `ConfigFile.claudeCommand` string — never the value resolved
 * through `GARDEN_CLAUDE_COMMAND` that `readClaudeCommand()` gives session spawning. Displaying
 * (and, on save, round-tripping) the resolved value would leak an active override into
 * `config.json`.
 */
export function getSettings(deps: SettingsDeps): SettingsResponse {
  const file = deps.configPort.read();
  return {
    deadSessionCap: deps.deadSessionCap,
    claudeCommand: file.claudeCommand,
    ignoreAuthors: [...file.ignoreAuthors],
    quietWindowMinutes: file.quietWindowMinutes,
    pollIntervalMinutes: file.pollIntervalMinutes,
  };
}

const WRITABLE_KEYS = [
  'claudeCommand',
  'ignoreAuthors',
  'quietWindowMinutes',
  'pollIntervalMinutes',
] as const;

const VALID_VALUE: Record<(typeof WRITABLE_KEYS)[number], (value: unknown) => boolean> = {
  claudeCommand: isClaudeCommand,
  ignoreAuthors: isIgnoreAuthors,
  quietWindowMinutes: isQuietWindowMinutes,
  pollIntervalMinutes: isPollIntervalMinutes,
};

/** The first problem with `body` as a settings patch, or null when it is a non-empty subset of
 *  the writable keys with valid values. Unknown keys are a problem, not ignored. */
export function settingsRequestProblem(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'settings request must be an object';
  }
  const entries = Object.entries(body);
  if (entries.length === 0) return 'settings request must set at least one key';
  for (const [key, value] of entries) {
    const valid = (WRITABLE_KEYS as readonly string[]).includes(key)
      ? VALID_VALUE[key as (typeof WRITABLE_KEYS)[number]]
      : undefined;
    if (valid === undefined) return `unknown setting "${key}"`;
    if (!valid(value)) return `invalid value for "${key}"`;
  }
  return null;
}

/** Validates before writing; the port's refusal (an unusable on-disk file) propagates
 *  uncaught for the caller to map. */
export function updateSettings(deps: SettingsDeps, request: SettingsRequest): void {
  const problem = settingsRequestProblem(request);
  if (problem !== null) throw new Error(problem);
  deps.configPort.write(request);
}
