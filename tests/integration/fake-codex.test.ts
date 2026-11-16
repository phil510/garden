import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SessionState, SessionsResponse } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const loader = join(root, 'node_modules/tsx/dist/loader.mjs');
const exec = promisify(execFile);
async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing listen address');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}
async function start(env: NodeJS.ProcessEnv, url: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', loader, join(root, 'packages/server/bin/garden.ts')],
    { env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let errors = '';
  child.stderr.on('data', (data: Buffer) => {
    errors += data.toString();
  });
  try {
    await until(
      'isolated Codex main.ts server to listen',
      async () => {
        if (child.exitCode !== null) throw new Error(errors);
        try {
          return (await fetch(`${url}/health`).then((response) => response.json())) as {
            pid?: number;
          };
        } catch {
          return {};
        }
      },
      (body) => body.pid === child.pid,
      30_000,
    );
    return child;
  } catch (error) {
    await stop(child);
    throw error;
  }
}
async function rows(url: string): Promise<SessionState[]> {
  return (
    (await fetch(`${url}/sessions?sinceDays=36500`).then((response) =>
      response.json(),
    )) as SessionsResponse
  ).sessions;
}
async function post(url: string, path: string, body: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  return response;
}

interface Alias {
  codexId: string | null;
  transcriptPath: string | null;
}
function aliases(appDir: string): Record<string, Alias> {
  return (
    JSON.parse(readFileSync(join(appDir, 'codex-aliases.json'), 'utf8')) as {
      sessions: Record<string, Alias>;
    }
  ).sessions;
}

describe('Codex through actual main.ts, tmux and generated hooks', () => {
  it('binds, tails, clears and restores both bound and pending sessions, including a binding while down', async () => {
    await withTmuxServer(async ({ socket }) => {
      const directory = realpathSync(mkdtempSync(join(tmpdir(), 'garden-fake-codex-')));
      const appDir = join(directory, 'app');
      const codexHome = join(directory, 'codex-home');
      const cwd = join(directory, 'project');
      mkdirSync(appDir);
      mkdirSync(codexHome);
      mkdirSync(cwd);
      writeFileSync(
        join(appDir, 'config.json'),
        JSON.stringify({ roots: [cwd], permissionMode: 'bypassPermissions' }),
      );
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      const env = {
        ...process.env,
        GARDEN_SERVER_PROCESS: '1',
        GARDEN_HARNESS: 'codex',
        GARDEN_PORT: String(port),
        GARDEN_APP_DIR: appDir,
        GARDEN_TMUX_SOCKET: socket,
        CODEX_HOME: codexHome,
        GARDEN_CODEX_COMMAND: `${process.execPath} --import ${loader} ${join(root, 'scripts/fake-codex.ts')}`,
      };
      const tmux = async (args: readonly string[]) =>
        (await exec('tmux', ['-L', socket, ...args], { timeout: 5000 })).stdout;
      const ready = (name: string) =>
        until(
          'fake Codex stdin readiness',
          () => tmux(['capture-pane', '-p', '-t', name]),
          (text) => text.includes('[fake-codex] READY'),
          30_000,
        );
      const send = async (name: string, text: string) => {
        await tmux(['send-keys', '-l', '-t', name, '--', text]);
        await tmux(['send-keys', '-t', name, 'Enter']);
      };
      let child: ChildProcess | undefined;
      try {
        child = await start(env, url);
        const created = await post(url, '/sessions', {
          cwd,
          model: 'gpt-5.3-codex',
          effort: 'high',
        });
        const { id, tmuxName } = (await created.json()) as { id: string; tmuxName: string };
        await ready(tmuxName);
        await until(
          'pending session to be live and waiting',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.status === 'waiting'),
        );
        expect(aliases(appDir)[id]?.codexId).toBeNull();
        const launched = JSON.parse(
          readFileSync(join(codexHome, `launch-${id}.json`), 'utf8'),
        ) as string[];
        expect(launched).toEqual(
          expect.arrayContaining([
            '--model',
            'gpt-5.3-codex',
            '--dangerously-bypass-approvals-and-sandbox',
          ]),
        );
        expect(launched).not.toContain('--no-daemon');
        await send(tmuxName, 'first prompt');
        await until(
          'bound rollout to supply title and recap',
          () => rows(url),
          (list) =>
            list.some(
              (row) =>
                row.id === id &&
                row.title === 'first prompt' &&
                row.recap === 'Response to first prompt',
            ),
        );
        const firstNative = aliases(appDir)[id]!.codexId;
        expect(firstNative).not.toBe(id);
        await send(tmuxName, '/work');
        await until(
          'working status from actual hook',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.status === 'working'),
        );
        await send(tmuxName, '/approve');
        await until(
          'approval status from actual hook',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.status === 'needs-approval'),
        );
        await send(tmuxName, '/clear');
        await until(
          'clear hook to replace binding',
          () => Promise.resolve(aliases(appDir)[id]!.codexId),
          (native) => native !== firstNative,
        );
        const cleared = (await rows(url)).find((row) => row.id === id)!;
        expect(cleared.title).toBeNull();
        expect(cleared.recap).toBeNull();
        expect(cleared.status).toBe('needs-approval');
        await send(tmuxName, 'new conversation');
        await until(
          'cleared rollout to reach same garden row',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.title === 'new conversation'),
        );
        const pending = (await (await post(url, '/sessions', { cwd })).json()) as {
          id: string;
          tmuxName: string;
        };
        await ready(pending.tmuxName);
        await stop(child);
        child = await start(env, url);
        const restored = await rows(url);
        expect(restored.filter((row) => row.id === id)).toHaveLength(1);
        expect(restored.find((row) => row.id === id)).toMatchObject({
          title: 'new conversation',
          status: 'unknown',
        });
        expect(restored.find((row) => row.id === pending.id)).toMatchObject({ status: 'waiting' });
        await stop(child);
        child = undefined;
        await send(pending.tmuxName, 'offline first prompt');
        const spoolDir = join(appDir, 'codex-session-start-spool');
        await until(
          'failed generated SessionStart to be durably spooled',
          () => Promise.resolve(existsSync(spoolDir) ? readdirSync(spoolDir) : []),
          (files) => files.some((file) => file.endsWith('.jsonl')),
        );
        child = await start(env, url);
        await until(
          'boot to bind and replay offline rollout',
          () => rows(url),
          (list) =>
            list.some((row) => row.id === pending.id && row.title === 'offline first prompt'),
        );
        expect(readdirSync(spoolDir)).toEqual([]);
        expect((await rows(url)).map((row) => row.id).sort()).toEqual([id, pending.id].sort());
        // Ended bindings remain resumable, and resume addresses the most recent clear id.
        const boundAfterClear = aliases(appDir)[id]!.codexId;
        await send(tmuxName, '/end');
        await until(
          'ended pane',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.liveness === 'dead'),
        );
        await post(url, `/sessions/${id}/resume`, {});
        await until(
          'resume launch to use current private native id',
          () =>
            Promise.resolve(
              JSON.parse(readFileSync(join(codexHome, `launch-${id}.json`), 'utf8')) as string[],
            ),
          (args) => args[0] === 'resume' && args.at(-1) === boundAfterClear,
        );
      } finally {
        if (child) await stop(child);
        await tmux(['kill-server']).catch(() => {});
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }, 60_000);
});
