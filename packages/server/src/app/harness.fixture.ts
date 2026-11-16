import { claudeCommand } from '../domain/claudeCommands.js';
import { parseClaudeHook } from '../domain/claudeHooks.js';
import type { HarnessPort } from './ports.js';

export function fakeClaudeHarness(
  settingsPath = '/unused/settings.json',
  readCommand: () => readonly string[] = () => ['claude'],
): HarnessPort {
  return {
    spawnCommand: (request) => claudeCommand(readCommand(), 'spawn', settingsPath, request),
    resumeCommand: (request) => claudeCommand(readCommand(), 'resume', settingsPath, request),
    parseHook: parseClaudeHook,
    transcripts: {
      listFiles: () => Promise.resolve([]),
      accepts: () => false,
      readRecord: () => Promise.resolve(null),
    },
    readSessionNames: () => Promise.resolve({ names: {}, skipped: 0 }),
  };
}
