import { fakeClaudeHarness } from '../../../support/claudeHarness.js'
import { DEFAULT_UI_STATE } from '@garden/shared'
import { aSession } from '@garden/shared/fixtures'
import type { SessionsFilter, SessionState } from '@garden/shared'
import { describe, expect, it } from 'vitest'
import type {
  GardenEvent,
  Logger,
  OverlayState,
  TmuxNewSessionRequest,
  TmuxPort,
} from '../../../../packages/server/src/app/ports.js'
import type { Projection } from '../../../../packages/server/src/app/projection.js'
import type { SessionsDeps } from '../../../../packages/server/src/app/sessions.js'
import { createApp } from '../../../../packages/server/src/http/server.js'
import { sessionRoutes } from '../../../../packages/server/src/http/routes/sessions.js'

function spyLogger(): { logger: Logger; warnings: string[]; errors: string[] } {
  const warnings: string[] = []
  const errors: string[] = []
  return {
    logger: {
      warn: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
    warnings,
    errors,
  }
}

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

function fakeTmux(overrides: Partial<TmuxPort> = {}): TmuxPort {
  return {
    listPanes: () => Promise.resolve([]),
    newSession: () => Promise.reject(new Error('not used by this test')),
    respawnPane: () => Promise.reject(new Error('not used by this test')),
    killSession: () => Promise.reject(new Error('not used by this test')),
    ...overrides,
  }
}

/** `placementOf` defaults to "no placement" rather than throwing, since every
 *  `resumeSession` call reads it to decide whether a swarm needs unarchiving — a test with
 *  no swarms in play should not have to override it just to reach the behavior it actually
 *  exercises. */
function fakeProjection(
  sessions: SessionState[] = [],
  onSessions?: (filter: SessionsFilter | undefined) => void,
): Projection {
  return {
    sessions: (filter) => {
      onSessions?.(filter)
      return sessions
    },
    uiState: () => {
      throw new Error('not used by this test')
    },
    dispatch: () => undefined,
    updateUiState: () => {
      throw new Error('not used by this test')
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    overlay: () => {
      throw new Error('not used by this test')
    },
    updateOverlay: () => {
      throw new Error('not used by this test')
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => undefined,
  }
}

function buildApp(deps: SessionsDeps, logger?: Logger) {
  const app = createApp(logger)
  app.register((instance) => sessionRoutes(instance, deps))
  return app
}

const settingsPath = '/home/.garden/claude-settings.json'

describe('GET /sessions', () => {
  it('is mounted and answers with the projection sessions', async () => {
    const session = aSession({ id: 'sid-1' })
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([session]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ sessions: [session] })
  })

  it('passes an empty filter when no query params are given, leaving the 7-day/500-char defaults to the domain layer', async () => {
    let seenFilter: SessionsFilter | undefined
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([], (filter) => (seenFilter = filter)),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions' })

    expect(response.statusCode).toBe(200)
    expect(seenFilter).toEqual({})
  })

  it('passes explicit query params through as the filter', async () => {
    let seenFilter: SessionsFilter | undefined
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([], (filter) => (seenFilter = filter)),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?sinceDays=30&maxRecapChars=100&live=true&status=working',
    })

    expect(response.statusCode).toBe(200)
    expect(seenFilter).toEqual({
      sinceDays: 30,
      maxRecapChars: 100,
      live: true,
      status: 'working',
    })
  })

  it('rejects a non-numeric sinceDays with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=nope' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a non-numeric maxRecapChars with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=nope' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a negative sinceDays with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=-1' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a negative maxRecapChars with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=-1' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an empty sinceDays with a 400 rather than coercing to 0', async () => {
    // `Number('')` is `0`, which is a non-negative integer — checking the coerced result
    // alone would silently apply sinceDays: 0 instead of surfacing the caller's mistake.
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an empty maxRecapChars with a 400 rather than coercing to 0', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a fractional maxRecapChars with a 400', async () => {
    // A naive `Number.isFinite` boundary check lets 0.5 through: `.slice(-0.5)` truncates
    // toward zero to `.slice(-0)`, which is `.slice(0)` — the whole string, uncapped.
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?maxRecapChars=0.5' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a repeated sinceDays query key with a 400 from the boundary, not a downstream guard', async () => {
    // Fastify's default querystring parser turns a repeated key into an array at runtime,
    // even though `SessionsQuerystring` declares `sinceDays?: string | string[]` to match.
    // Asserting the error message (not just the status code) proves `narrowQueryField`
    // caught this — a field-specific message would mean some other check got lucky instead.
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?sinceDays=5&sinceDays=7' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'sinceDays must not be repeated' })
  })

  it('rejects a repeated maxRecapChars query key with a 400 from the boundary, not a downstream guard', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?maxRecapChars=100&maxRecapChars=200',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'maxRecapChars must not be repeated' })
  })

  it('rejects a repeated live query key with a 400 from the boundary', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?live=true&live=false' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'live must not be repeated' })
  })

  it('rejects a repeated status query key with a 400 from the boundary', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?status=working&status=idle',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'status must not be repeated' })
  })

  it('rejects a status value outside the four Status literals with a 400', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?status=bogus' })

    expect(response.statusCode).toBe(400)
  })

  it('folds swarm into the filter as swarmId', async () => {
    let seenFilter: SessionsFilter | undefined
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([], (filter) => (seenFilter = filter)),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'GET', url: '/sessions?swarm=swarm-1' })

    expect(response.statusCode).toBe(200)
    expect(seenFilter).toEqual({ swarmId: 'swarm-1' })
  })

  it('rejects a repeated swarm query key with a 400 from the boundary', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/sessions?swarm=a&swarm=b',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'swarm must not be repeated' })
  })
})

