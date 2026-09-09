import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { slugify } from '../domain/slug.js';
import type { GardenEvent } from '../domain/types.js';
import { listTranscriptFiles, readTranscriptRecord, watchTranscripts } from './transcripts.js';
import type { TranscriptLogger } from './transcripts.js';

/** Polls until `predicate` holds or the deadline passes, failing with the last observation. */
async function until<T>(
  probe: () => T,
  predicate: (value: T) => boolean,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = probe();
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${description}. Last observation: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    last = probe();
  }
  return last;
}

function silentLogger(): TranscriptLogger {
  return { warn: () => {}, error: () => {} };
}

function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'garden-transcripts-'));
  return fn(home).finally(() => rmSync(home, { recursive: true, force: true }));
}

function transcriptsDirFor(home: string): string {
  return join(home, '.claude', 'projects');
}

function writeProjectFile(home: string, root: string, sessionId: string, text: string): string {
  const dir = join(home, '.claude', 'projects', slugify(root));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, text, 'utf8');
  return path;
}

describe('listTranscriptFiles', () => {
  it('returns an empty list when the projects directory does not exist', async () => {
    await withTempHome(async (home) => {
      expect(
        await listTranscriptFiles(transcriptsDirFor(home), ['/Users/phil/Desktop/Extend']),
      ).toEqual([]);
    });
  });

  it('lists jsonl files under an in-scope project directory and skips out-of-scope ones', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      writeProjectFile(home, root, 'session-a', '{}\n');
      writeProjectFile(home, '/Users/phil/Downloads/scratch', 'session-b', '{}\n');

      const files = await listTranscriptFiles(transcriptsDirFor(home), [
        '/Users/phil/Desktop/Extend',
      ]);
      expect(files).toEqual([join(home, '.claude', 'projects', slugify(root), 'session-a.jsonl')]);
    });
  });

  it('ignores non-jsonl entries and subdirectories within a project directory', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      writeProjectFile(home, root, 'session-a', '{}\n');
      const dir = join(home, '.claude', 'projects', slugify(root));
      writeFileSync(join(dir, 'notes.txt'), 'not a transcript', 'utf8');
      mkdirSync(join(dir, 'subagents'), { recursive: true });
      writeFileSync(join(dir, 'subagents', 'child.jsonl'), '{}\n', 'utf8');

      const files = await listTranscriptFiles(transcriptsDirFor(home), [
        '/Users/phil/Desktop/Extend',
      ]);
      expect(files).toEqual([join(dir, 'session-a.jsonl')]);
    });
  });
});

const HEAD_LINE = (sessionId: string) =>
  JSON.stringify({
    type: 'user',
    sessionId,
    cwd: '/Users/phil/Desktop/Extend/garden',
    gitBranch: 'main',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { content: 'hello' },
  });

const TITLE_LINE = JSON.stringify({ type: 'ai-title', aiTitle: 'Bounded read title' });
const LAST_PROMPT_LINE = JSON.stringify({ type: 'last-prompt', lastPrompt: 'do the thing' });

describe('readTranscriptRecord', () => {
  it('parses a file smaller than the window in one read', async () => {
    await withTempHome(async (home) => {
      const path = join(home, 'small.jsonl');
      writeFileSync(path, [HEAD_LINE('session-a'), TITLE_LINE].join('\n') + '\n', 'utf8');

      const { record } = await readTranscriptRecord(path);
      expect(record.sessionId).toBe('session-a');
      expect(record.title).toBe('Bounded read title');
    });
  });

  it('finds the session identity in the head and the title in the tail of a file bigger than the window', async () => {
    await withTempHome(async (home) => {
      const path = join(home, 'large.jsonl');
      const fillerLine = JSON.stringify({
        type: 'assistant',
        message: { content: 'x'.repeat(5000) },
      });
      const text =
        [HEAD_LINE('session-b'), fillerLine, TITLE_LINE, LAST_PROMPT_LINE].join('\n') + '\n';
      writeFileSync(path, text, 'utf8');

      const { record } = await readTranscriptRecord(path, 300);
      expect(record.sessionId).toBe('session-b');
      expect(record.cwd).toBe('/Users/phil/Desktop/Extend/garden');
      expect(record.title).toBe('Bounded read title');
      expect(record.lastPrompt).toBe('do the thing');
    });
  });

  it('drops a single line that exceeds both windows without throwing', async () => {
    await withTempHome(async (home) => {
      const path = join(home, 'huge-line.jsonl');
      writeFileSync(path, JSON.stringify({ type: 'user', content: 'x'.repeat(300) }), 'utf8');

      const { record, skipped } = await readTranscriptRecord(path, 50);
      expect(record).toEqual({
        sessionId: null,
        cwd: null,
        gitBranch: null,
        title: null,
        lastPrompt: null,
        recap: null,
        lastActivity: null,
      });
      expect(skipped).toBe(0);
    });
  });
});

