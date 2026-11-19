import type { HarnessSignal } from '../domain/types.js'
import { dropSessionWatches } from '../domain/watches.js'
import type { HarnessPort, LiveTranscripts } from './ports.js'
import type { Projection } from './projection.js'
import { updateWatches } from './watches.js'

export interface HooksDeps {
  readonly projection: Projection
  readonly harness: Pick<HarnessPort, 'parseHook'>
  readonly liveTranscripts: LiveTranscripts
}

export function handleHook(
  deps: HooksDeps,
  body: unknown,
  gardenSessionId: string | undefined,
): boolean {
  const signal = deps.harness.parseHook(body, gardenSessionId)
  if (signal === null) return false
  applyHarnessSignal(deps, signal)
  return true
}

export function applyHarnessSignal(
  deps: Pick<HooksDeps, 'projection' | 'liveTranscripts'>,
  signal: HarnessSignal,
): void {
  if (signal.transcriptPath !== null) deps.liveTranscripts.track(signal.transcriptPath)
  deps.projection.dispatch({ type: 'harness-signal', signal })
  if (signal.conversationCleared)
    updateWatches(deps, (watches) => dropSessionWatches(watches, signal.sessionId), Date.now())
}
