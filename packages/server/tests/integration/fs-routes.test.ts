import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TreeResponse } from '@garden/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { branch, repoRoot, status, workTreePrefix } from '../../src/adapters/git.js';
import { DEFAULT_OVERLAY_STATE } from '../../src/adapters/store.js';
import { createProjection } from '../../src/app/projection.js';
import type { OverlayState, StorePort } from '../../src/app/ports.js';
import { createServer } from '../../src/http/server.js';

function fakeStore(): StorePort {
  let current: OverlayState = DEFAULT_OVERLAY_STATE;
  return {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
}

function runGit(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd });
}

function initRepo(dir: string): void {
  runGit(dir, ['init', '--initial-branch=main']);
  runGit(dir, ['config', 'user.email', 'garden-test@example.com']);
  runGit(dir, ['config', 'user.name', 'garden test']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  runGit(dir, ['add', 'README.md']);
  runGit(dir, ['commit', '-m', 'initial commit']);
}

describe('/fs routes against a real temp repo', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function serverWithSession(cwd: string) {
    const projection = createProjection(fakeStore());
    projection.dispatch({ type: 'session-registered', id: 'sid', tmuxName: 'x', cwd });
    const app = createServer({
      projection,
      tmux: {
        listPanes: () => Promise.reject(new Error('not used by this test')),
        newSession: () => Promise.reject(new Error('not used by this test')),
        respawnPane: () => Promise.reject(new Error('not used by this test')),
        killSession: () => Promise.reject(new Error('not used by this test')),
      },
      store: fakeStore(),
      git: { repoRoot, branch, status, workTreePrefix },
      attach: {
        attach: () => {
          throw new Error('not used by this test');
        },
      },
      roots: [],
      serverPort: 4310,
      settingsPath: '/home/.garden/claude-settings.json',
      claudeCommand: ['claude'],
    });
    return app;
  }

  it('lists the repo root decorated with real git status', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    initRepo(dir);
    writeFileSync(join(dir, 'untracked.txt'), 'x');
    const app = serverWithSession(dir);
    try {
      const response = await app.inject({ method: 'GET', url: '/fs/tree?session=sid&path=' });
      expect(response.statusCode).toBe(200);
      const body = response.json<TreeResponse>();
      expect(body.entries).toContainEqual({
        name: 'untracked.txt',
        path: 'untracked.txt',
        kind: 'file',
        gitStatus: '??',
      });
      expect(body.entries).toContainEqual({
        name: 'README.md',
        path: 'README.md',
        kind: 'file',
        gitStatus: null,
      });
    } finally {
      await app.close();
    }
  });

  it('reads a file inside the repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    initRepo(dir);
    const app = serverWithSession(dir);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/fs/file?session=sid&path=README.md',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        path: 'README.md',
        kind: 'text',
        text: 'hello\n',
        truncated: false,
      });
    } finally {
      await app.close();
    }
  });

  it('reads an image file inside the repo as base64', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    initRepo(dir);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(dir, 'pic.png'), bytes);
    const app = serverWithSession(dir);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/fs/file?session=sid&path=pic.png',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ kind: string; data: string }>();
      expect(body.kind).toBe('image');
      expect(body.data).toBe(bytes.toString('base64'));
    } finally {
      await app.close();
    }
  });

  it('reports a non-image binary file as unpreviewable', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    initRepo(dir);
    writeFileSync(join(dir, 'data.bin'), Buffer.from([0x41, 0x00, 0x42]));
    const app = serverWithSession(dir);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/fs/file?session=sid&path=data.bin',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ path: 'data.bin', kind: 'binary' });
    } finally {
      await app.close();
    }
  });

  it('rejects a directory listing through a symlink pointing outside the repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const repo = join(dir, 'repo');
    const outside = join(dir, 'outside');
    mkdirSync(repo);
    mkdirSync(outside);
    initRepo(repo);
    writeFileSync(join(outside, 'secret.txt'), 'shh');
    symlinkSync(outside, join(repo, 'escape'));
    const app = serverWithSession(repo);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/fs/tree?session=sid&path=escape',
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects a file read through a symlink pointing outside the repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const repo = join(dir, 'repo');
    const outside = join(dir, 'outside');
    mkdirSync(repo);
    mkdirSync(outside);
    initRepo(repo);
    writeFileSync(join(outside, 'secret.txt'), 'shh');
    symlinkSync(join(outside, 'secret.txt'), join(repo, 'escape.txt'));
    const app = serverWithSession(repo);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/fs/file?session=sid&path=escape.txt',
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects `..` traversal above the repo root', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    initRepo(repo);
    writeFileSync(join(dir, 'sibling.txt'), 'nope');
    const app = serverWithSession(repo);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/fs/file?session=sid&path=../sibling.txt',
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('answers 404 for an unknown session id', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    initRepo(dir);
    const app = serverWithSession(dir);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/fs/tree?session=nope&path=',
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
