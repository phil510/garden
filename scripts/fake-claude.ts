// Stand-in for Claude Code in garden's sandbox instance: it honors the three channels
// garden actually couples to — the spawn command's flags, the hook POSTs, and the
// transcript jsonl — and renders a deliberately bare TUI instead of imitating Claude's.
// Statuses are driven by typed keywords rather than by waiting on a real model, so a
// screenshot or an integration test can put a session in a chosen state on demand.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { slugify } from '../packages/server/src/domain/slug.js';
import type { HookPayload } from '../packages/shared/src/index.js';
import { keywordOutcome } from './fake-keywords.js';
import { keywordTranscriptLine, openingTranscript } from './fake-transcript.js';

/** Printed once startup has finished and stdin is attached, so a driver has a single point to
 *  wait on before `tmux send-keys` rather than racing the SessionStart POST. */
const READY_MARKER = '[fake-claude] READY';

/** The two knobs that say which instance the fake belongs to are required, not defaulted: an
 *  unset one resolves to the user's real garden on 4310 and the real `~/.claude/projects`, so
 *  a stale pane would post phantom sessions into the live instance and litter its transcripts.
 *  Failing loudly is the isolation guarantee. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[fake-claude] ${name} must be set — refusing to fall back to a real garden`);
    process.exit(1);
  }
  return value;
}

const GARDEN_URL = `http://127.0.0.1:${requiredEnv('GARDEN_PORT')}`;

/** Every flag garden passes is accepted and ignored except the session id, so
 *  `createSession`/`resumeSession` need no branch for "is this the fake". */
function parseSessionId(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if ((argv[i] === '--session-id' || argv[i] === '--resume') && value !== undefined) return value;
  }
  return randomUUID();
}

/** The prose the fake puts in its transcript, written to read as the fake rather than as a
 *  plausible Claude session, so a screenshot is never mistaken for a real one. */
const SELF_DESCRIPTION = {
  title: 'fake claude sandbox session',
  prompt: 'Drive this sandbox session through its statuses.',
  recap: 'Standing by for a keyword. Nothing in this transcript came from a model.',
};

function transcriptPathFor(cwd: string, sessionId: string): string {
  return join(requiredEnv('GARDEN_TRANSCRIPTS_DIR'), slugify(cwd), `${sessionId}.jsonl`);
}

/** Reported rather than invented, so the sandbox UI shows the fixture repo's real state.
 *  A detached HEAD reports the literal `HEAD`; only a repo with no commits yields null. */
function gitBranchOf(cwd: string): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch === '' ? null : branch;
  } catch {
    return null;
  }
}

const HOOK_TIMEOUT_MS = 5_000;

async function postHook(payload: HookPayload): Promise<void> {
  try {
    const response = await fetch(`${GARDEN_URL}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      // Bounded so a garden that accepts the connection and never answers cannot wedge the
      // keyword queue — with `end` queued behind it, that would make the pane unkillable
      // by anything short of SIGKILL.
      signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[fake-claude] ${payload.hook_event_name} rejected: HTTP ${response.status}`);
      return;
    }
    console.log(`[fake-claude] ${payload.hook_event_name} -> ${GARDEN_URL}`);
  } catch (error: unknown) {
    // A missing garden is worth reporting but not worth dying over: the pane stays up so
    // the failure is readable, and the server may come back before the next keyword.
    console.error(
      `[fake-claude] ${payload.hook_event_name} POST failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function banner(sessionId: string, cwd: string, transcriptPath: string): string {
  return [
    '',
    '  fake claude — garden sandbox stand-in, not a real Claude Code',
    '',
    `  session     ${sessionId}`,
    `  cwd         ${cwd}`,
    `  transcript  ${transcriptPath}`,
    `  garden      ${GARDEN_URL}`,
    '',
    '  type /approve, /wait or /end to drive the session',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const sessionId = parseSessionId(process.argv.slice(2));
  const cwd = process.cwd();
  const gitBranch = gitBranchOf(cwd);
  const transcriptPath = transcriptPathFor(cwd, sessionId);
  const base = { session_id: sessionId, cwd, transcript_path: transcriptPath };

  console.log(banner(sessionId, cwd, transcriptPath));

  // The transcript lands before the hook that announces the session, so garden's watcher has
  // facts to read the first time it looks rather than a session with every field null.
  await mkdir(dirname(transcriptPath), { recursive: true });
  await writeFile(
    transcriptPath,
    openingTranscript({ ...SELF_DESCRIPTION, sessionId, cwd, gitBranch }, new Date()),
    'utf8',
  );

  // SessionStart is awaited before the read loop opens so a keyword arriving immediately
  // after READY cannot have its status overwritten by a SessionStart still in flight.
  await postHook({ ...base, hook_event_name: 'SessionStart' });

  let ending = false;
  const end = async (): Promise<never> => {
    if (!ending) {
      ending = true;
      await postHook({ ...base, hook_event_name: 'SessionEnd' });
    }
    process.exit(0);
  };

  // Keywords piped in back-to-back (a driver's fast send-keys, or a script feeding stdin) can
  // all arrive before any of their async work finishes. Serialized through this queue, each
  // keyword's transcript append and hook POST complete before the next one starts — otherwise
  // `end`'s `process.exit` could fire while an earlier `/approve` or `/wait` is still in flight
  // and silently drop it.
  // `.catch` after `.then`, not a rejection handler passed to it: the two-argument form would
  // handle only the PREVIOUS task's failure, leaving this task's rejection to skip whatever is
  // enqueued next and take down the process when nothing follows.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      console.error(`[fake-claude] ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const repl = createInterface({ input: process.stdin, terminal: false });
  repl.on('line', (line) => {
    const keyword = line.trim();
    if (keyword === '') return;
    const outcome = keywordOutcome(keyword);
    if (outcome === null) {
      console.log(`[fake-claude] unrecognized keyword: ${keyword}`);
      return;
    }
    if (outcome.hookEventName === 'SessionEnd') {
      enqueue(end);
      return;
    }
    // Appended before the hook POST so a watcher reacting to the status change already sees
    // the recap and lastActivity the keyword produced, not the stale opening transcript.
    enqueue(async () => {
      await appendFile(
        transcriptPath,
        keywordTranscriptLine({ sessionId, cwd, gitBranch }, outcome.recap, new Date()),
        'utf8',
      );
      await postHook({ ...base, hook_event_name: outcome.hookEventName });
    });
  });
  // EOF on stdin and a tmux kill-session both have to report the session ended; only a
  // signal garden cannot intercept (SIGKILL) leaves the status stale.
  repl.on('close', () => enqueue(end));
  process.on('SIGINT', () => enqueue(end));
  process.on('SIGTERM', () => enqueue(end));

  console.log(READY_MARKER);
}

main().catch((error: unknown) => {
  console.error(`[fake-claude] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