describe('POST /sessions', () => {
  it('keeps the generated id authoritative and ignores undeclared launch fields', async () => {
    const spawned: TmuxNewSessionRequest[] = []
    const dispatched: GardenEvent[] = []
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          spawned.push(request)
          return Promise.resolve()
        },
      }),
      projection: {
        ...fakeProjection(),
        dispatch: (event) => {
          dispatched.push(event)
        },
      },
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath),
    })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { cwd: '/work/repo', id: 'caller-chosen-id', permissionMode: 'bypassPermissions' },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json<{ id: string; tmuxName: string }>()
      expect(body.id).not.toBe('caller-chosen-id')
      expect(spawned).toEqual([
        {
          name: body.tmuxName,
          cwd: '/work/repo',
          port: 4310,
          sessionId: body.id,
          command: ['claude', '--session-id', body.id, '--settings', settingsPath],
        },
      ])
      expect(dispatched).toEqual([
        { type: 'session-registered', id: body.id, tmuxName: body.tmuxName, cwd: '/work/repo' },
      ])
    } finally {
      await app.close()
    }
  })

  it('rejects a body missing cwd without touching tmux', async () => {
    const calls: TmuxNewSessionRequest[] = []
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          calls.push(request)
          return Promise.resolve()
        },
      }),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'POST', url: '/sessions', payload: {} })

    expect(response.statusCode).toBe(400)
    expect(calls).toEqual([])
  })

  it.each([
    ['an unknown effort', { effort: 'extreme' }],
    ['an empty model', { model: '' }],
  ])('rejects %s without touching tmux', async (_label, extra) => {
    const calls: TmuxNewSessionRequest[] = []
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          calls.push(request)
          return Promise.resolve()
        },
      }),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden', ...extra },
    })

    expect(response.statusCode).toBe(400)
    expect(calls).toEqual([])
  })

  it('passes model and effort through to the spawned command', async () => {
    const calls: TmuxNewSessionRequest[] = []
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          calls.push(request)
          return Promise.resolve()
        },
      }),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden', model: 'opus', effort: 'high' },
    })

    expect(response.statusCode).toBe(200)
    expect(calls[0]?.command).toEqual(
      expect.arrayContaining(['--model', 'opus', '--effort', 'high']),
    )
  })

  it('creates a session and answers with its id and tmux name', async () => {
    const app = buildApp({
      tmux: fakeTmux({ newSession: () => Promise.resolve() }),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ id: string; tmuxName: string }>()
    expect(body.tmuxName).toBe('garden')
    expect(body.id).not.toBe('')
  })

  it('warns and strips unknownCaller from the wire response when callerSessionId does not resolve', async () => {
    const { logger, warnings } = spyLogger()
    const app = buildApp(
      {
        tmux: fakeTmux({ newSession: () => Promise.resolve() }),
        projection: {
          ...fakeProjection(),
          updateOverlay: (mutate) => mutate(emptyOverlay),
        },
        serverPort: 4310,
        harness: fakeClaudeHarness(settingsPath, () => ['claude']),
      },
      logger,
    )

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden', callerSessionId: 'ghost' },
    })

    expect(response.statusCode).toBe(200)
    expect(Object.keys(response.json<object>())).toEqual(['id', 'tmuxName'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/unknown caller/)
  })

  it('maps a tmux failure to a 500 rather than a 404', async () => {
    const app = buildApp({
      tmux: fakeTmux({ newSession: () => Promise.reject(new Error('tmux is not installed')) }),
      projection: fakeProjection(),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { cwd: '/Users/dev/garden' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'tmux is not installed' })
  })

  it('logs a failed create through the given logger', async () => {
    const { logger, errors } = spyLogger()
    const app = buildApp(
      {
        tmux: fakeTmux({ newSession: () => Promise.reject(new Error('tmux is not installed')) }),
        projection: fakeProjection(),
        serverPort: 4310,
        harness: fakeClaudeHarness(settingsPath, () => ['claude']),
      },
      logger,
    )

    await app.inject({ method: 'POST', url: '/sessions', payload: { cwd: '/Users/dev/garden' } })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^Error: tmux is not installed\n/)
  })
})

