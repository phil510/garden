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

function lastRoleText(lines: Line[], role: 'user' | 'assistant'): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined || line['type'] !== role) continue;
    const text = contentText(asObject(line['message'])?.['content']);
    if (text !== null) return text;
  }
  return null;
}

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
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  for (const line of lines) {
    if (line['type'] !== 'user' && line['type'] !== 'assistant') continue;
    const id = asText(line['sessionId']);
    if (id === null) continue;
    sessionId = id;
    cwd = asText(line['cwd']);
    gitBranch = asText(line['gitBranch']);
    break;
  }

  return {
    record: {
      sessionId,
      cwd,
      gitBranch,
      // `summary` no longer appears; it is read so older transcripts still get a title.
      title: lastField(lines, 'ai-title', 'aiTitle') ?? lastField(lines, 'summary', 'summary'),
      lastPrompt: lastField(lines, 'last-prompt', 'lastPrompt') ?? lastRoleText(lines, 'user'),
      recap: lastRoleText(lines, 'assistant'),
    },
    skipped,
  };
}
