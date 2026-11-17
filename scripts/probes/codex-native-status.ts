// Opt-in native feasibility probe: pnpm exec tsx scripts/probes/codex-native-status.ts [cancel | trust-resume]
// Requires codex, tmux and installed workspace dependencies. Uses no account credentials.
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

type HookBinding = {
  event: { session_id: string; cwd: string; transcript_path: string };
  gardenId: string;
};
type Status = { type: string; activeFlags?: string[] };
type NativeThread = { id: string; ephemeral: boolean; status: Status; originator: string };
type Message = {
  id?: number;
  method?: string;
  error?: unknown;
  result: { thread: NativeThread };
  params: { thread: NativeThread; threadId: string; status: Status };
};

const cancellation = new AbortController();
const stop = () => cancellation.abort(new Error('Probe interrupted'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const cancel = process.argv[2] === 'cancel';
const trustResume = process.argv[2] === 'trust-resume';
const root = await mkdtemp(join(tmpdir(), 'garden-native-probe-'));
const home = join(root, 'home');
const cwd = join(root, 'workspace');
const socket = join(root, 'native.sock');
const tmuxSocket = basename(root);
const observations: Message[] = [];
const clients = new Set<WebSocket>();
let daemon: ChildProcess | undefined;
let tmuxStarted = false;
let threadId: string | undefined;
let requestId = 0;
let providerCalls = 0;
let daemonLog = '';
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const tmux = (...args: string[]) =>
  execFileSync('tmux', ['-L', tmuxSocket, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
async function until(read: () => boolean | Promise<boolean>, description: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    cancellation.signal.throwIfAborted();
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  let pane = '';
  try {
    pane = tmux('capture-pane', '-p', '-t', 'probe');
  } catch {
    /* No live pane to diagnose. */
  }
  throw new Error(`Timed out: ${description}\n${pane}\n${daemonLog}`);
}
async function submit(text: string) {
  tmux('send-keys', '-t', 'probe', '-l', text);
  await until(
    () => tmux('capture-pane', '-p', '-t', 'probe').includes(`› ${text}`),
    'native input rendered',
  );
  tmux('send-keys', '-t', 'probe', 'Enter');
}
const provider = http.createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    const id = `response-${++providerCalls}`;
    const item =
      providerCalls === 1 && !trustResume
        ? {
            type: 'function_call',
            call_id: 'probe-command',
            name: 'exec_command',
            arguments: JSON.stringify({
              cmd: 'echo isolated-native-probe',
              sandbox_permissions: 'require_escalated',
              justification: 'Allow the isolated native probe?',
            }),
          }
        : {
            type: 'message',
            role: 'assistant',
            id: 'probe-message',
            content: [{ type: 'output_text', text: 'Isolated native probe complete.' }],
          };
    const events = [
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item },
      {
        type: 'response.completed',
        response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      },
    ];
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    );
  });
});
async function observe() {
  const client = new WebSocket(`ws+unix://${realpathSync(socket)}:/`, { handshakeTimeout: 5000 });
  clients.add(client);
  const pending = new Map<number, (message: Message) => void>();
  client.on('message', (data) => {
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    const message = JSON.parse(bytes.toString('utf8')) as Message;
    observations.push(message);
    if (message.method === 'thread/started' && !message.params.thread.ephemeral) {
      threadId = message.params.thread.id;
    }
    if (message.id !== undefined) pending.get(message.id)?.(message);
  });
  await once(client, 'open');
  async function rpc(method: string, params: unknown) {
    const id = ++requestId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Message['result']>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`RPC timed out: ${method}`)), 5000);
        pending.set(id, (message) =>
          message.error
            ? reject(new Error(JSON.stringify(message.error)))
            : resolve(message.result),
        );
        client.send(JSON.stringify({ id, method, params }));
      });
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  }
  await rpc('initialize', {
    clientInfo: { name: 'garden_native_probe', version: '0.0.0' },
    capabilities: { experimentalApi: true, requiredHumanApproval: false },
  });
  client.send(JSON.stringify({ method: 'initialized' }));
  return { client, rpc };
}
async function stopBackend() {
  if (daemon?.pid !== undefined && daemon.exitCode === null && daemon.signalCode === null) {
    const exited = once(daemon, 'exit');
    daemon.kill('SIGTERM');
    const timer = setTimeout(() => daemon?.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  }
}
async function assertFullAccessTurn(transcriptPath: string, minimumTurns: number) {
  await until(async () => {
    const rows = (await readFile(transcriptPath, 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            payload: { approval_policy: string; sandbox_policy: { type: string } };
          },
      );
    const turns = rows.filter((row) => row.type === 'turn_context');
    if (turns.length < minimumTurns) return false;
    assert.equal(turns.at(-1)?.payload.approval_policy, 'never');
    assert.equal(turns.at(-1)?.payload.sandbox_policy.type, 'danger-full-access');
    return true;
  }, 'effective full-access turn configuration persisted');
}
const pendingApproval = (status: Status) =>
  status.type === 'active' && status.activeFlags?.includes('waitingOnApproval') === true;
try {
  console.log(execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim());
  execFileSync('tmux', ['-V'], { timeout: 5000 });
  await Promise.all([mkdir(home), mkdir(cwd)]);
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  await writeFile(
    join(home, 'config.toml'),
    `model = "gpt-5.1-codex"
model_provider = "probe"
approval_policy = "on-request"
sandbox_mode = "read-only"
[features]
code_mode = false
[model_providers.probe]
name = "Isolated deterministic probe"
base_url = "http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
[projects.${JSON.stringify(cwd)}]
trust_level = "trusted"
`,
  );
  const hookPath = join(root, 'hook.cjs');
  const hookResult = join(root, 'hook.json');
  await writeFile(
    hookPath,
    `let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>require('fs').writeFileSync(${JSON.stringify(hookResult)},JSON.stringify({event:JSON.parse(input),gardenId:process.env.GARDEN_SESSION_ID})));`,
  );
  const hook = `hooks.SessionStart=[{hooks=[{type="command",command=${JSON.stringify(`${quote(process.execPath)} ${quote(hookPath)}`)},timeout=2}]}]`;
  async function startBackend() {
    daemon = spawn('codex', ['app-server', '--listen', `unix://${socket}`, '-c', hook], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TERM: 'xterm-256color',
        CODEX_HOME: home,
        GARDEN_SESSION_ID: tmuxSocket,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    daemon.stdout?.on('data', (data) => {
      daemonLog += String(data);
    });
    daemon.stderr?.on('data', (data) => {
      daemonLog += String(data);
    });
    daemon.on('error', (error) => {
      daemonLog += String(error);
    });
    await until(() => existsSync(socket), 'native socket');
  }
  await startBackend();
  const command = [
    'env',
    `CODEX_HOME=${home}`,
    'codex',
    '--remote',
    `unix://${socket}`,
    '--no-alt-screen',
    ...(trustResume
      ? ['--dangerously-bypass-approvals-and-sandbox']
      : ['--dangerously-bypass-hook-trust']),
    '-C',
    cwd,
  ]
    .map(quote)
    .join(' ');
  tmux('new-session', '-d', '-s', 'probe', '-x', '120', '-y', '40', command);
  tmuxStarted = true;
  tmux('set-window-option', '-t', 'probe', 'remain-on-exit', 'on');
  if (trustResume) {
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Hooks need review'),
      'native hook review',
    );
    console.log(
      'Native hook review shown; selecting Trust all and continue for the isolated hook.',
    );
    tmux('send-keys', '-t', 'probe', 'Down', 'Enter');
  }
  await until(
    () => tmux('capture-pane', '-p', '-t', 'probe').includes('Ask Codex to do anything'),
    'native composer',
  );
  let observer = await observe();
  await submit('Run the isolated echo probe.');
  await until(() => existsSync(hookResult), 'native SessionStart hook');
  const binding = JSON.parse(await readFile(hookResult, 'utf8')) as HookBinding;
  threadId = binding.event.session_id;
  const native = (await observer.rpc('thread/read', { threadId, includeTurns: false })).thread;
  console.log(`Native originator with TUI first: ${native.originator}`);
  assert.equal(native.originator, 'codex-tui');
  if (trustResume) {
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Isolated native probe complete.'),
      'native turn completed',
    );
    async function showPermissions() {
      tmux('send-keys', '-t', 'probe', '/status');
      await until(
        () => tmux('capture-pane', '-p', '-t', 'probe').includes('› /status'),
        'status command composer',
      );
      tmux('send-keys', '-t', 'probe', 'Enter');
      await until(
        () => tmux('capture-pane', '-p', '-t', 'probe').includes('Session:'),
        'native permissions status',
      );
      const pane = tmux('capture-pane', '-p', '-t', 'probe');
      assert.match(pane, /Permissions:\s+Full Access/);
    }
    await showPermissions();
    await assertFullAccessTurn(binding.event.transcript_path, 1);
    const originalThreadId = threadId;
    observer.client.terminate();
    await stopBackend();
    await startBackend();
    await rm(hookResult);
    const resumeCommand = [
      'env',
      `CODEX_HOME=${home}`,
      'codex',
      '--remote',
      `unix://${socket}`,
      '--no-alt-screen',
      '-C',
      cwd,
      'resume',
      originalThreadId,
    ]
      .map(quote)
      .join(' ');
    tmux('respawn-pane', '-k', '-t', 'probe', resumeCommand);
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Ask Codex to do anything'),
      'resumed composer without hook review',
    );
    await submit('Continue the isolated probe.');
    await until(() => existsSync(hookResult), 'trusted hook after backend restart and resume');
    assert.ok(!tmux('capture-pane', '-p', '-t', 'probe').includes('Hooks need review'));
    const resumed = JSON.parse(await readFile(hookResult, 'utf8')) as HookBinding;
    assert.equal(resumed.event.session_id, originalThreadId);
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Ask Codex to do anything'),
      'resumed composer',
    );
    await showPermissions();
    await assertFullAccessTurn(resumed.event.transcript_path, 2);
    console.log(
      'PASS: native hook trust reused after backend restart/resume; saved Full Access restored without a launch override.',
    );
    await rm(hookResult);
    const newCommand = [
      'env',
      `CODEX_HOME=${home}`,
      'codex',
      '--remote',
      `unix://${socket}`,
      '--no-alt-screen',
      '-C',
      cwd,
    ]
      .map(quote)
      .join(' ');
    tmux('respawn-pane', '-k', '-t', 'probe', newCommand);
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Ask Codex to do anything'),
      'new session without hook review',
    );
    assert.ok(!tmux('capture-pane', '-p', '-t', 'probe').includes('Hooks need review'));
    await submit('Run another isolated turn.');
    await until(() => existsSync(hookResult), 'trusted hook in new session');
    const next = JSON.parse(await readFile(hookResult, 'utf8')) as HookBinding;
    assert.notEqual(next.event.session_id, originalThreadId);
    console.log('PASS: new native session reuses the same persisted hook trust.');
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Isolated native probe complete.'),
      'new session turn completed',
    );
    await submit('/permissions');
    await until(
      () => /Full [Aa]ccess/.test(tmux('capture-pane', '-p', '-t', 'probe')),
      'native permissions picker',
    );
    const picker = tmux('capture-pane', '-p', '-t', 'probe');
    assert.match(picker, /› 4\. Read Only \(current\)/);
    assert.match(picker, /3\. Full Access/);
    tmux('send-keys', '-t', 'probe', 'Up', 'Enter');
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Enable full access?'),
      'native full-access confirmation',
    );
    tmux('send-keys', '-t', 'probe', 'Enter');
    await until(
      () =>
        tmux('capture-pane', '-p', '-t', 'probe').includes(
          'Permission selection requested: Full Access',
        ),
      'native permissions applied',
    );
    await showPermissions();
    await submit('Confirm the updated native permissions.');
    await assertFullAccessTurn(next.event.transcript_path, 2);
    console.log('PASS: native /permissions changes a running read-only session to Full Access.');
  } else {
    await until(
      () => tmux('capture-pane', '-p', '-t', 'probe').includes('Would you like to run'),
      'native approval UI',
    );
    assert.ok(threadId, 'native user thread announced');
    const readStatus = async () =>
      (await observer.rpc('thread/read', { threadId, includeTurns: false })).thread.status;
    assert.ok(pendingApproval(await readStatus()), 'metadata snapshot reports pending');
    observer.client.terminate();
    observer = await observe();
    assert.ok(pendingApproval(await readStatus()), 'reconnect restores pending');
    const hookEvidence = JSON.parse(await readFile(hookResult, 'utf8')) as HookBinding;
    assert.equal(hookEvidence.event.session_id, threadId);
    assert.equal(hookEvidence.event.cwd, cwd);
    assert.equal(hookEvidence.gardenId, tmuxSocket);
    const beforeResolution = observations.length;
    tmux('send-keys', '-t', 'probe', cancel ? 'Escape' : 'Enter');
    await until(async () => (await readStatus()).type === 'idle', 'native resolution');
    assert.ok(
      observations.some(
        (message) =>
          message.method === 'thread/status/changed' &&
          message.params.threadId === threadId &&
          pendingApproval(message.params.status),
      ),
      'pending notification received',
    );
    assert.ok(
      observations
        .slice(beforeResolution)
        .some(
          (message) =>
            message.method === 'thread/status/changed' &&
            message.params.threadId === threadId &&
            !pendingApproval(message.params.status),
        ),
      'resolution notification received after native response',
    );
    assert.equal(
      observations.filter((message) => message.method && message.id !== undefined).length,
      0,
      'passive observer received no approval requests',
    );
    console.log(
      `PASS: native approval UI dismissal/status recovery after ${cancel ? 'Escape' : 'Enter'}, passive status, reconnect snapshot, hook identity`,
    );
  }
  console.log(
    'LIMIT: deterministic provider only; Guardian and authenticated providers were not tested.',
  );
  console.log('TUI initialized before passive observer; native hook supplies thread binding.');
  console.log('LIMIT: this script owns the backend; tmux-owned backend survival was not tested.');
} finally {
  for (const client of clients) client.terminate();
  if (tmuxStarted) {
    try {
      tmux('kill-server');
    } catch {
      /* Already exited. */
    }
  }
  await stopBackend();
  provider.closeAllConnections();
  if (provider.listening) await new Promise<void>((resolve) => provider.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
