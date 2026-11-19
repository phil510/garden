import type { TranscriptParse } from '../../domain/transcript.js'

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function messageText(payload: Record<string, unknown>, role: 'user' | 'assistant'): string | null {
  const content = payload['content']
  if (!Array.isArray(content)) return null
  const metadata = object(payload['internal_chat_message_metadata_passthrough'])
  const kinds = metadata?.['content_item_kinds']
  return text(
    content
      .flatMap((value: unknown, index) => {
        const part = object(value)
        if (part?.['type'] !== (role === 'user' ? 'input_text' : 'output_text')) return []
        // Native annotations distinguish typed input from injected user-role context.
        if (role === 'user' && Array.isArray(kinds) && kinds[index] !== 'user.text') return []
        return text(part['text']) ?? []
      })
      .join('\n'),
  )
}

/** The alias, rather than a rollout's native id, supplies the public session identity. */
export function parseCodexTranscript(contents: string, sessionId: string): TranscriptParse {
  let cwd: string | null = null
  let lastPrompt: string | null = null
  let recap: string | null = null
  let legacyPrompt: string | null = null
  let legacyRecap: string | null = null
  let lastActivity: number | null = null
  let skipped = 0
  for (const raw of contents.split('\n')) {
    if (raw.trim() === '') continue
    let line: Record<string, unknown> | null
    try {
      line = object(JSON.parse(raw))
    } catch {
      line = null
    }
    if (line === null) {
      skipped += 1
      continue
    }
    const timestamp = text(line['timestamp'])
    if (timestamp !== null && !Number.isNaN(Date.parse(timestamp)))
      lastActivity = Date.parse(timestamp)
    const payload = object(line['payload'])
    if (payload === null) continue
    if (line['type'] === 'session_meta' || line['type'] === 'turn_context') {
      cwd = text(payload['cwd']) ?? cwd
    }
    const phase = payload['phase']
    const isAnswer = phase === 'final_answer' || phase === undefined || phase === null
    if (line['type'] === 'event_msg') {
      if (payload['type'] === 'user_message')
        legacyPrompt = text(payload['message']) ?? legacyPrompt
      if (payload['type'] === 'agent_message' && isAnswer)
        legacyRecap = text(payload['message']) ?? legacyRecap
    }
    if (line['type'] === 'response_item' && payload['type'] === 'message') {
      if (payload['role'] === 'user') lastPrompt = messageText(payload, 'user') ?? lastPrompt
      if (payload['role'] === 'assistant' && isAnswer) {
        recap = messageText(payload, 'assistant') ?? recap
      }
    }
  }
  // Older rollouts mirror messages as events; prefer the native message representation.
  return {
    record: {
      sessionId,
      cwd,
      title: null,
      lastPrompt: lastPrompt ?? legacyPrompt,
      recap: recap ?? legacyRecap,
      lastActivity,
    },
    skipped,
  }
}
