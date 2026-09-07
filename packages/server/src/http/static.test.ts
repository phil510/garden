import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerStaticRoutes, resolveClientDir } from './static.js';

describe('resolveClientDir', () => {
  it('resolves to the bundled client dir when dist/web exists', () => {
    const moduleDir = '/app/dist';
    expect(resolveClientDir(moduleDir, () => true)).toBe(join(moduleDir, 'web'));
  });

  it('falls back to the source-tree client dir when dist/web does not exist', () => {
    const moduleDir = '/repo/packages/server/src/http';
    expect(resolveClientDir(moduleDir, () => false)).toBe(join(moduleDir, '../../../web/dist'));
  });
});

describe('registerStaticRoutes', () => {
  let clientDir: string;

  afterEach(() => {
    if (clientDir) {
      rmSync(clientDir, { recursive: true, force: true });
    }
  });

  it('serves index.html for an unmatched client-shaped route', async () => {
    clientDir = mkdtempSync(join(tmpdir(), 'garden-static-'));
    writeFileSync(join(clientDir, 'index.html'), '<div id="root">shell</div>');

    const app = Fastify();
    registerStaticRoutes(app, clientDir);
    try {
      const response = await app.inject({ method: 'GET', url: '/some-client-route/abc' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('shell');
    } finally {
      await app.close();
    }
  });

  it('answers 404 without the SPA shell for an unmatched API route', async () => {
    clientDir = mkdtempSync(join(tmpdir(), 'garden-static-'));
    writeFileSync(join(clientDir, 'index.html'), '<div id="root">shell</div>');

    const app = Fastify();
    registerStaticRoutes(app, clientDir);
    try {
      const response = await app.inject({ method: 'GET', url: '/sessions/does-not-exist/oops' });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('shell');
    } finally {
      await app.close();
    }
  });
});
