import type { ErrorResponse } from '@garden/shared'
import type { FastifyInstance } from 'fastify'
import { handleHook, type HooksDeps } from '../../app/hooks.js'

export function hookRoutes(app: FastifyInstance, deps: HooksDeps) {
  app.post('/hooks', (request, reply) => {
    const header = request.headers['x-garden-session']
    const accepted = handleHook(
      deps,
      request.body,
      typeof header === 'string' && header !== '' ? header : undefined,
    )
    if (!accepted)
      return reply.code(400).send({ error: 'invalid hook payload' } satisfies ErrorResponse)
    return reply.code(204).send()
  })
}
