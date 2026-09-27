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

// Wraps the real implementation by default, so every existing test still exercises real
// chokidar/fs timing (docs/testing.md) — only the one test below that needs a synthetic
// 'error' event overrides it, and only for that one call.
vi.mock('chokidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('chokidar')>();
  return { ...actual, watch: vi.fn(actual.watch) };
});

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
  // These five tests pin garden's own logic — the in/out-of-scope rules listTranscriptFiles
  // and inScopeDirs enforce, the debounce coalescing, the warn-once bookkeeping — not
  // chokidar's delivery. A real chokidar watch on a machine under heavy contention has been
  // observed to sometimes never deliver a single native event for a watcher's whole
  // lifetime, not merely deliver one late, so waiting on native delivery here would make the
  // assertion itself flaky. Each test instead drives pickup via `reconcileNow()` right after
  // writing, which reads straight off disk and so passes whether or not chokidar's own
  // 'add'/'change' ever fires for that write — which also means these five never exercise
  // isWatchedPath or the watcher.on('add'|'change', ...) registrations themselves; those get
  // their own dedicated, deterministic tests below.
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
        await watcher.ready;
        writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        await watcher.reconcileNow();

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
        await watcher.ready;
        writeProjectFile(
          home,
          '/Users/phil/Downloads/scratch',
          'session-b',
          HEAD_LINE('session-b') + '\n',
        );
        writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        await watcher.reconcileNow();

        expect(events.some((event) => event.record.sessionId === 'session-a')).toBe(true);
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
        await watcher.ready;
        const dir = join(home, '.claude', 'projects', slugify(root));
        mkdirSync(join(dir, 'session-a', 'subagents'), { recursive: true });
        writeFileSync(
          join(dir, 'session-a', 'subagents', 'agent-1.jsonl'),
          HEAD_LINE('session-a') + '\n',
          'utf8',
        );
        writeProjectFile(home, root, 'session-b', HEAD_LINE('session-b') + '\n');
        await watcher.reconcileNow();

        expect(events.some((event) => event.record.sessionId === 'session-b')).toBe(true);
        expect(events.some((event) => event.path.includes('subagents'))).toBe(false);
      } finally {
        await watcher.close();
      }
    });
  });

  it('registers an ignore predicate matching isWatchedPath, checked directly rather than via a write', async () => {
    // The five reconcileNow()-driven tests above never touch this predicate — they read
    // straight off disk via listTranscriptFiles/inScopeDirs — so this calls the exact
    // function chokidar was configured with, captured off the mocked `watch`, and asserts its
    // in/out-of-scope behavior deterministically with no filesystem writes or timing at all.
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const watcher = watchTranscripts(transcriptsDirFor(home), [root], () => {}, silentLogger());
      try {
        await watcher.ready;
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

  it('debounces a run of writes into a single re-read', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      // This test's own exact-count assertion (one event, not two) can't tolerate a real
      // chokidar debounce timer firing independently of reconcileNow()'s own read — under
      // contention, reconcileNow() itself does several real fs syscalls and so has no fixed
      // bound on how long it takes, which means no fixed debounce window is safely longer
      // than it. Faking chokidar away removes that second path entirely rather than merely
      // making it unlikely: reconcileNow() is then provably the only thing that can dispatch.
      // The coalescing math itself (repeated schedules for one path collapsing into a single
      // run) is proven deterministically below, in `describe('createCoalescer', ...)`; this
      // test's own job is just the settled outcome — one read carrying the final content.
      class FakeWatcher extends EventEmitter {
        close(): Promise<void> {
          return Promise.resolve();
        }
      }
      const fake = new FakeWatcher();
      vi.mocked(watch).mockImplementationOnce(() => fake as unknown as ReturnType<typeof watch>);

      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
      );
      try {
        // No await watcher.ready here: the fake watcher never emits 'ready', and reconcileNow()
        // doesn't depend on it — it reads straight off disk.
        const path = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
        appendFileSync(path, TITLE_LINE + '\n', 'utf8');
        appendFileSync(path, LAST_PROMPT_LINE + '\n', 'utf8');
        await watcher.reconcileNow();

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
        await watcher.ready;
        const path = writeProjectFile(
          home,
          root,
          'session-a',
          `not json\n${HEAD_LINE('session-a')}\n`,
        );
        await watcher.reconcileNow();
        appendFileSync(path, `${TITLE_LINE}\n`, 'utf8');
        await watcher.reconcileNow();

        expect(warnings).toHaveLength(1);
      } finally {
        await watcher.close();
      }
    });
  });

  it('runs a reconciliation pass on its own configured interval and dispatches what it finds', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      // A stand-in for chokidar's FSWatcher that never emits, same as the error-logging test
      // below: this test is about the setInterval -> reconcileTranscripts -> dispatch wiring
      // inside watchTranscripts, not chokidar's own delivery, so faking chokidar away keeps
      // the two concerns separate and lets fake timers drive the interval deterministically.
      class FakeWatcher extends EventEmitter {
        close(): Promise<void> {
          return Promise.resolve();
        }
      }
      const fake = new FakeWatcher();
      vi.mocked(watch).mockImplementationOnce(() => fake as unknown as ReturnType<typeof watch>);

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
      // A stand-in for chokidar's FSWatcher, same technique as the error-logging test below:
      // this drives watcher.on('add'|'change', ...) directly, which none of the
      // reconcileNow()-driven tests above ever touch — they read straight off disk and never
      // reach these listeners at all.
      class FakeWatcher extends EventEmitter {
        close(): Promise<void> {
          return Promise.resolve();
        }
      }
      const fake = new FakeWatcher();
      vi.mocked(watch).mockImplementationOnce(() => fake as unknown as ReturnType<typeof watch>);

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

  it('emits no event for a transcript that already existed before the watch started', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      // Written before watchTranscripts is even called, so only the initial scan — not a
      // write the watcher is armed to see — could ever produce an event for this file.
      writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      // A production transcript already existing at boot was last written well before the
      // watch starts. macOS FSEvents can otherwise replay a write from the same instant the
      // watch attaches as a native 'change' — a race this margin avoids, distinct from the
      // initial-scan 'add' burst ignoreInitial suppresses.
      await new Promise((resolve) => setTimeout(resolve, 250));

      const events: TranscriptChangedEvent[] = [];
      const debounceMs = 50;
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        debounceMs,
      );
      try {
        await watcher.ready;

        // A file created after `ready` proves the watcher itself is live; native chokidar
        // delivery has been observed to drop events under contention (see the file-level
        // comment above), so each vi.waitFor attempt appends a fresh line rather than
        // relying on a single write's event arriving.
        const pathB = writeProjectFile(home, root, 'session-b', HEAD_LINE('session-b') + '\n');
        await vi.waitFor(
          () => {
            appendFileSync(pathB, '\n', 'utf8');
            expect(events.some((event) => event.record.sessionId === 'session-b')).toBe(true);
          },
          { timeout: 5000, interval: 100 },
        );

        // B's dispatch proves the watcher is live and debounced writes have settled; if
        // ignoreInitial were dropped, A's initial-scan-triggered reread would have fired
        // well within this margin, ahead of or alongside B's own write-triggered one.
        await new Promise((resolve) => setTimeout(resolve, debounceMs + 100));

        expect(events.some((event) => event.record.sessionId === 'session-a')).toBe(false);
      } finally {
        await watcher.close();
      }
    });
  });

  it('emits an event for a write to a pre-existing transcript and for a brand-new one, both landing after boot', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      const pathA = writeProjectFile(home, root, 'session-a', HEAD_LINE('session-a') + '\n');
      // See the settle-window comment in the test above: A must be quiescent before the
      // watch starts, or its own boot-time append below could get folded into a spurious
      // initial-scan-adjacent event instead of proving the after-`ready` write path.
      await new Promise((resolve) => setTimeout(resolve, 250));

      const events: TranscriptChangedEvent[] = [];
      const watcher = watchTranscripts(
        transcriptsDirFor(home),
        [root],
        (event) => events.push(event),
        silentLogger(),
        50,
      );
      try {
        await watcher.ready;

        // This is the production path for a write landing during boot: the watcher is
        // armed (via `ready`) before replay's scan runs. A is the pre-existing file a
        // reconciliation pass would otherwise be the only thing to catch; C is new.
        appendFileSync(pathA, TITLE_LINE + '\n', 'utf8');
        const pathC = writeProjectFile(home, root, 'session-c', HEAD_LINE('session-c') + '\n');

        // Real chokidar delivery has been observed to drop events under contention (see the
        // file-level comment above), so each attempt re-touches both files rather than
        // relying on either write's native event arriving on the first try.
        await vi.waitFor(
          () => {
            appendFileSync(pathA, '\n', 'utf8');
            appendFileSync(pathC, '\n', 'utf8');
            expect(
              events.some(
                (event) =>
                  event.record.sessionId === 'session-a' &&
                  event.record.title === 'Bounded read title',
              ),
            ).toBe(true);
            expect(events.some((event) => event.record.sessionId === 'session-c')).toBe(true);
          },
          { timeout: 5000, interval: 100 },
        );
      } finally {
        await watcher.close();
      }
    });
  });

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
      await reconcileTranscripts(
        transcriptsDirFor(home),
        [root],
        signatures,
        async (p) => {
          seen.push(p);
          signatures.set(p, await stat(p));
        },
        silentLogger(),
      );

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
