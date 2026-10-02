import type { TranscriptRecord } from './types.js';

export interface TranscriptParse {
  record: TranscriptRecord;
  skipped: number;
}

type Line = Record<string, unknown>;

function asObject(value: unknown): Line | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Line)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function lastField(lines: Line[], type: string, field: string): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line !== undefined && line['type'] === type) {
      const value = asText(line[field]);
      if (value !== null) return value;
    }
  }
  return null;
}

/** Content is a bare string on some user lines and an array of blocks everywhere else. */
function contentText(content: unknown): string | null {
  if (typeof content === 'string') return asText(content);
  if (!Array.isArray(content)) return null;
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const block = asObject(content[i]);
    if (block !== null && block['type'] === 'text') {
      const text = asText(block['text']);
      if (text !== null) return text;
    }
  }
  return null;
}

/** Slash-command output and caveat lines are `user` lines wrapping a tag, not typed prompts. */
const SYNTHETIC_PREFIXES = ['<command-name>', '<local-command-stdout>', '<local-command-caveat>'];

function firstUserPrompt(lines: Line[]): string | null {
  for (const line of lines) {
    if (line['type'] !== 'user' || line['isMeta'] === true) continue;
    const text = contentText(asObject(line['message'])?.['content']);
    if (text === null) continue;
    const start = text.trimStart();
    if (SYNTHETIC_PREFIXES.some((prefix) => start.startsWith(prefix))) continue;
    return text;
  }
  return null;
}

/** Two lines can carry a recap: an assistant text block, and the prose `away_summary` Claude
 *  Code writes when a session resumes after an idle gap. Whichever comes later is the current
 *  one, so a session that idled and then worked reads its work rather than the idle summary. */
function recapText(lines: Line[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line['type'] === 'system' && line['subtype'] === 'away_summary') {
      const text = asText(line['content']);
      if (text !== null) return text;
      continue;
    }
    if (line['type'] !== 'assistant') continue;
    const text = contentText(asObject(line['message'])?.['content']);
    if (text !== null) return text;
  }
  return null;
}

/** Sidecar lines carry no `timestamp`, so the last line is not the last activity. File mtime
 *  is no substitute: it can advance with nothing appended. */
function lastTimestamp(lines: Line[]): number | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const raw = asText(lines[i]?.['timestamp']);
    if (raw === null) continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** Unlike `sessionId`, which is fixed for the file's lifetime, `cwd` moves when a session
 *  changes directory mid-conversation (e.g. into a worktree) — so it's read from the last
 *  conversation-bearing line rather than the first. */
function lastCwd(lines: Line[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line['type'] !== 'user' && line['type'] !== 'assistant') continue;
    const cwd = asText(line['cwd']);
    if (cwd === null) continue;
    return cwd;
  }
  return null;
}

/**
 * Every record field is optional: line types like `ai-title` and `away_summary` are not in every
 * install. A transcript has no end-of-session marker, so liveness comes from tmux and the
 * hook-driven `ended` flag instead (`deriveLiveness`).
 */
export function parseTranscript(text: string): TranscriptParse {
  const lines: Line[] = [];
  let skipped = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let line: Line | null;
    try {
      line = asObject(JSON.parse(raw));
    } catch {
      line = null;
    }
    if (line === null) {
      skipped += 1;
      continue;
    }
    if (line['isSidechain'] !== true) lines.push(line);
  }

  let sessionId: string | null = null;
  for (const line of lines) {
    if (line['type'] !== 'user' && line['type'] !== 'assistant') continue;
    const id = asText(line['sessionId']);
    if (id === null) continue;
    sessionId = id;
    break;
  }

  const cwd = lastCwd(lines);

  return {
    record: {
      sessionId,
      cwd,
      // Older transcripts carry the title as a `summary` line instead.
      title: lastField(lines, 'ai-title', 'aiTitle') ?? lastField(lines, 'summary', 'summary'),
      lastPrompt: lastField(lines, 'last-prompt', 'lastPrompt') ?? firstUserPrompt(lines),
      recap: recapText(lines),
      lastActivity: lastTimestamp(lines),
    },
    skipped,
  };
}
