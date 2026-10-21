import { execFile } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { listPanes, type TmuxTarget } from '../../packages/server/src/adapters/tmux.js';
import { createTranscripts } from '../../packages/server/src/adapters/transcripts.js';
import { createProjection, type Projection } from '../../packages/server/src/app/projection.js';
import { createSession } from '../../packages/server/src/app/sessions.js';
import { slugify } from '../../packages/server/src/domain/slug.js';
import type { GardenEvent } from '../../packages/server/src/domain/types.js';
import { createServer as createGardenServer } from '../../packages/server/src/http/server.js';
import { fakeStore } from './support/fakeStore.js';
import { tmuxPort } from './support/tmuxPort.js';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';
import { noPipes } from './support/noPipes.js';
import { noRootWatches } from './support/noRootWatches.js';

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_CLAUDE = join(repoRoot, 'scripts', 'fake-claude.ts');
// A bare `tsx` specifier resolves against the pane's own cwd, which is an arbitrary project
// directory rather than this repo, so --import needs tsx's loader by absolute path instead.
const TSX_LOADER = join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');

/** Printed by the fake once its read loop is attached; see scripts/fake-claude.ts. */
const READY_MARKER = '[fake-claude] READY';

/** The fake accepts and ignores --settings, so nothing has to exist at this path. */
const SETTINGS_PATH = '/nonexistent/claude-settings.json';

/**
 * GARDEN_PORT reaches the pane through tmux's own -e; GARDEN_TRANSCRIPTS_DIR has no such
 * channel, so `env` carries it rather than this process mutating its own environment — the
 * tmux server captured that at start and shares it with every pane on the socket.
 *
 * The pane's process must be node itself rather than the tsx wrapper script: that wrapper
 * forks node as a child, so when the fake exits tmux only sees its pty close and never
 * reaps a wait status.
 */
function fakeClaudeCommand(transcriptsDir: string): readonly string[] {
  return [
    'env',
    `GARDEN_TRANSCRIPTS_DIR=${transcriptsDir}`,
    process.execPath,
    '--import',
    TSX_LOADER,
    FAKE_CLAUDE,
  ];
}

function unused(): never {
  throw new Error('not used by this test');
}

async function tmux(target: TmuxTarget, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', [
    '-L',
    target.socket,
    '-f',
    target.confPath,
    ...args,
  ]);
  return stdout;
}

/**
 * The server has no tmux poll of its own here, so liveness would stay stale and mask every
 * status to null. Re-deriving it inside the probe is what main.ts's interval does, minus the
 * timer; tmux lists panes rather than sessions, so the names are collapsed on the way in.
 */
function snapshotThenRead(
  projection: Projection,
  target: TmuxTarget,
  id: string,
): () => Promise<SessionState | undefined> {
  return async () => {
    const byName = new Map(
      (await listPanes(target)).map((pane) => [
        pane.session,
        { name: pane.session, paneDead: pane.dead, exitCode: pane.exitCode ?? null },
      ]),
    );
    projection.dispatch({ type: 'tmux-snapshot', sessions: [...byName.values()] });
    return projection.sessions().find((session) => session.id === id);
  };
}

interface FakeSession {
  readonly cwd: string;
  readonly transcriptsDir: string;
  readonly id: string;
  readonly read: () => Promise<SessionState | undefined>;
  readonly send: (keyword: string) => Promise<void>;
  /** Anything the transcript watcher logged; a healthy run leaves it empty. */
  readonly watcherComplaints: readonly string[];
}

/**
 * Composes what production composes — a live HTTP server, a transcript watch over the
 * directory the fake writes to, and a real fake-claude process in a tmux pane on `target`'s
 * socket — and hands `fn` a session that has already printed READY. Waiting on that marker
 * covers tsx's cold start without a fixed sleep and means a keyword cannot be typed into a
 * pane whose stdin is not attached yet.
 */
