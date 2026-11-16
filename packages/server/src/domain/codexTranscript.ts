import type { TranscriptParse } from './transcript.js';

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The alias, rather than a rollout's native id, supplies the public session identity. */
export function parseCodexTranscript(contents: string, sessionId: string): TranscriptParse {
  let cwd: string | null = null;
  let lastPrompt: string | null = null;
  let recap: string | null = null;
  let lastActivity: number | null = null;
  let skipped = 0;
  for (const raw of contents.split('\n')) {
    if (raw.trim() === '') continue;
    let line: Record<string, unknown> | null;
    try {
      line = object(JSON.parse(raw));
    } catch {
      line = null;
    }
    if (line === null) {
      skipped += 1;
      continue;
    }
    const timestamp = text(line['timestamp']);
    if (timestamp !== null && !Number.isNaN(Date.parse(timestamp)))
      lastActivity = Date.parse(timestamp);
    const payload = object(line['payload']);
    if (payload === null) continue;
    if (line['type'] === 'session_meta' || line['type'] === 'turn_context') {
      cwd = text(payload['cwd']) ?? cwd;
    }
    if (line['type'] === 'event_msg') {
      if (payload['type'] === 'user_message') lastPrompt = text(payload['message']) ?? lastPrompt;
      if (payload['type'] === 'agent_message') recap = text(payload['message']) ?? recap;
    }
  }
  return { record: { sessionId, cwd, title: null, lastPrompt, recap, lastActivity }, skipped };
}
