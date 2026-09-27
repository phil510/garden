import { watch } from 'chokidar';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { slugify } from '../domain/slug.js';
import type { GardenEvent } from '../domain/types.js';
import {
  createCoalescer,
  listTranscriptFiles,
  readTranscriptRecord,
  reconcileTranscripts,
  watchTranscripts,
} from './transcripts.js';
import type { TranscriptLogger, TranscriptSignature } from './transcripts.js';

// Wraps the real implementation by default, so every existing test still exercises real
// chokidar/fs timing (docs/testing.md) — only the one test below that needs a synthetic
// 'error' event overrides it, and only for that one call.
vi.mock('chokidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('chokidar')>();
  return { ...actual, watch: vi.fn(actual.watch) };
});

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

function projectDirFor(home: string, root: string): string {
  return join(home, '.claude', 'projects', slugify(root));
}

function writeProjectFile(home: string, root: string, sessionId: string, text: string): string {
  const dir = projectDirFor(home, root);
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

  it('reads cwd from a conversation-bearing line in the tail window, not the head', async () => {
    await withTempHome(async (home) => {
      const path = join(home, 'large-moved.jsonl');
      const fillerLine = JSON.stringify({
        type: 'assistant',
        message: { content: 'x'.repeat(5000) },
      });
      const movedLine = JSON.stringify({
        type: 'user',
        cwd: '/Users/phil/Desktop/Extend/garden/.worktrees/feat-x',
        message: { content: 'moved into a worktree' },
      });
      const text =
        [HEAD_LINE('session-b'), fillerLine, movedLine, TITLE_LINE, LAST_PROMPT_LINE].join('\n') +
        '\n';
      writeFileSync(path, text, 'utf8');

      const { record } = await readTranscriptRecord(path, 300);
      expect(record.sessionId).toBe('session-b');
      expect(record.cwd).toBe('/Users/phil/Desktop/Extend/garden/.worktrees/feat-x');
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

// A real chokidar watch on a machine under heavy contention occasionally never delivers a
// single native event for a given watcher's whole lifetime — confirmed by direct reproduction,
// not theoretical (see decisions.md): the same test, given a much longer real-time budget,
// still times out rather than resolving late, so this isn't a slow event, it's a genuinely
// dropped one. Production's defense against that is the reconciliation backstop above; these
// tests instead retry the whole scenario — fresh temp directory, fresh watcher — since a
// bounded retry is the standard way to absorb a real external system's rare unreliability
// without weakening what's asserted (it doesn't touch the `ready` barrier or the debounce
// logic, and a genuine logic defect would still fail every attempt, not just some). A
// successful attempt settles in well under 200ms (measured), so a short per-attempt timeout
// buys many independent chances at the same total worst-case wall-clock as few long ones.
const RETRY_FLAKY_NATIVE_WATCH = { retry: 6, timeout: 1500 };

describe('watchTranscripts', () => {
  it(
    'emits a transcript-changed event for a file created after the watch starts',
    RETRY_FLAKY_NATIVE_WATCH,
    async () => {
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
          await watcher.ready;
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
    },
  );

  it('ignores a file written outside the configured roots', RETRY_FLAKY_NATIVE_WATCH, async () => {
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
        await watcher.ready;
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

  it(
    'ignores subagent files nested under a session directory',
    RETRY_FLAKY_NATIVE_WATCH,
    async () => {
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
          await watcher.ready;
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
    },
  );

  it('debounces a run of writes into a single re-read', RETRY_FLAKY_NATIVE_WATCH, async () => {
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
        await watcher.ready;
        const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        appendFileSync(path, TITLE_LINE + '\n', 'utf8');
        appendFileSync(path, LAST_PROMPT_LINE + '\n', 'utf8');

        // Whether these three writes reach chokidar as one 'add' notification or several is
        // real filesystem timing (docs/testing.md), so this only asserts the settled outcome:
        // one coalesced event carrying the final content. The coalescing math itself — that
        // repeated schedules for one path collapse into a single re-read — is proven
        // deterministically below, in `describe('createCoalescer', ...)`.
        await until(
          () => events,
          (list) => list.length > 0,
          'the writes to be picked up',
        );

        expect(events).toHaveLength(1);
        expect(events[0]?.record.lastPrompt).toBe('do the thing');
      } finally {
        await watcher.close();
      }
    });
  });

  it(
    'logs an unparseable line once per file across repeated re-reads',
    RETRY_FLAKY_NATIVE_WATCH,
    async () => {
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
          await watcher.ready;
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
    },
  );

  it("logs the watcher's error events instead of swallowing them", async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      // A minimal stand-in for chokidar's FSWatcher: real chokidar has no fast, reliable
      // way to be made to emit a real 'error' from test code, so this proves the wiring —
      // logger.error gets called — without exercising real FS timing.
      class FakeWatcher extends EventEmitter {
        close(): Promise<void> {
          return Promise.resolve();
        }
      }
      const fake = new FakeWatcher();
      vi.mocked(watch).mockImplementationOnce(() => fake as unknown as ReturnType<typeof watch>);

      const errors: string[] = [];
      const logger: TranscriptLogger = { warn: () => {}, error: (m) => errors.push(m) };
      const watcher = watchTranscripts(transcriptsDirFor(home), [root], () => {}, logger);
      try {
        fake.emit('error', new Error('EMFILE, too many open files'));
        expect(errors).toEqual([expect.stringContaining('EMFILE')]);
      } finally {
        await watcher.close();
      }
    });
  });
});

describe('reconcileTranscripts', () => {
  it('invokes onStale for an in-scope file with no cached signature', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      const signatures = new Map<string, TranscriptSignature>();
      const seen: string[] = [];

      // onStale owns caching its own success, same as production's reread() does — this is
      // what makes the cache accurate regardless of which path (native watch or this
      // reconciliation loop) last read a given file.
      await reconcileTranscripts(transcriptsDirFor(home), [root], signatures, async (p) => {
        seen.push(p);
        signatures.set(p, await stat(p));
        return true;
      });

      expect(seen).toEqual([path]);
      expect(signatures.has(path)).toBe(true);
    });
  });

  it('does not re-invoke onStale once a matching signature is cached', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      const { size, mtimeMs } = await stat(path);
      const signatures = new Map<string, TranscriptSignature>([[path, { size, mtimeMs }]]);
      const seen: string[] = [];

      await reconcileTranscripts(transcriptsDirFor(home), [root], signatures, (p) => {
        seen.push(p);
        return Promise.resolve(true);
      });

      expect(seen).toEqual([]);
    });
  });

  it('re-invokes onStale once a cached signature no longer matches', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      const signatures = new Map<string, TranscriptSignature>([[path, { size: 0, mtimeMs: 0 }]]);
      const seen: string[] = [];

      await reconcileTranscripts(transcriptsDirFor(home), [root], signatures, (p) => {
        seen.push(p);
        return Promise.resolve(true);
      });

      expect(seen).toEqual([path]);
    });
  });

  it('does not cache a failed read, so the next call retries it', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      const signatures = new Map<string, TranscriptSignature>();
      let calls = 0;
      const onStale = () => {
        calls += 1;
        return Promise.resolve(false);
      };

      await reconcileTranscripts(transcriptsDirFor(home), [root], signatures, onStale);
      await reconcileTranscripts(transcriptsDirFor(home), [root], signatures, onStale);

      expect(calls).toBe(2);
      expect(signatures.has(path)).toBe(false);
    });
  });
});