async function withFakeClaudeSession(
  target: TmuxTarget,
  fn: (session: FakeSession) => Promise<void>,
): Promise<void> {
  // The fake reports its cwd as the kernel resolved it, and the slug it derives has to be the
  // one the watcher's root scoping matches — on macOS the temp dir arrives as a symlink.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'garden-fake-cwd-')));
  const transcriptsDir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-fake-transcripts-')));
  const roots = [cwd];
  const watcherComplaints: string[] = [];

  const projection = createProjection(fakeStore());
  const claudeCommand = fakeClaudeCommand(transcriptsDir);
  const complain = (message: string) => watcherComplaints.push(message);
  // The discovery scan is pushed out of the test's reach, so a transcript can only reach the
  // projection through the path under test: the hook's `transcript_path` marking it live.
  const watcher = createTranscripts(
    transcriptsDir,
    roots,
    { warn: complain, error: complain },
    { reconcileMs: 10 * 60_000 },
  ).watch((event) => projection.dispatch(event));
  const app = createGardenServer({
    liveTranscripts: watcher,
    projection,
    pipes: noPipes,
    rootWatches: noRootWatches,
    tmux: tmuxPort(target),
    configPort: { read: unused, write: unused },
    git: { status: unused, workTreePrefix: unused, remoteUrl: unused },
    attach: { attach: unused },
    repos: { list: unused, resolveRoot: unused },
    serverPort: 0,
    settingsPath: SETTINGS_PATH,
    readClaudeCommand: () => claudeCommand,
    deadSessionCap: 10,
  });

  try {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const { id, tmuxName } = await createSession(
      {
        tmux: tmuxPort(target),
        projection,
        serverPort: port,
        settingsPath: SETTINGS_PATH,
        readClaudeCommand: () => claudeCommand,
      },
      { cwd },
    );

    await until(
      'the fake to print its READY marker',
      () => tmux(target, ['capture-pane', '-p', '-t', tmuxName]),
      (pane) => pane.includes(READY_MARKER),
      30_000,
    );

    await fn({
      cwd,
      transcriptsDir,
      id,
      read: snapshotThenRead(projection, target, id),
      send: async (keyword) => {
        await tmux(target, ['send-keys', '-t', tmuxName, keyword, 'Enter']);
      },
      watcherComplaints,
    });
  } finally {
    await watcher.close();
    await app.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(transcriptsDir, { recursive: true, force: true });
  }
}

/**
 * The facts the fake actually wrote, read back off its own file rather than restated here:
 * the assertions then pin that the projection surfaces what is on disk, and rewording the
 * fake's prose is not a test failure.
 */
function transcriptOnDisk(session: FakeSession): {
  title: string;
  prompt: string;
  recap: string;
} {
  const path = join(session.transcriptsDir, slugify(session.cwd), `${session.id}.jsonl`);
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  const title = lines.findLast((line) => typeof line['aiTitle'] === 'string')?.['aiTitle'];
  const prompt = lines.find(
    (line) => line['type'] === 'user' && typeof messageContent(line) === 'string',
  );
  const recap = lines.findLast((line) => line['type'] === 'assistant');
  if (typeof title !== 'string' || prompt === undefined || recap === undefined) {
    throw new Error(`the fake's transcript at ${path} is missing a title, prompt or recap`);
  }
  return {
    title,
    prompt: messageContent(prompt) as string,
    recap: (messageContent(recap) as { text: string }[])[0]!.text,
  };
}

function messageContent(line: Record<string, unknown>): unknown {
  return (line['message'] as { content?: unknown } | undefined)?.content;
}

describe('a real fake-claude process spawned into a tmux pane', () => {
  it('drives its session through waiting, needs-approval, waiting and ended', async () => {
    await withTmuxServer(async (target) => {
      await withFakeClaudeSession(target, async ({ read, send }) => {
        // SessionStart is awaited before READY prints, so this has already landed: a session
        // that has only booted is waiting until it does something.
        expect((await read())?.status).toBe('waiting');

        for (const [keyword, status] of [
          ['/approve', 'needs-approval'],
          ['/wait', 'waiting'],
        ] as const) {
          await send(keyword);
          const session = await until(
            `${keyword} to move the session to ${status}`,
            read,
            (candidate) => candidate?.status === status,
          );
          expect(session?.liveness).toBe('live');
        }

        await send('/end');
        // The SessionEnd hook lands while the pane is still up, so liveness reads dead before
        // there is any exit code. Waiting on the code instead pins both halves: the hook and
        // the process actually going away.
        const ended = await until(
          '/end to end the session and leave a dead pane carrying its exit code',
          read,
          (candidate) => candidate?.exitCode === 0,
        );
        expect(ended?.liveness).toBe('dead');
        // A dead session reports no status at all — SessionEnd is not itself a Status, and
        // domain/reduce.ts masks whatever the last one was once liveness is dead.
        expect(ended?.status).toBeNull();
      });
    });
  });

  it('has the transcript it writes reach the projection as the session facts', async () => {
    await withTmuxServer(async (target) => {
      await withFakeClaudeSession(target, async (session) => {
        const { read, send, cwd } = session;
        const written = transcriptOnDisk(session);

        // The poll picks the transcript up within a second of the hook that announced it, so
        // the facts arrive after READY rather than with it.
        const withFacts = await until(
          "the watcher to project the fake's transcript",
          read,
          (candidate) => candidate?.title !== null,
        );
        expect(withFacts?.title).toBe(written.title);
        expect(withFacts?.recap).toBe(written.recap);
        // Read off the transcript's own `cwd` field, not from where garden spawned the pane:
        // this is the round trip through slugify, the watch's root scoping and the parser.
        expect(withFacts?.cwd).toBe(cwd);
        // A bare mkdtemp directory is no repo, so the fake has no branch to report and says so
        // rather than omitting the field.
        expect(withFacts?.branch).toBeNull();
        expect(withFacts?.lastActivity).toBeGreaterThan(0);
        // The title comes from the fake's `ai-title` line; the prompt is only the parser's
        // fallback when there is none, and a fake whose two strings matched could not tell
        // the two paths apart.
        expect(written.title).not.toBe(written.prompt);

        // A keyword appends a fresh assistant line, so the recap moves without a rewrite —
        // proving the watch stays live past the first read rather than being a boot-time scan.
        await send('/approve');
        const afterKeyword = await until(
          'the appended line to replace the recap',
          read,
          (candidate) => candidate?.recap !== written.recap,
        );
        expect(afterKeyword?.recap).toBe(transcriptOnDisk(session).recap);
        expect(afterKeyword?.lastActivity).toBeGreaterThanOrEqual(withFacts!.lastActivity);
        expect(session.watcherComplaints).toEqual([]);
      });
    });
  });
});

