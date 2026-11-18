import { DEFAULT_UI_STATE } from '@garden/shared'
import type { HarnessPort } from '../../app/ports.js'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { GardenEvent } from '../../app/ports.js'
import type { Projection } from '../../app/projection.js'
import type { OverlayState } from '../../app/ports.js'
import { hookRoutes } from './hooks.js'

const emptyOverlay: OverlayState = {
  version: 2,
  tmuxNames: {},
  ui: DEFAULT_UI_STATE,
  watches: [],
  alerts: [],
  digests: [],
  pipes: {},
  reviews: { links: {} },
}

function fakeProjection() {
  const dispatched: GardenEvent[] = []
  let overlayWrites = 0
  const projection: Projection = {
    sessions: () => [],
    uiState: () => {
      throw new Error('not used by this test')
    },
    dispatch: (event) => dispatched.push(event),
    updateUiState: () => {
      throw new Error('not used by this test')
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    overlay: () => {
      throw new Error('not used by this test')
    },
    updateOverlay: (mutate) => {
      overlayWrites += 1
      return mutate(emptyOverlay)
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => {
      throw new Error('not used by this test')
    },
  }
  return { projection, dispatched, overlayWrites: () => overlayWrites }
}

const aHarnessSignal = (
  overrides: Partial<NonNullable<ReturnType<HarnessPort['parseHook']>>> = {},
) => ({
  sessionId: 'sid-1',
  cwd: '/Users/dev/repo',
  transcriptPath: '/t.jsonl',
  ended: null,
  conversationCleared: false,
  ...overrides,
})

function buildApp(
  projection: Projection,
  parseHook: HarnessPort['parseHook'] = () => aHarnessSignal(),
) {
  const app = Fastify()
  app.register((instance) =>
    hookRoutes(instance, {
      harness: { parseHook },
      projection,
      liveTranscripts: { track: () => undefined },
    }),
  )
  return app
}

describe('POST /hooks', () => {
  it('dispatches a valid payload and answers 204', async () => {
    const { projection, dispatched } = fakeProjection()
    const app = buildApp(projection)
    const payload = { vendorEvent: 'finished' }

    const response = await app.inject({ method: 'POST', url: '/hooks', payload })

    expect(response.statusCode).toBe(204)
    expect(dispatched).toMatchObject([
      {
        type: 'harness-signal',
        signal: {
          sessionId: 'sid-1',
          cwd: '/Users/dev/repo',
          transcriptPath: '/t.jsonl',
        },
      },
    ])
  })

  it('stores a hook for a session id it has never seen, rather than rejecting it', async () => {
    const { projection, dispatched } = fakeProjection()
    const app = buildApp(projection)
    const payload = { vendorEvent: 'finished' }

    const response = await app.inject({ method: 'POST', url: '/hooks', payload })

    expect(response.statusCode).toBe(204)
    expect(dispatched).toMatchObject([
      {
        type: 'harness-signal',
        signal: {
          sessionId: 'sid-1',
          cwd: '/Users/dev/repo',
          transcriptPath: '/t.jsonl',
        },
      },
    ])
  })

  it('returns 400 when the harness rejects its native body', async () => {
    const { projection, dispatched } = fakeProjection()
    const app = buildApp(projection, () => null)
    const response = await app.inject({
      method: 'POST',
      url: '/hooks',
      payload: { vendorEvent: 'invalid' },
    })
    expect(response.statusCode).toBe(400)
    expect(dispatched).toEqual([])
    await app.close()
  })

  it('hands a clear with the garden session header to the watch writer, and ignores a missing or empty one', async () => {
    const { projection, overlayWrites } = fakeProjection()
    const app = buildApp(projection, (_body, sessionId) =>
      aHarnessSignal({ conversationCleared: sessionId !== undefined }),
    )
    const payload = { vendorEvent: 'cleared' }
    const post = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/hooks', payload, headers })

    await post({})
    await post({ 'x-garden-session': '' })
    expect(overlayWrites()).toBe(0)

    await post({ 'x-garden-session': 'garden-1' })
    expect(overlayWrites()).toBe(1)
  })
})
