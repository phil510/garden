import type { FastifyRequest } from 'fastify';

export interface SessionTargetRoute {
  Params: { id: string };
  Querystring: { target?: string };
}

export function sessionTarget({ params, query }: FastifyRequest<SessionTargetRoute>): string {
  // The CLI carries literal dot segments in the query so URL parsers cannot collapse them.
  return params.id === '-' && (query.target === '.' || query.target === '..')
    ? query.target
    : params.id;
}
