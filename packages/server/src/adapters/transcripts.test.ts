import { watch } from 'chokidar';
import { EventEmitter } from 'node:events';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { slugify } from '../domain/slug.js';
import type { GardenEvent } from '../domain/types.js';
import {
  DEBOUNCE_MS,
  createCoalescer,
  listTranscriptFiles,
  readTranscriptRecord,
  reconcileTranscripts,
  watchTranscripts,
} from './transcripts.js';
import type { TranscriptLogger, TranscriptSignature } from './transcripts.js';

// The unit tier fakes chokidar to test garden's own logic — the debounce coalescing, the
// warn-once bookkeeping, the ignore predicate, the reconciliation interval — deterministically
// and without real fs watch timing. tests/integration/fake-claude.test.ts covers real chokidar
// delivery end to end.
vi.mock('chokidar', () => ({ watch: vi.fn() }));

class FakeWatcher extends EventEmitter {
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Makes the next `watchTranscripts()` call receive this fake in place of a real chokidar
 *  watcher. Each call to `watchTranscripts` consumes one `mockImplementationOnce`, so a test
 *  driving two watchers in sequence would call this twice. */
function useFakeChokidar(): FakeWatcher {
  const fake = new FakeWatcher();
  vi.mocked(watch).mockImplementationOnce(() => fake as unknown as ReturnType<typeof watch>);
  return fake;
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

describe('watchTranscripts', () => {
  it('registers an ignore predicate matching isWatchedPath, checked directly rather than via a write', async () => {
    // Captures the ignore predicate chokidar was configured with, off the mocked `watch`
    // call, and asserts its in/out-of-scope behavior with no filesystem writes or timing.
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      useFakeChokidar();
      const watcher = watchTranscripts(transcriptsDirFor(home), [root], () => {}, silentLogger());
      try {
        const options = vi.mocked(watch).mock.calls.at(-1)?.[1];
        const ignored = options?.ignored as (path: string) => boolean;
        const dir = projectDirFor(home, root);

        expect(ignored(transcriptsDirFor(home))).toBe(false);
        expect(ignored(dir)).toBe(false);
        expect(ignored(join(dir, 'session-a.jsonl'))).toBe(false);

        expect(ignored(join(home, '.claude', 'projects', 'some-out-of-scope-slug'))).toBe(true);
        expect(ignored(join(dir, 'session-a', 'subagents'))).toBe(true);
        expect(ignored(join(dir, 'session-a', 'subagents', 'agent-1.jsonl'))).toBe(true);
      } finally {
        await watcher.close();
      }
    });
  });

  it('logs an unparseable line once per file across repeated re-reads', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const fake = useFakeChokidar();

      const events: TranscriptChangedEvent[] = [];
      const warnings: string[] = [];
      const logger: TranscriptLogger = { warn: (m) => warnings.push(m), error: () => {} };
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        logger,
        5,
      );
      try {
        const path = writeProjectFile(
          home,
          root,
          'session-a',
          `not json\n${HEAD_LINE('session-a')}\n`,
        );
        fake.emit('add', path);
        await vi.waitFor(() => expect(events[0]).toBeDefined());

        appendFileSync(path, `${TITLE_LINE}\n`, 'utf8');
        fake.emit('change', path);
        await vi.waitFor(() => expect(events[1]).toBeDefined());

        expect(warnings).toHaveLength(1);
      } finally {
        await watcher.close();
      }
    });
  });

  it('runs a reconciliation pass on its own configured interval and dispatches what it finds', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      // This test is about the setInterval -> reconcileTranscripts -> dispatch wiring inside
      // watchTranscripts, not chokidar's own delivery, so the fake watcher never emits and
      // fake timers drive the interval deterministically.
      useFakeChokidar();

      // Written before the watcher even exists, so nothing but a reconciliation tick could
      // ever find it — the fake watcher has no 'add'/'change' to emit.
      writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');

      // Fakes only setInterval/clearInterval, not setTimeout or Node's own I/O machinery — the
      // reconciliation pass this drives does real fs reads, which need the real event loop to
      // actually complete them.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const events: TranscriptChangedEvent[] = [];
        const watcher = watchTranscripts(
          transcriptsDirFor(home),
          [root],
          (event) => events.push(event),
          silentLogger(),
          DEBOUNCE_MS,
          50,
        );
        try {
          await vi.advanceTimersByTimeAsync(50);
          // The fake-timer advance fires the interval's callback, but the real fs reads it
          // kicks off still need a real event-loop turn to complete — setTimeout is real here
          // (only setInterval/clearInterval are faked above), so this actually waits.
          await vi.waitFor(() => expect(events[0]?.record.sessionId).toBe('session-a'));
        } finally {
          await watcher.close();
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("dispatches a transcript-changed event when the native watcher emits 'add' or 'change'", async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      // Drives watcher.on('add'|'change', ...) directly, which no other test reaches.
      const fake = useFakeChokidar();

      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        5,
      );
      try {
        const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        fake.emit('add', path);
        await vi.waitFor(() => expect(events[0]?.record.sessionId).toBe('session-a'));

        appendFileSync(path, TITLE_LINE + '\n', 'utf8');
        fake.emit('change', path);
        await vi.waitFor(() => expect(events[1]?.record.title).toBe('Bounded read title'));
      } finally {
        await watcher.close();
      }
    });
  });

  it('collapses two native events for the same path fired before the debounce settles into a single re-read', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const fake = useFakeChokidar();

      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        20,
      );
      try {
        const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        // Both fire in the same tick, before the first schedule()'s timer has a chance to run —
        // if watcher.on bypassed the coalescer and called reread() directly, this would produce
        // two dispatches instead of one.
        fake.emit('add', path);
        fake.emit('change', path);

        await vi.waitFor(() => expect(events).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(events).toHaveLength(1);
      } finally {
        await watcher.close();
      }
    });
  });

  it("logs the watcher's error events instead of swallowing them", async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const fake = useFakeChokidar();

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

      await reconcileTranscripts(
        transcriptsDirFor(home),
        [root],
        signatures,
        (p) => {
          seen.push(p);
          return Promise.resolve();
        },
        silentLogger(),
      );

      expect(seen).toEqual([path]);
    });
  });

  it('does not re-invoke onStale once a matching signature is cached', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      const { size, mtimeMs } = await stat(path);
      const signatures = new Map<string, TranscriptSignature>([[path, { size, mtimeMs }]]);
      const seen: string[] = [];

      await reconcileTranscripts(
        transcriptsDirFor(home),
        [root],
        signatures,
        (p) => {
          seen.push(p);
          return Promise.resolve();
        },
        silentLogger(),
      );

      expect(seen).toEqual([]);
    });
  });

  it('re-invokes onStale once a cached signature no longer matches', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      const signatures = new Map<string, TranscriptSignature>([[path, { size: 0, mtimeMs: 0 }]]);
      const seen: string[] = [];

      await reconcileTranscripts(
        transcriptsDirFor(home),
        [root],
        signatures,
        (p) => {
          seen.push(p);
          return Promise.resolve();
        },
        silentLogger(),
      );

      expect(seen).toEqual([path]);
    });
  });

  it('logs a stat failure that is not a vanished file, instead of swallowing it', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const dir = projectDirFor(home, root);
      mkdirSync(dir, { recursive: true });
      // A symlink pointing at itself: stat() on it rejects with ELOOP, not ENOENT, so this
      // is a file that's persistently unreadable rather than merely vanished.
      const path = join(dir, 'broken.jsonl');
      symlinkSync(path, path);
      const signatures = new Map<string, TranscriptSignature>();
      const errors: string[] = [];
      const logger: TranscriptLogger = { warn: () => {}, error: (m) => errors.push(m) };

      await reconcileTranscripts(
        transcriptsDirFor(home),
        [root],
        signatures,
        () => Promise.resolve(),
        logger,
      );

      expect(errors).toEqual([expect.stringContaining(path)]);
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