describe('POST /sessions/:id/resume', () => {
  it('takes resume identity and permissions from the session and instance', async () => {
    const spawned: TmuxNewSessionRequest[] = []
    const app = buildApp({
      tmux: fakeTmux({
        newSession: (request) => {
          spawned.push(request)
          return Promise.resolve()
        },
      }),
      projection: fakeProjection([
        aSession({ id: 'sid-1', cwd: '/work/repo', liveness: 'dead', tmuxName: null }),
      ]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath),
    })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/sid-1/resume',
        payload: { id: 'caller-chosen-id', cwd: '/other', permissionMode: 'bypassPermissions' },
      })
      expect(response.statusCode).toBe(200)
      expect(spawned[0]).toMatchObject({
        sessionId: 'sid-1',
        cwd: '/work/repo',
        command: ['claude', '--resume', 'sid-1', '--settings', settingsPath],
      })
    } finally {
      await app.close()
    }
  })

  it('maps an unknown session id to 404', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'POST', url: '/sessions/nope/resume' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'no such session: nope' })
  })

  it('resumes a known session and answers with its id and tmux name', async () => {
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' })
    const app = buildApp({
      tmux: fakeTmux({
        listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
        respawnPane: () => Promise.resolve(),
      }),
      projection: fakeProjection([deadSession]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'POST', url: '/sessions/sid-1/resume' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ id: 'sid-1', tmuxName: 'garden' })
  })

  it.each([
    ['an unknown effort', { effort: 'extreme' }],
    ['a null model', { model: null }],
    ['an array body', ['opus']],
  ])('rejects %s without touching tmux', async (_label, payload) => {
    const respawned: unknown[] = []
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' })
    const app = buildApp({
      tmux: fakeTmux({
        listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
        respawnPane: (request) => {
          respawned.push(request)
          return Promise.resolve()
        },
      }),
      projection: fakeProjection([deadSession]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/sid-1/resume',
      payload,
    })

    expect(response.statusCode).toBe(400)
    expect(respawned).toEqual([])
  })

  it('passes model and effort from the body to the resumed command', async () => {
    const respawned: { command: readonly string[] }[] = []
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' })
    const app = buildApp({
      tmux: fakeTmux({
        listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
        respawnPane: (request) => {
          respawned.push(request)
          return Promise.resolve()
        },
      }),
      projection: fakeProjection([deadSession]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/sid-1/resume',
      payload: { model: 'opus', effort: 'low' },
    })

    expect(response.statusCode).toBe(200)
    expect(respawned[0]?.command).toEqual(
      expect.arrayContaining(['--model', 'opus', '--effort', 'low']),
    )
  })

  it('resumes the session named in the URL even when the body carries another id', async () => {
    const app = buildApp({
      tmux: fakeTmux({
        listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
        respawnPane: () => Promise.resolve(),
      }),
      projection: fakeProjection([
        aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' }),
        aSession({ id: 'sid-2', cwd: '/Users/dev/other', tmuxName: 'other' }),
      ]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/sid-1/resume',
      payload: { id: 'sid-2' },
    })

    expect(response.json()).toEqual({ id: 'sid-1', tmuxName: 'garden' })
  })

  it('logs a failed resume through the given logger', async () => {
    const deadSession = aSession({ id: 'sid-1', cwd: '/Users/dev/garden', tmuxName: 'garden' })
    const { logger, errors } = spyLogger()
    const app = buildApp(
      {
        tmux: fakeTmux({
          listPanes: () => Promise.resolve([{ session: 'garden', dead: true, exitCode: 1 }]),
          respawnPane: () => Promise.reject(new Error('tmux is not installed')),
        }),
        projection: fakeProjection([deadSession]),
        serverPort: 4310,
        harness: fakeClaudeHarness(settingsPath, () => ['claude']),
      },
      logger,
    )

    await app.inject({ method: 'POST', url: '/sessions/sid-1/resume' })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^Error: tmux is not installed\n/)
  })
})

describe('POST /sessions/:id/kill', () => {
  it('maps an unknown session id to 404', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'POST', url: '/sessions/nope/kill' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'no such session: nope' })
  })

  it('kills a known session and answers ok', async () => {
    const session = aSession({ id: 'sid-1', tmuxName: 'garden' })
    const app = buildApp({
      tmux: fakeTmux({ killSession: () => Promise.resolve() }),
      projection: fakeProjection([session]),
      serverPort: 4310,
      harness: fakeClaudeHarness(settingsPath, () => ['claude']),
    })

    const response = await app.inject({ method: 'POST', url: '/sessions/sid-1/kill' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })

  it('logs a failed kill through the given logger', async () => {
    const session = aSession({ id: 'sid-1', tmuxName: 'garden' })
    const { logger, errors } = spyLogger()
    const app = buildApp(
      {
        tmux: fakeTmux({ killSession: () => Promise.reject(new Error('tmux is not installed')) }),
        projection: fakeProjection([session]),
        serverPort: 4310,
        harness: fakeClaudeHarness(settingsPath, () => ['claude']),
      },
      logger,
    )

    await app.inject({ method: 'POST', url: '/sessions/sid-1/kill' })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^Error: tmux is not installed\n/)
  })
})

