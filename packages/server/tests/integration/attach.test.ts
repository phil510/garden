import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { PANE_CLOSE_CODES } from '@garden/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { attachPty, type PtyTarget } from '../../src/adapters/pty.js';
import { DEFAULT_OVERLAY_STATE } from '../../src/adapters/store.js';
import {
  killSession,
  listPanes,
  newSession,
  respawnPane,
  type TmuxTarget,
} from '../../src/adapters/tmux.js';
import { createAttachRegistry } from '../../src/app/attach.js';
import type {
  ConfigPort,
  GitPort,
  OverlayState,
  PtyPort,
  StorePort,
  TmuxPort,
} from '../../src/app/ports.js';
import { createProjection } from '../../src/app/projection.js';
import { createServer } from '../../src/http/server.js';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';
import { noPipes } from './support/noPipes.js';
import { noRootWatches } from './support/noRootWatches.js';

const execFileAsync = promisify(execFile);

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

function ptyPort(target: PtyTarget): PtyPort {
  return {
    attach: (tmuxName, size, handlers) => attachPty(target, tmuxName, size, handlers),
  };
}

function unusedGitPort(): GitPort {
  return {
    repoRoot: () => Promise.reject(new Error('not used by this test')),
    branch: () => Promise.reject(new Error('not used by this test')),
    remoteUrl: () => Promise.reject(new Error('not used by this test')),
    status: () => Promise.reject(new Error('not used by this test')),
    workTreePrefix: () => Promise.reject(new Error('not used by this test')),
  };
}

function unusedConfigPort(): ConfigPort {
  return {
    read: () => {
      throw new Error('not used by this test');
    },
    write: () => {
      throw new Error('not used by this test');
    },
  };
}

async function capturePane(target: TmuxTarget, name: string): Promise<string> {
  const { stdout } = await execFileAsync('tmux', [
    '-L',
    target.socket,
    '-f',
    target.confPath,
    'capture-pane',
    '-p',
    '-t',
    name,
  ]);
  return stdout;
}

async function paneSize(target: TmuxTarget, name: string): Promise<string> {
  const { stdout } = await execFileAsync('tmux', [
    '-L',
    target.socket,
    '-f',
    target.confPath,
    'display-message',
    '-p',
    '-t',
    name,
    '#{pane_width}x#{pane_height}',
  ]);
  return stdout.trim();
}

/** One line per tmux client attached to `name`; a pty that outlived its socket shows up here. */
async function listClients(target: TmuxTarget, name: string): Promise<string> {
  const { stdout } = await execFileAsync('tmux', [
    '-L',
    target.socket,
    '-f',
    target.confPath,
    'list-clients',
    '-t',
    name,
  ]);
  return stdout.trim();
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function closed(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
  });
}