describe('createCoalescer', () => {
  it('collapses repeated schedules for one key into a single run after debounceMs of quiet', () => {
    vi.useFakeTimers();
    try {
      const runs: string[] = [];
      const coalescer = createCoalescer((key) => runs.push(key), 100);

      coalescer.schedule('a');
      vi.advanceTimersByTime(50);
      coalescer.schedule('a'); // restarts the wait
      vi.advanceTimersByTime(99);
      expect(runs).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(runs).toEqual(['a']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks each key independently', () => {
    vi.useFakeTimers();
    try {
      const runs: string[] = [];
      const coalescer = createCoalescer((key) => runs.push(key), 100);

      coalescer.schedule('a');
      vi.advanceTimersByTime(50);
      coalescer.schedule('b');
      vi.advanceTimersByTime(50);
      expect(runs).toEqual(['a']);

      vi.advanceTimersByTime(50);
      expect(runs).toEqual(['a', 'b']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a fresh run for a key whose previous run already fired', () => {
    vi.useFakeTimers();
    try {
      const runs: string[] = [];
      const coalescer = createCoalescer((key) => runs.push(key), 100);

      coalescer.schedule('a');
      vi.advanceTimersByTime(100);
      expect(runs).toEqual(['a']);

      coalescer.schedule('a');
      vi.advanceTimersByTime(100);
      expect(runs).toEqual(['a', 'a']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear() cancels every pending run', () => {
    vi.useFakeTimers();
    try {
      const runs: string[] = [];
      const coalescer = createCoalescer((key) => runs.push(key), 100);

      coalescer.schedule('a');
      coalescer.schedule('b');
      coalescer.clear();
      vi.advanceTimersByTime(200);

      expect(runs).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
