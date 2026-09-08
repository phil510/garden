import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_STATE } from '../../src/adapters/store.js';
import {
  killSession,
  listPanes,
  newSession,
  respawnPane,
  type TmuxTarget,
} from '../../src/adapters/tmux.js';
import { watchTranscripts } from '../../src/adapters/transcripts.js';
import type { OverlayState, StorePort, TmuxPort } from '../../src/app/ports.js';
import { createProjection, type Projection } from '../../src/app/projection.js';
import { createSession } from '../../src/app/sessions.js';
import { slugify } from '../../src/domain/slug.js';
import { createServer as createGardenServer } from '../../src/http/server.js';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TSX = join(repoRoot, 'node_modules', '.bin', 'tsx');
const FAKE_CLAUDE = join(repoRoot, 'scripts', 'fake-claude.ts');

/** Printed by the fake once its read loop is attached; see scripts/fake-claude.ts. */
const READY_MARKER = '[fake-claude] READY';

/** The fake accepts and ignores --settings, so nothing has to exist at this path. */
const SETTINGS_PATH = '/nonexistent/claude-settings.json';

/**
 * GARDEN_PORT reaches the pane through tmux's own -e; GARDEN_TRANSCRIPTS_DIR has no such
 * channel, so `env` carries it rather than this process mutating its own environment — the
 * tmux server captured that at start and shares it with every pane on the socket.
 */
function fakeClaudeCommand(transcriptsDir: string): readonly string[] {
  return ['env', `GARDEN_TRANSCRIPTS_DIR=${transcriptsDir}`, TSX, FAKE_CLAUDE];
}

