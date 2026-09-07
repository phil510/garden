import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const API_PATH_PREFIXES = [
  '/health',
  '/hooks',
  '/sessions',
  '/repos',
  '/ui-state',
  '/fs',
  '/events',
  '/attach',
];

function isApiPath(pathname: string): boolean {
  return API_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * esbuild bundles the server into one file, so `import.meta.url` resolves to `dist/garden.js`
 * at runtime regardless of source layout. The bundled binary ships the client at `dist/web`
 * (see build.ts); running from source, the client lives at `packages/web/dist`.
 */
export function resolveClientDir(
  moduleDir: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const bundled = join(moduleDir, 'web');
  if (exists(bundled)) {
    return bundled;
  }
  return join(moduleDir, '../../../web/dist');
}

export function registerStaticRoutes(app: FastifyInstance, clientDir: string): void {
  app.register(fastifyStatic, { root: clientDir });

  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url ?? '', 'http://localhost').pathname;
    // An unmatched API route must stay a 404, not silently fall through to the SPA shell.
    if (request.method !== 'GET' || isApiPath(pathname)) {
      reply.code(404).send();
      return;
    }
    reply.sendFile('index.html');
  });
}
