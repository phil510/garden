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
  createTranscripts,
  listTranscriptFiles,
  readTranscriptRecord,
  reconcileTranscripts,
} from './transcripts.js';
import type { TranscriptLogger, TranscriptSignature } from './transcripts.js';

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

const ROOT = '/Users/phil/Desktop/Extend/garden';
const POLL_MS = 100;
const RECONCILE_MS = 1_000;
const LIVE_IDLE_MS = 5_000;

/** Lets the real fs work a tick kicked off finish, for asserting that nothing happened. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Runs `fn` with only the intervals and the clock faked: the ticks do real fs reads, which need
 *  the real event loop (and real `setTimeout`) to complete. */
async function withFakeIntervals(fn: () => Promise<void>): Promise<void> {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  try {
    await fn();
  } finally {
    vi.useRealTimers();
  }
}

function startWatching(home: string) {
  const events: TranscriptChangedEvent[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const transcripts = createTranscripts(
    transcriptsDirFor(home),
    [ROOT],
    { warn: (m) => warnings.push(m), error: (m) => errors.push(m) },
    { pollMs: POLL_MS, reconcileMs: RECONCILE_MS, liveIdleMs: LIVE_IDLE_MS },
  );
  const watcher = transcripts.watch((event) => events.push(event));
  return { transcripts, watcher, events, warnings, errors };
}

describe('createTranscripts watch', () => {
  it('dispatches a tracked file on the next poll, then once more per change', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        const { watcher, events } = startWatching(home);
        watcher.track(path);

        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events[0]?.record.sessionId).toBe('session-a'));

        appendFileSync(path, TITLE_LINE + '\n', 'utf8');
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events[1]?.record.title).toBe('Bounded read title'));

        // A third tick with nothing written must not dispatch: it only holds if the signature
        // was recorded after the second read.
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await watcher.close();
        expect(events).toHaveLength(2);
      }),
    );
  });

  it('does not reread an unchanged tracked file on later polls', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        const { watcher, events } = startWatching(home);
        watcher.track(path);

        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(POLL_MS * 3);
        await watcher.close();

        expect(events).toHaveLength(1);
      }),
    );
  });

  it('tolerates a tracked path whose file does not exist yet and picks it up once it appears', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = join(projectDirFor(home, ROOT), 'session-a.jsonl');
        const { watcher, events, warnings, errors } = startWatching(home);
        watcher.track(path);

        await vi.advanceTimersByTimeAsync(POLL_MS);
        await settle();
        expect(events).toEqual([]);

        writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events[0]?.record.sessionId).toBe('session-a'));
        await watcher.close();

        expect([warnings, errors]).toEqual([[], []]);
      }),
    );
  });

  it('logs an unparseable line once per file across repeated rereads', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = writeProjectFile(
          home,
          ROOT,
          'session-a',
          `not json\n${HEAD_LINE('session-a')}\n`,
        );
        const { watcher, events, warnings } = startWatching(home);
        watcher.track(path);

        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events).toHaveLength(1));
        appendFileSync(path, `${TITLE_LINE}\n`, 'utf8');
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events).toHaveLength(2));
        await watcher.close();

        expect(warnings).toHaveLength(1);
      }),
    );
  });

  it('logs a stat failure on a tracked path that is not a missing file', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const dir = projectDirFor(home, ROOT);
        mkdirSync(dir, { recursive: true });
        // A symlink pointing at itself: stat() rejects with ELOOP, not ENOENT.
        const path = join(dir, 'broken.jsonl');
        symlinkSync(path, path);
        const { watcher, errors } = startWatching(home);
        watcher.track(path);

        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(errors).toEqual([expect.stringContaining(path)]));
        await watcher.close();
      }),
    );
  });

  it('discovers a file nobody tracked on the reconciliation tick', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        const { watcher, events } = startWatching(home);

        await vi.advanceTimersByTimeAsync(RECONCILE_MS);
        await vi.waitFor(() => expect(events[0]?.record.sessionId).toBe('session-a'));
        await watcher.close();
      }),
    );
  });

  it('skips files already read through readRecord on the first reconciliation tick', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const replayed = writeProjectFile(home, ROOT, 'replayed', HEAD_LINE('replayed') + '\n');
        const fresh = writeProjectFile(home, ROOT, 'fresh', HEAD_LINE('fresh') + '\n');
        const { transcripts, watcher, events } = startWatching(home);
        await transcripts.readRecord(replayed);

        await vi.advanceTimersByTimeAsync(RECONCILE_MS);
        await vi.waitFor(() => expect(events).toHaveLength(1));
        await watcher.close();

        expect(events.map((e) => e.path)).toEqual([fresh]);
      }),
    );
  });

  it('polls a file the reconciliation tick found changed between reconciliation ticks', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        const { watcher, events } = startWatching(home);

        await vi.advanceTimersByTimeAsync(RECONCILE_MS);
        await vi.waitFor(() => expect(events).toHaveLength(1));

        appendFileSync(path, TITLE_LINE + '\n', 'utf8');
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events[1]?.record.title).toBe('Bounded read title'));
        await watcher.close();
      }),
    );
  });

  it('stops polling a path left idle, and the reconciliation tick still finds its next change', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        const { watcher, events } = startWatching(home);
        watcher.track(path);
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.waitFor(() => expect(events).toHaveLength(1));

        // Jumps the clock rather than advancing through it: ticks that fire while an earlier
        // one is still reading are skipped, which would make the eviction tick's time arbitrary.
        vi.setSystemTime(Date.now() + LIVE_IDLE_MS + 1);
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await settle();
        appendFileSync(path, TITLE_LINE + '\n', 'utf8');
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await settle();
        expect(events).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(RECONCILE_MS);
        await vi.waitFor(() => expect(events).toHaveLength(2));
        await watcher.close();
      }),
    );
  });

  it('ignores a tracked path in an out-of-scope directory or nested deeper, and warns once for one outside the transcripts directory', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const outOfScope = writeProjectFile(home, '/Users/phil/Downloads/scratch', 's', '{}\n');
        const nestedDir = join(projectDirFor(home, ROOT), 'session-a', 'subagents');
        mkdirSync(nestedDir, { recursive: true });
        const nested = join(nestedDir, 'agent-1.jsonl');
        writeFileSync(nested, HEAD_LINE('session-a') + '\n', 'utf8');
        const { watcher, events, warnings } = startWatching(home);

        watcher.track(outOfScope);
        watcher.track(nested);
        watcher.track('/elsewhere/projects/slug/a.jsonl');
        watcher.track('/elsewhere/projects/slug/b.jsonl');
        await vi.advanceTimersByTimeAsync(POLL_MS * 5);
        await settle();
        await watcher.close();

        expect(events).toEqual([]);
        expect(warnings).toEqual([expect.stringContaining('/elsewhere/projects/slug/a.jsonl')]);
      }),
    );
  });

  it('stops both ticks on close', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        const { watcher, events } = startWatching(home);
        watcher.track(path);
        await watcher.close();

        await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2);
        await settle();

        expect(events).toEqual([]);
      }),
    );
  });

  it('lets a tick already reading finish its dispatch before close resolves', async () => {
    await withTempHome((home) =>
      withFakeIntervals(async () => {
        const path = writeProjectFile(home, ROOT, 'session-a', HEAD_LINE('session-a') + '\n');
        const { watcher, events } = startWatching(home);
        watcher.track(path);

        await vi.advanceTimersByTimeAsync(POLL_MS);
        await watcher.close();

        expect(events).toHaveLength(1);
      }),
    );
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
