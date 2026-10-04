import type { SettingsRequest, SettingsResponse } from '@garden/shared';
import { isClaudeCommand } from '../config.js';
import type { ConfigPort } from './ports.js';

/** `deadSessionCap` and `terminalFontSize` stay boot-time-static deps — only `claudeCommand`
 *  is editable, so only it goes through the `ConfigPort` for a live read. */
export interface SettingsDeps {
  readonly configPort: ConfigPort;
  readonly deadSessionCap: number;
  readonly terminalFontSize: number;
}

/**
 * Reads `configPort.read()`'s raw `ConfigFile.claudeCommand` string — never the value resolved
 * through `GARDEN_CLAUDE_COMMAND` that `readClaudeCommand()` gives session spawning. Displaying
 * (and, on save, round-tripping) the resolved value would leak an active override into
 * `config.json`.
 */
export function getSettings(deps: SettingsDeps): SettingsResponse {
  return {
    deadSessionCap: deps.deadSessionCap,
    terminalFontSize: deps.terminalFontSize,
    claudeCommand: deps.configPort.read().claudeCommand,
    ignoreAuthors: [],
    quietWindowMinutes: 3,
    pollIntervalMinutes: 5,
  };
}

/** Validates before writing; the port's refusal (an unusable on-disk file) propagates
 *  uncaught for the caller to map. */
export function updateSettings(deps: SettingsDeps, request: SettingsRequest): void {
  if (!isClaudeCommand(request.claudeCommand)) {
    throw new Error('claudeCommand must be a non-empty string');
  }
  deps.configPort.write({ claudeCommand: request.claudeCommand });
}
