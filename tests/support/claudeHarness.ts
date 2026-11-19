import { claudeCommand } from '../../packages/server/src/adapters/claude/commands.js'
import { parseClaudeHook } from '../../packages/server/src/adapters/claude/hooks.js'
import type { HarnessPort } from '../../packages/server/src/app/ports.js'

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
    readSessionMetadata: () => Promise.resolve({ names: {}, skipped: 0 }),
  }
}
