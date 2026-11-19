import type { SessionState } from '@garden/shared'
import { AmbiguousSessionNameError, SessionNotFoundError } from './errors.js'

export function resolveSessionTarget(
  sessions: readonly SessionState[],
  target: string,
): SessionState {
  const exactId = sessions.find((candidate) => candidate.id === target)
  if (exactId !== undefined) return exactId

  const matches = sessions.filter((candidate) => target !== '' && candidate.sessionName === target)
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) throw new SessionNotFoundError(`no such session: ${target}`)

  const ids = matches.map((candidate) => candidate.id).sort()
  throw new AmbiguousSessionNameError(
    `ambiguous session name ${JSON.stringify(target)}. Matching IDs: ${ids.join(', ')}`,
  )
}