type TranscriptChangedEvent = Extract<GardenEvent, { type: 'transcript-changed' }>;

function headLine(sessionId: string, cwd: string): string {
  return (
    JSON.stringify({
      type: 'user',
      sessionId,
      cwd,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { content: 'hello' },
    }) + '\n'
  );
}

function writeTranscript(path: string, sessionId: string, cwd: string): void {
  writeFileSync(path, headLine(sessionId, cwd), 'utf8');
}

const POLLING = { pollMs: 20, reconcileMs: 50 };

describe('transcript polling against real files', () => {
  it('emits no event for a transcript boot replay already read', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'garden-watch-cwd-')));
    const transcriptsDir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-watch-transcripts-')));
    const projectDir = join(transcriptsDir, slugify(cwd));
    mkdirSync(projectDir, { recursive: true });
    const existingPath = join(projectDir, 'session-existing.jsonl');
    writeTranscript(existingPath, 'session-existing', cwd);

    const events: TranscriptChangedEvent[] = [];
    const complaints: string[] = [];
    const transcripts = createTranscripts(
      transcriptsDir,
      [cwd],
      { warn: (m) => complaints.push(m), error: (m) => complaints.push(m) },
      POLLING,
    );
    await transcripts.readRecord(existingPath);
    const watcher = transcripts.watch((event) => events.push(event));
    try {
      // Found by the reconciliation scan alone — nothing tracks it.
      const newPath = join(projectDir, 'session-new.jsonl');
      writeTranscript(newPath, 'session-new', cwd);
      await until(
        'the reconciliation scan to find the new transcript',
        () => Promise.resolve(events.some((event) => event.path === newPath)),
        (arrived) => arrived,
      );

      // close() lets the scan pass that found the new file finish, so the pre-existing one
      // has been judged by the time this asserts.
      await watcher.close();
      expect(events.some((event) => event.path === existingPath)).toBe(false);
      expect(complaints).toEqual([]);
    } finally {
      await watcher.close();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(transcriptsDir, { recursive: true, force: true });
    }
  });

  it('dispatches for an append to a tracked transcript and for a tracked one that appears later', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'garden-watch-cwd-')));
    const transcriptsDir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-watch-transcripts-')));
    const projectDir = join(transcriptsDir, slugify(cwd));
    mkdirSync(projectDir, { recursive: true });
    const existingPath = join(projectDir, 'session-existing.jsonl');
    writeTranscript(existingPath, 'session-existing', cwd);
    const newPath = join(projectDir, 'session-new.jsonl');

    const events: TranscriptChangedEvent[] = [];
    // Scan pushed out of reach: only the poll of tracked paths can deliver these events.
    const watcher = createTranscripts(
      transcriptsDir,
      [cwd],
      { warn: () => {}, error: () => {} },
      { pollMs: POLLING.pollMs, reconcileMs: 10 * 60_000 },
    ).watch((event) => events.push(event));
    try {
      watcher.track(existingPath);
      watcher.track(newPath);
      await until(
        'the existing transcript, then an append to it, to reach the projection',
        () => Promise.resolve(events.filter((event) => event.path === existingPath).length),
        (count) => count >= 1,
      );
      appendFileSync(existingPath, JSON.stringify({ type: 'last-prompt' }) + '\n', 'utf8');
      writeTranscript(newPath, 'session-new', cwd);
      await until(
        'the append and the brand-new transcript to both reach the projection',
        () =>
          Promise.resolve(
            events.filter((event) => event.path === existingPath).length >= 2 &&
              events.some((event) => event.path === newPath),
          ),
        (arrived) => arrived,
      );
    } finally {
      await watcher.close();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(transcriptsDir, { recursive: true, force: true });
    }
  });
});