function fakeStore(): StorePort {
  let current: OverlayState = DEFAULT_OVERLAY_STATE;
  return {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
}

function tmuxPort(target: TmuxTarget): TmuxPort {
  return {
    listPanes: () => listPanes(target),
    newSession: (request) => newSession(target, request),
    respawnPane: (request) => respawnPane(target, request),
    killSession: (name) => killSession(target, name),
  };
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
 * DEBUG: temporary — round two of the garden #38 CI instrumentation. Round one (d012ea6)
 * swallowed stderr on the success path and only surfaced it via a thrown error's `.stderr`,
 * so a command that exited 0 with empty stdout (which is what CI showed) logged nothing
 * useful. This runs the raw tmux invocation directly and always prints stdout, stderr and
 * the exit code, on both the success and failure path — "no server running" is itself the
 * finding, so it must reach the log rather than being caught and discarded.
 */
async function runTmuxDiagnostic(label: string, argv: readonly string[]): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync('tmux', argv);
    console.error(
      `DEBUG: ${label} exit=0 stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    console.error(
      `DEBUG: ${label} exit=${JSON.stringify(err.code ?? null)} ` +
        `stdout=${JSON.stringify(String(err.stdout ?? ''))} ` +
        `stderr=${JSON.stringify(String(err.stderr ?? ''))}`,
    );
  }
}

/**
 * DEBUG: temporary instrumentation for investigating the fake-claude /end timeout that fails
 * on Linux CI but not macOS (garden #38, prime suspect: `#{pane_dead_status}` or
 * `remain-on-exit` behaving differently on the CI tmux build). Revert once the timeout is
 * understood.
 */
async function logEndTimeoutDiagnostics(
  target: TmuxTarget,
  lastObserved: SessionState | undefined,
): Promise<void> {
  await runTmuxDiagnostic('tmux -V', ['-V']);
  await runTmuxDiagnostic('show-options -g remain-on-exit', [
    '-L',
    target.socket,
    'show-options',
    '-g',
    'remain-on-exit',
  ]);
  await runTmuxDiagnostic('list-panes -a', [
    '-L',
    target.socket,
    'list-panes',
    '-a',
    '-F',
    '#{pane_id} dead=#{pane_dead} dead_status=[#{pane_dead_status}] pid=#{pane_pid}',
  ]);
  console.error(`DEBUG: last observed SessionState: ${JSON.stringify(lastObserved)}`);
}

/**
 * DEBUG: temporary — round two of the garden #38 CI investigation. Dumps remain-on-exit at
 * every scope tmux understands, immediately after the fake's tmux session (and its window)
 * exist but before any keyword is sent — i.e. while the pane is still alive. Distinguishes
 * "the conf's `set-option -g` never reached the window-scoped option on tmux 3.4" (plain
 * `-g` and `-w -t <window>` would both come back empty, but `-g -w` would show it) from
 * "tmux 3.4 does not honor remain-on-exit at all" (all three come back empty). Revert with
 * the rest of this instrumentation once the investigation concludes.
 */
async function logRemainOnExitScopes(target: TmuxTarget, tmuxName: string): Promise<void> {
  await runTmuxDiagnostic('[pre-keyword] show-options -g remain-on-exit (session scope)', [
    '-L',
    target.socket,
    'show-options',
    '-g',
    'remain-on-exit',
  ]);
  await runTmuxDiagnostic(
    '[pre-keyword] show-options -w -t <window> remain-on-exit (window scope)',
    ['-L', target.socket, 'show-options', '-w', '-t', tmuxName, 'remain-on-exit'],
  );
  await runTmuxDiagnostic('[pre-keyword] show-options -g -w remain-on-exit (global window scope)', [
    '-L',
    target.socket,
    'show-options',
    '-g',
    '-w',
    'remain-on-exit',
  ]);
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
  const store = fakeStore();
  const claudeCommand = fakeClaudeCommand(transcriptsDir);
  const app = createGardenServer({
    projection,
    tmux: tmuxPort(target),
    store,
    git: { repoRoot: unused, branch: unused, status: unused, workTreePrefix: unused },
    attach: { attach: unused },
    roots,
    serverPort: 0,
    settingsPath: SETTINGS_PATH,
    claudeCommand,
  });
  const watcher = watchTranscripts(transcriptsDir, roots, (event) => projection.dispatch(event), {
    warn: (message) => watcherComplaints.push(message),
    error: (message) => watcherComplaints.push(message),
  });

  try {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const { id, tmuxName } = await createSession(
      {
        tmux: tmuxPort(target),
        store,
        projection,
        serverPort: port,
        settingsPath: SETTINGS_PATH,
        claudeCommand,
      },
      { cwd },
    );

    // DEBUG: temporary — see logRemainOnExitScopes' comment (garden #38 CI investigation).
    await logRemainOnExitScopes(target, tmuxName);

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
  it('drives its session through working, needs-approval, waiting and ended', async () => {
    await withTmuxServer(async (target) => {
      await withFakeClaudeSession(target, async ({ read, send }) => {
        // SessionStart is awaited before READY prints, so this has already landed.
        expect((await read())?.status).toBe('working');

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
        // DEBUG: temporary — wrap this wait so a timeout dumps tmux diagnostics before
        // re-throwing (garden #38 CI investigation). Revert this try/catch once resolved.
        let lastObserved: SessionState | undefined;
        const ended = await until(
          '/end to end the session and leave a dead pane carrying its exit code',
          async () => {
            lastObserved = await read();
            return lastObserved;
          },
          (candidate) => candidate?.exitCode === 0,
        ).catch(async (error: unknown) => {
          await logEndTimeoutDiagnostics(target, lastObserved);
          throw error;
        });
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

        // Production debounces a re-read by 200ms and chokidar's own notice is not
        // instantaneous either, so the facts arrive after READY rather than with it.
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

/**
 * DEBUG: temporary — throwaway probe for garden #38. Answers the product question directly,
 * independent of garden's own tmux parsing (no listPanes, no projection): does this tmux
 * build report a dead pane's exit code at all? If this fails on Linux CI while passing
 * locally, garden's dead-session display is broken on tmux 3.4 regardless of anything
 * fake-claude or garden's own code does. Delete this describe block once the investigation
 * concludes.
 */
describe('DEBUG probe: does this tmux report a dead pane exit code (garden #38)', () => {
  it('reports pane_dead_status for a session whose command exits non-zero', async () => {
    await withTmuxServer(async (target) => {
      // First command to touch this socket, so -f is what starts the server with
      // remain-on-exit already on — same requirement withTmuxServer documents.
      await execFileAsync('tmux', [
        '-L',
        target.socket,
        '-f',
        target.confPath,
        'new-session',
        '-d',
        '-s',
        'probe',
        '--',
        'sh',
        '-c',
        'exit 3',
      ]);

      const observe = async (): Promise<string> => {
        try {
          const { stdout, stderr } = await execFileAsync('tmux', [
            '-L',
            target.socket,
            'list-panes',
            '-a',
            '-F',
            '#{pane_dead} dead_status=[#{pane_dead_status}]',
          ]);
          console.error(
            `DEBUG: probe list-panes exit=0 stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
          );
          return stdout;
        } catch (error) {
          const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          console.error(
            `DEBUG: probe list-panes exit=${JSON.stringify(err.code ?? null)} ` +
              `stdout=${JSON.stringify(String(err.stdout ?? ''))} ` +
              `stderr=${JSON.stringify(String(err.stderr ?? ''))}`,
          );
          return '';
        }
      };

      const observed = await until(
        'the probe pane to report itself dead with an exit code',
        observe,
        (stdout) => /dead_status=\[\d+\]/.test(stdout),
        5_000,
      ).catch((error: unknown) => {
        console.error(`DEBUG: probe timed out: ${String(error)}`);
        return '';
      });

      const match = observed.match(/dead_status=\[(\d+)\]/);
      expect(match?.[1]).toBe('3');
    });
  });
});
