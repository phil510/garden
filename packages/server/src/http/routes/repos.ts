import type { ReposResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import type { RepoCatalog } from '../../app/repoCatalog.js';

export function repoRoutes(app: FastifyInstance, deps: { readonly repos: RepoCatalog }) {
  app.get('/repos', async (): Promise<ReposResponse> => ({ repos: await deps.repos.list() }));
}