describe('WS /attach/:id against a real tmux pane and a real pty', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('carries bytes both ways, resizes the real pane, and refuses a second attach', async () => {
    await withTmuxServer(async (target) => {
      const cwd = mkdtempSync(join(tmpdir(), 'garden-attach-'));
      dirs.push(cwd);
      const tmuxName = basename(cwd);
      const id = randomUUID();

      await newSession(target, { name: tmuxName, cwd, port: 4310, sessionId: id, command: ['sh'] });

      const projection = createProjection(fakeStore());
      projection.dispatch({ type: 'session-registered', id, tmuxName, cwd });

      const app = createServer({
        pipes: noPipes,
        rootWatches: noRootWatches,
        tmux: tmuxPort(target),
        store: fakeStore(),
        projection,
        serverPort: 4310,
        settingsPath: '/nonexistent/claude-settings.json',
        readClaudeCommand: () => ['claude'],
        deadSessionCap: 10,
        terminalFontSize: 13,
        git: unusedGitPort(),
        configPort: unusedConfigPort(),
        repos: {
          list: () => Promise.resolve([]),
          resolveRoot: () => Promise.reject(new Error('not used by this test')),
        },
        attach: createAttachRegistry({ pty: ptyPort(target), projection }),
      });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const url = (path: string) => `ws://127.0.0.1:${String(port)}${path}`;

      let socket: WebSocket | undefined;
      let second: WebSocket | undefined;
      try {
        const marker = `garden-attach-${randomUUID().slice(0, 8)}`;

        socket = new WebSocket(url(`/attach/${id}?cols=80&rows=24`));
        await opened(socket);

        const received: string[] = [];
        socket.on('message', (data: Buffer) => received.push(data.toString('utf8')));

        socket.send(Buffer.from(`echo ${marker}\n`, 'utf8'));

        await until(
          'the shell output carrying the marker to arrive over the socket',
          () => Promise.resolve(received.join('')),
          (text) => text.includes(marker),
        );
        await until(
          'the marker to reach the real tmux pane',
          () => capturePane(target, tmuxName),
          (text) => text.includes(marker),
        );

        socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
        // tmux's attached client renders a one-line status bar out of its own terminal
        // rows, so a 120x40 client leaves a 120x39 window and pane.
        await until(
          'the real pane to report the resized dimensions',
          () => paneSize(target, tmuxName),
          (size) => size === '120x39',
        );

        second = new WebSocket(url(`/attach/${id}?cols=80&rows=24`));
        const refusal = await closed(second);
        expect(refusal.code).toBe(4009);

        await until(
          'one tmux client for the open pane socket',
          () => listClients(target, tmuxName),
          (clients) => clients.split('\n').filter(Boolean).length === 1,
        );
        socket.close();
        await until(
          'the pty to detach from tmux once its socket closes',
          () => listClients(target, tmuxName),
          (clients) => clients === '',
        );
      } finally {
        socket?.close();
        second?.close();
        await app.close();
      }
    });
  });

  it('closes with code 1000, not an unrecognised code, when the pty exits on its own', async () => {
    await withTmuxServer(async (target) => {
      const cwd = mkdtempSync(join(tmpdir(), 'garden-attach-'));
      dirs.push(cwd);
      const tmuxName = basename(cwd);
      const id = randomUUID();

      await newSession(target, { name: tmuxName, cwd, port: 4310, sessionId: id, command: ['sh'] });

      const projection = createProjection(fakeStore());
      projection.dispatch({ type: 'session-registered', id, tmuxName, cwd });

      const app = createServer({
        pipes: noPipes,
        rootWatches: noRootWatches,
        tmux: tmuxPort(target),
        store: fakeStore(),
        projection,
        serverPort: 4310,
        settingsPath: '/nonexistent/claude-settings.json',
        readClaudeCommand: () => ['claude'],
        deadSessionCap: 10,
        terminalFontSize: 13,
        git: unusedGitPort(),
        configPort: unusedConfigPort(),
        repos: {
          list: () => Promise.resolve([]),
          resolveRoot: () => Promise.reject(new Error('not used by this test')),
        },
        attach: createAttachRegistry({ pty: ptyPort(target), projection }),
      });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const url = (path: string) => `ws://127.0.0.1:${String(port)}${path}`;

      let socket: WebSocket | undefined;
      try {
        socket = new WebSocket(url(`/attach/${id}?cols=80&rows=24`));
        await opened(socket);

        await until(
          'one tmux client for the attached pane socket',
          () => listClients(target, tmuxName),
          (clients) => clients.split('\n').filter(Boolean).length === 1,
        );

        // Killing the session (rather than exiting the shell inside it, which
        // remain-on-exit would just leave as a dead pane) is what ends the attach
        // pty's own process — the exit path this test pins.
        await killSession(target, tmuxName);

        const exit = await closed(socket);
        expect(exit.code).toBe(PANE_CLOSE_CODES.PTY_EXITED);
      } finally {
        socket?.close();
        await app.close();
      }
    });
  });
});
