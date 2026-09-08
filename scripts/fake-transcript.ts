// The transcript jsonl the fake writes, kept apart from the process that writes it: pure and
// side-effect free, so the line shapes can be pinned against garden's real parser in a unit
// test rather than by eyeballing a file.

/** What the fake claims about itself, in the terms garden surfaces per session. */
export interface FakeTranscriptFacts {
  readonly sessionId: string;
  readonly cwd: string;
  /** Null when the fake's cwd has no branch to report — an empty or detached repo. */
  readonly gitBranch: string | null;
  readonly title: string;
  readonly prompt: string;
  readonly recap: string;
}

function jsonl(...lines: readonly Record<string, unknown>[]): string {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join('');
}

/**
 * Every spelling below is load-bearing and none of them fail loudly — a misplaced field yields
 * a null fact and no error. The parser in packages/server/src/domain/transcript.ts reads
 * `aiTitle` off the line rather than off the message, takes cwd and gitBranch from the first
 * user or assistant line carrying a `sessionId`, and derives the prompt from the first user
 * line's content and the recap from the last assistant text block.
 */
export function openingTranscript(facts: FakeTranscriptFacts, at: Date): string {
  const timestamp = at.toISOString();
  const attributed = {
    sessionId: facts.sessionId,
    cwd: facts.cwd,
    gitBranch: facts.gitBranch,
    timestamp,
  };
  return jsonl(
    { ...attributed, type: 'user', message: { role: 'user', content: facts.prompt } },
    { type: 'ai-title', aiTitle: facts.title, timestamp },
    {
      ...attributed,
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: facts.recap }] },
    },
  );
}
