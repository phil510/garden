import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { until } from './support/poll.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GARDEN_BIN = join(repoRoot, 'packages', 'server', 'bin', 'garden.ts');
// A bare `tsx` specifier resolves against the process's own cwd, and the `tsx` CLI is a wrapper
// process that would hide the pipe's own pid, so the loader goes in by absolute path.
const TSX_LOADER = join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const PIPE_ARGV = ['--import', TSX_LOADER, GARDEN_BIN, 'events', '--follow'];

// Stands in for Claude: spawns the pipe as a monitor would (stdout a socketpair it holds),
// reports the pipe's pid, relays what the pipe writes, and then idles.
const STAND_IN = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, JSON.parse(process.env.PIPE_ARGV), {
  stdio: ['ignore', 'pipe', 'inherit'],
});
console.log('pid:' + child.pid);
child.stdout.on('data', (chunk) => {
  for (const line of String(chunk).split('\\n')) if (line) console.log('line:' + line);
});
setInterval(() => undefined, 1000);
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves with the first line a child's stdout produces that satisfies `match`. */
function lineFrom(child: ChildProcess, match: (line: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      for (const line of buffered.split('\n')) {
        if (match(line)) resolve(line);
      }
    });
    child.once('exit', () => reject(new Error(`exited before a matching line: ${buffered}`)));
  });
}

describe('garden events --follow as a real process', () => {
  let home: string;
  let wss: WebSocketServer;
  let connections: WebSocket[];
  let received: string[];
  const spawned: ChildProcess[] = [];
  const pipePids: number[] = [];

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'garden-lifeline-home-'));
    connections = [];
    received = [];
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    wss.on('connection', (socket) => {
      connections.push(socket);
      socket.on('message', (data: Buffer) => received.push(data.toString('utf8')));
    });
  });

  afterEach(async () => {
    for (const child of spawned.splice(0)) child.kill('SIGKILL');
    for (const pid of pipePids.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    for (const socket of connections) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  });

  function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
    const port = (wss.address() as AddressInfo).port;
    return {
      ...process.env,
      HOME: home,
      GARDEN_PORT: String(port),
      GARDEN_SESSION_ID: undefined,
      CLAUDE_CODE_SESSION_ID: undefined,
      ...overrides,
    };
  }

  function spawnPipe(overrides: Record<string, string | undefined>): ChildProcess {
    const child = spawn(process.execPath, PIPE_ARGV, {
      env: env(overrides),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    spawned.push(child);
    return child;
  }

  async function spawnStandIn(overrides: Record<string, string | undefined>) {
    const script = join(home, 'stand-in.cjs');
    writeFileSync(script, STAND_IN);
    const parent = spawn(process.execPath, [script], {
      env: { ...env(overrides), PIPE_ARGV: JSON.stringify(PIPE_ARGV) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    spawned.push(parent);
    const pidLine = await lineFrom(parent, (line) => line.startsWith('pid:'));
    const pid = Number(pidLine.slice('pid:'.length));
    pipePids.push(pid);
    return { parent, pid };
  }

  const diesWith = (pid: number) =>
    until(
      `pipe ${String(pid)} to die`,
      () => Promise.resolve(isAlive(pid)),
      (alive) => !alive,
      5000,
    );

  it.each([
    ['mismatched session ids', { GARDEN_SESSION_ID: 's1', CLAUDE_CODE_SESSION_ID: 's2' }],
    ['no GARDEN_SESSION_ID', { CLAUDE_CODE_SESSION_ID: 's1' }],
  ])('blocks silently with %s', async (_name, overrides) => {
    const child = spawnPipe(overrides);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

    await sleep(1500);

    expect(child.exitCode).toBeNull();
    expect(stdout).toBe('');
    expect(stderr).toBe('');
    expect(connections).toHaveLength(0);
  });

  it('dies with its Claude process when blocked', async () => {
    const { parent, pid } = await spawnStandIn({
      GARDEN_SESSION_ID: 's1',
      CLAUDE_CODE_SESSION_ID: 's2',
    });
    await sleep(500);
    expect(isAlive(pid)).toBe(true);

    parent.kill('SIGKILL');

    await diesWith(pid);
  });

  it('delivers a digest through fd 1 and dies with its Claude process when following', async () => {
    const { parent, pid } = await spawnStandIn({
      GARDEN_SESSION_ID: 's1',
      CLAUDE_CODE_SESSION_ID: 's1',
    });
    await until(
      'the pipe to connect',
      () => Promise.resolve(connections.length),
      (count) => count === 1,
      15_000,
    );
    const relayed = lineFrom(parent, (line) => line.startsWith('line:'));
    connections[0]?.send(JSON.stringify({ type: 'digest', id: 'd1', line: 'PR 7 merged' }));

    expect(await relayed).toBe('line:PR 7 merged');
    await until(
      'the ack to arrive',
      () => Promise.resolve(received),
      (frames) => frames.length === 1,
    );
    expect(JSON.parse(received[0] ?? '')).toEqual({ type: 'ack', id: 'd1' });

    parent.kill('SIGKILL');

    await diesWith(pid);
  });

  it('exits promptly on SIGTERM with empty stdout', async () => {
    const child = spawnPipe({ GARDEN_SESSION_ID: 's1', CLAUDE_CODE_SESSION_ID: 's2' });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    await sleep(1000);

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;

    expect(stdout).toBe('');
  });
});
