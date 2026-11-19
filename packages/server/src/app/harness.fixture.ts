import type { HarnessPort } from './ports.js'

export function fakeHarness(): HarnessPort {
  return {
    spawnCommand: () => ['harness-spawn'],
    resumeCommand: () => ['harness-resume'],
    parseHook: () => null,
    transcripts: {
      listFiles: () => Promise.resolve([]),
      accepts: () => false,
      readRecord: () => Promise.resolve(null),
    },
    readSessionMetadata: () => Promise.resolve({ names: {}, skipped: 0 }),
  }
}
