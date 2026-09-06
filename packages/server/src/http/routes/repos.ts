import type { ReposResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { listRepos } from '../../app/repos.js';
import type { ReposDeps } from '../../app/repos.js';

export function repoRoutes(app: FastifyInstance, deps: ReposDeps) {
  app.get('/repos', async (): Promise<ReposResponse> => ({ repos: await listRepos(deps) }));
}