describe('POST session messages', () => {
  it('validates text and delivers using only the addressed garden id', async () => {
    const delivered: unknown[] = []
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([aSession({ id: 'garden' })]),
      serverPort: 4311,
      harness: {
        spawnCommand: () => [],
        resumeCommand: () => [],
        sendMessage: (id, message) => {
          delivered.push([id, message])
          return Promise.resolve()
        },
      },
    })
    for (const message of [null, 23, '', '   ', 'unsafe\x1b[31m', 'unsafe\u0000']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/sessions/garden/messages',
            payload: { message },
          })
        ).statusCode,
      ).toBe(400)
    }
    const message = 'literal $(touch no) `echo no`\nsecond line'
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/garden/messages',
      payload: { message, codexId: 'untrusted', id: 'other' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(delivered).toEqual([['garden', message]])
    await app.close()
  })
  it('returns a clear unsupported response on Claude and a missing-session response for unknown ids', async () => {
    const app = buildApp({
      tmux: fakeTmux(),
      projection: fakeProjection([aSession({ id: 'garden' })]),
      serverPort: 4310,
      harness: fakeClaudeHarness('/settings', () => ['claude']),
    })
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/garden/messages',
      payload: { message: 'hello' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ error: string }>().error).toContain(
      'not supported by the selected harness',
    )
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/sessions/missing/messages',
          payload: { message: 'hello' },
        })
      ).statusCode,
    ).toBe(404)
    await app.close()
  })
})
