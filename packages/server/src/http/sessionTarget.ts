import type { FastifyRequest } from 'fastify';

export interface SessionTargetRoute {
  Params: { id: string };
  Querystring: { target?: string | string[] };
}

export function sessionTarget({ params, query }: FastifyRequest<SessionTargetRoute>): string {
  if (params.id !== '-' || query.target === undefined) return params.id;
  if (Array.isArray(query.target))
    throw Object.assign(new Error('target must not be repeated'), { statusCode: 400 });
  return query.target;
}
