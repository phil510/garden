import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TreeResponse } from '@garden/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBranchReader,
  isBareRepository,
  remoteUrl,
  repoRoot,
  status,
  workTreePrefix,
} from '../../src/adapters/git.js';
import { createProjection } from '../../src/app/projection.js';
import { createRepoCatalog } from '../../src/app/repoCatalog.js';
import { createServer } from '../../src/http/server.js';
import { fakeStore } from './support/fakeStore.js';
import { initRepo } from './support/git.js';
import { noPipes } from './support/noPipes.js';
import { noRootWatches } from './support/noRootWatches.js';

describe('/fs routes against a real temp repo', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function serverWithSession(cwd: string, roots: readonly string[] = []) {
    const projection = createProjection(fakeStore());
    projection.dispatch({ type: 'session-registered', id: 'sid', tmuxName: 'x', cwd });
    const app = createServer({
      projection,
      pipes: noPipes,
      rootWatches: noRootWatches,
      tmux: {
        listPanes: () => Promise.reject(new Error('not used by this test')),
        newSession: () => Promise.reject(new Error('not used by this test')),
        respawnPane: () => Promise.reject(new Error('not used by this test')),
        killSession: () => Promise.reject(new Error('not used by this test')),
      },
      configPort: {
        read: () => {
          throw new Error('not used by this test');
        },
        write: () => {
          throw new Error('not used by this test');
        },
      },
      git: { status, workTreePrefix, remoteUrl },
      attach: {
        attach: () => {
          throw new Error('not used by this test');
        },
      },
      repos: createRepoCatalog({
        git: { repoRoot, isBareRepository, branch: createBranchReader() },
        roots,
      }),
      serverPort: 4310,
      settingsPath: '/home/.garden/claude-settings.json',
      readClaudeCommand: () => ['claude'],
      deadSessionCap: 10,
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

  describe('root-keyed requests', () => {
    function serverWithRepoUnderRoot(): {
      app: ReturnType<typeof serverWithSession>;
      repo: string;
    } {
      dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
      const repo = join(dir, 'repo');
      mkdirSync(repo);
      initRepo(repo);
      mkdirSync(join(dir, 'plain'));
      return { app: serverWithSession(repo, [dir]), repo };
    }

    it('lists a listed root', async () => {
      const { app, repo } = serverWithRepoUnderRoot();
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/fs/tree?root=${encodeURIComponent(repo)}&path=`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json<TreeResponse>().entries.map((entry) => entry.name)).toContain(
          'README.md',
        );
      } finally {
        await app.close();
      }
    });

    it('answers 403 for a root that is not a listed repo', async () => {
      const { app } = serverWithRepoUnderRoot();
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/fs/file?root=${encodeURIComponent(join(dir ?? '', 'plain'))}&path=x`,
        });
        expect(response.statusCode).toBe(403);
        expect(response.json<{ error: string }>().error).toEqual(expect.any(String));
      } finally {
        await app.close();
      }
    });

    it.each(['/fs/tree?session=sid&root=/x&path=', '/fs/tree?path='])(
      'answers 400 unless exactly one of session and root is given: %s',
      async (url) => {
        const { app } = serverWithRepoUnderRoot();
        try {
          expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
        } finally {
          await app.close();
        }
      },
    );
  });
});
