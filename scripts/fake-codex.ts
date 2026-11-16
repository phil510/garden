import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
if (home === undefined) throw new Error('fake Codex requires its own CODEX_HOME');
const queueDir = join(home, 'queue');
mkdirSync(queueDir, { recursive: true });
if (args[0] === 'queue') {
  const id = args[args.indexOf('--thread') + 1];
  const message =
    args.find((arg) => arg.startsWith('--message='))?.slice('--message='.length) ??
    args[args.indexOf('--message') + 1];
  if (id === undefined || message === undefined)
    throw new Error('queue requires thread and message');
  appendFileSync(join(queueDir, `${id}.jsonl`), `${JSON.stringify(message)}\n`);
  process.exit(0);
}

const commands = new Map<string, string>();
for (let index = 0; index < args.length - 1; index += 1) {
  if (args[index] !== '-c') continue;
  const overlay = args[index + 1]!;
  const event = /^hooks\.([A-Za-z]+)=/.exec(overlay)?.[1];
  const encoded = /command=(.*),timeout=\d+/.exec(overlay)?.[1];
  if (event !== undefined && encoded !== undefined)
    commands.set(event, JSON.parse(encoded) as string);
}
if (!commands.has('SessionStart'))
  throw new Error('fake Codex requires real injected hook commands');
let id = args[0] === 'resume' ? args.at(-1)! : randomUUID();
let path: string | null = null;
let source = args[0] === 'resume' ? 'resume' : 'startup';
let started = false;
let queuePosition = 0;

function materialize() {
  const directory = join(home!, 'sessions', '2026', '11', '15');
  mkdirSync(directory, { recursive: true });
  path = join(directory, `rollout-${id}.jsonl`);
  if (!existsSync(path)) append('session_meta', { id, session_id: id, cwd: process.cwd() });
}
function append(type: string, payload: unknown) {
  if (path === null) throw new Error('rollout not materialized');
  appendFileSync(
    path,
    `${JSON.stringify({ type, payload, timestamp: new Date().toISOString() })}\n`,
  );
}
async function hook(event: string): Promise<void> {
  const command = commands.get(event);
  if (command === undefined) throw new Error(`missing hook ${event}`);
  await new Promise<void>((resolve, reject) => {
    const child = execFile('sh', ['-c', command], { timeout: 5000 }, (error) =>
      error ? reject(new Error(error.message)) : resolve(),
    );
    child.stdin!.end(
      JSON.stringify({
        hook_event_name: event,
        session_id: id,
        transcript_path: path,
        cwd: process.cwd(),
        source,
      }),
    );
  });
}
async function turn(message: string) {
  if (message === '/end') {
    await hook('SessionEnd');
    process.exit(0);
  }
  if (message === '/approve') {
    await hook('PermissionRequest');
    return;
  }
  if (message === '/wait') {
    await hook('Stop');
    return;
  }
  if (message === '/clear') {
    id = randomUUID();
    path = null;
    source = 'clear';
    started = true;
    queuePosition = 0;
    materialize();
    await hook('SessionStart');
    console.log(`[fake-codex] CLEARED ${id}`);
    return;
  }
  materialize();
  // The input hook may precede binding; SessionStart must preserve its working status.
  await hook('UserPromptSubmit');
  if (!started) {
    started = true;
    await hook('SessionStart');
  }
  append('response_item', {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: message }],
    internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
  });
  if (message === '/work') {
    await hook('PreToolUse');
    return;
  }
  append('response_item', {
    type: 'message',
    role: 'assistant',
    phase: 'final_answer',
    content: [{ type: 'output_text', text: `Response to ${message}` }],
  });
  await hook('Stop');
}

let pending = Promise.resolve();
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  pending = pending
    .then(() => turn(line))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
});
setInterval(() => {
  const queue = join(queueDir, `${id}.jsonl`);
  if (!existsSync(queue)) return;
  const messages = readFileSync(queue, 'utf8').trim().split('\n').filter(Boolean);
  const unseen = messages.slice(queuePosition);
  queuePosition = messages.length;
  for (const encoded of unseen) pending = pending.then(() => turn(JSON.parse(encoded) as string));
}, 40).unref();
// Resume uses the existing native id; no new rollout is created until a turn runs.
writeFileSync(
  join(home, `launch-${process.env.GARDEN_SESSION_ID ?? 'unknown'}.json`),
  JSON.stringify(args),
);
console.log('[fake-codex] READY');
