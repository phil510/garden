// Stand-in for Claude Code in garden's sandbox instance: it honors the three channels
// garden actually couples to — the spawn command's flags, the hook POSTs, and the
// transcript jsonl — and renders a deliberately bare TUI instead of imitating Claude's.
// Statuses are driven by typed keywords rather than by waiting on a real model, so a
// screenshot or an integration test can put a session in a chosen state on demand.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { slugify } from '../packages/server/src/domain/slug.js';
import type { HookPayload } from '../packages/shared/src/index.js';
import { openingTranscript } from './fake-transcript.js';

/** Printed once stdin is attached, so a driver's `tmux send-keys` cannot land before the
 *  read loop exists and be silently dropped. */
const READY_MARKER = '[fake-claude] READY';

const GARDEN_URL = `http://127.0.0.1:${process.env.GARDEN_PORT ?? 4310}`;

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
  const root = process.env.GARDEN_TRANSCRIPTS_DIR ?? join(homedir(), '.claude', 'projects');
  return join(root, slugify(cwd), `${sessionId}.jsonl`);
}

/** Reported rather than invented, so the sandbox UI shows the fixture repo's real state. */
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

async function postHook(payload: HookPayload): Promise<void> {
  try {
    const response = await fetch(`${GARDEN_URL}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
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
    '  type /end to end the session',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const sessionId = parseSessionId(process.argv.slice(2));
  const cwd = process.cwd();
  const transcriptPath = transcriptPathFor(cwd, sessionId);
  const base = { session_id: sessionId, cwd, transcript_path: transcriptPath };

  console.log(banner(sessionId, cwd, transcriptPath));

  // The transcript lands before the hook that announces the session, so garden's watcher has
  // facts to read the first time it looks rather than a session with every field null.
  await mkdir(dirname(transcriptPath), { recursive: true });
  await writeFile(
    transcriptPath,
    openingTranscript(
      { ...SELF_DESCRIPTION, sessionId, cwd, gitBranch: gitBranchOf(cwd) },
      new Date(),
    ),
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

  const repl = createInterface({ input: process.stdin, terminal: false });
  repl.on('line', (line) => {
    const keyword = line.trim();
    if (keyword === '/end') void end();
    else if (keyword !== '') console.log(`[fake-claude] unrecognized keyword: ${keyword}`);
  });
  // EOF on stdin and a tmux kill-session both have to report the session ended; only a
  // signal garden cannot intercept (SIGKILL) leaves the status stale.
  repl.on('close', () => void end());
  process.on('SIGINT', () => void end());
  process.on('SIGTERM', () => void end());

  console.log(READY_MARKER);
}

main().catch((error: unknown) => {
  console.error(`[fake-claude] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