type TranscriptChangedEvent = Extract<GardenEvent, { type: 'transcript-changed' }>;

describe('watchTranscripts', () => {
  it('emits a transcript-changed event for a file created after the watch starts', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        20,
      );
      try {
        writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        await until(
          () => events,
          (list) => list.length > 0,
          'the created file to be picked up',
        );
        expect(events[0]?.record.sessionId).toBe('session-a');
      } finally {
        await watcher.close();
      }
    });
  });

  it('ignores a file written outside the configured roots', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        20,
      );
      try {
        writeProjectFile(
          home,
          '/Users/phil/Downloads/scratch',
          'session-b',
          HEAD_LINE('session-b') + '\n',
        );
        writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        await until(
          () => events,
          (list) => list.length > 0,
          'the in-scope file to be picked up',
        );

        expect(events.some((event) => event.path.includes('scratch'))).toBe(false);
      } finally {
        await watcher.close();
      }
    });
  });

  it('ignores subagent files nested under a session directory', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        20,
      );
      try {
        const dir = join(home, '.claude', 'projects', slugify(root));
        mkdirSync(join(dir, 'session-a', 'subagents'), { recursive: true });
        writeFileSync(
          join(dir, 'session-a', 'subagents', 'agent-1.jsonl'),
          HEAD_LINE('session-a') + '\n',
          'utf8',
        );
        writeProjectFile(home, root, 'session-b', HEAD_LINE('session-b') + '\n');
        await until(
          () => events,
          (list) => list.length > 0,
          'the sibling in-scope file to be picked up',
        );

        expect(events.some((event) => event.path.includes('subagents'))).toBe(false);
      } finally {
        await watcher.close();
      }
    });
  });

  it('debounces a run of writes into a single re-read', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        40,
      );
      try {
        const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        appendFileSync(path, TITLE_LINE + '\n', 'utf8');
        appendFileSync(path, LAST_PROMPT_LINE + '\n', 'utf8');

        await until(
          () => events,
          (list) => list.length > 0,
          'the writes to be picked up',
        );
        await expect(
          until(
            () => events.length,
            (count) => count > 1,
            'a second, undebounced event',
            300,
          ),
        ).rejects.toThrow();

        expect(events).toHaveLength(1);
        expect(events[0]?.record.lastPrompt).toBe('do the thing');
      } finally {
        await watcher.close();
      }
    });
  });

  it('logs an unparseable line once per file across repeated re-reads', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const events: TranscriptChangedEvent[] = [];
      const warnings: string[] = [];
      const logger: TranscriptLogger = { warn: (m) => warnings.push(m), error: () => {} };
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        logger,
        20,
      );
      try {
        const path = writeProjectFile(
          home,
          root,
          'session-a',
          `not json\n${HEAD_LINE('session-a')}\n`,
        );
        await until(
          () => events,
          (list) => list.length > 0,
          'the first read to complete',
        );
        appendFileSync(path, `${TITLE_LINE}\n`, 'utf8');
        await until(
          () => events,
          (list) => list.length > 1,
          'the second read to complete',
        );

        expect(warnings).toHaveLength(1);
      } finally {
        await watcher.close();
      }
    });
  });
});
