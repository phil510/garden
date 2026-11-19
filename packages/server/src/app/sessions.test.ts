import type { SendSessionMessageRequest } from '@garden/shared'
import { aSession } from '@garden/shared/fixtures'
import { describe, expect, it, vi } from 'vitest'
import type { Projection } from './projection.js'
import type { HarnessLaunchRequest, TmuxNewSessionRequest, TmuxPort } from './ports.js'
import { fakeHarness } from './harness.fixture.js'
import { AmbiguousSessionNameError, SessionMessagingError, SessionNotFoundError } from './errors.js'
import { createSession, killSession, resumeSession, sendSessionMessage } from './sessions.js'

describe('createSession harness boundary', () => {
  it('passes launch choices to the harness and registers only after tmux accepts its command', async () => {
    const command = ['vendor-launch', 'opaque-native-argument']
    const spawnCommand = vi.fn<(request: HarnessLaunchRequest) => readonly string[]>(() => command)
    const dispatch = vi.fn()
    const projection = { dispatch, sessions: () => [] } as unknown as Projection
    let finishLaunch: (() => void) | undefined
    const newSession = vi.fn<(request: TmuxNewSessionRequest) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finishLaunch = resolve
        }),
    )
    const tmux = { listPanes: () => Promise.resolve([]), newSession } as unknown as TmuxPort
    const pending = createSession(
      {
        projection,
        tmux,
        serverPort: 4310,
        permissionMode: 'bypassPermissions',
        harness: {
          ...fakeHarness(),
          spawnCommand,
          beforeLaunch: () => ({
            sessionName: 'repo-abc123',
            rollback: vi.fn(),
            registrationStatus: () => ({ status: 'waiting', reason: 'starting' }),
          }),
        },
      },
      { cwd: '/repo', model: 'selected-model', effort: 'high' },
    )
    await vi.waitFor(() => expect(newSession).toHaveBeenCalledOnce())
    expect(dispatch).not.toHaveBeenCalled()
    const launch = spawnCommand.mock.calls[0]![0]
    expect(launch.id).toMatch(/^[a-f0-9-]+$/)
    expect(launch).toEqual({
      id: launch.id,
      cwd: '/repo',
      model: 'selected-model',
      effort: 'high',
      permissionMode: 'bypassPermissions',
    })
    expect(newSession.mock.calls[0]![0]).toMatchObject({ command })
    finishLaunch!()
    const result = await pending
    expect(result.sessionName).toBe('repo-abc123')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session-registered',
      id: result.id,
      tmuxName: result.tmuxName,
      cwd: '/repo',
      sessionName: 'repo-abc123',
      reported: { status: 'waiting', reason: 'starting' },
    })
  })

  it('does not register a process tmux refused to start', async () => {
    const dispatch = vi.fn()
    const failure = new Error('spawn refused')
    const rollback = vi.fn()
    const tmux = {
      listPanes: () => Promise.resolve([]),
      newSession: () => Promise.reject(failure),
    } as unknown as TmuxPort
    await expect(
      createSession(
        {
          projection: { dispatch, sessions: () => [] } as unknown as Projection,
          tmux,
          harness: {
            ...fakeHarness(),
            beforeLaunch: () => ({
              sessionName: 'repo-abc123',
              rollback,
              registrationStatus: () => undefined,
            }),
          },
          serverPort: 4310,
        },
        { cwd: '/repo' },
      ),
    ).rejects.toBe(failure)
    expect(rollback).toHaveBeenCalledOnce()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('session operation targets', () => {
  const id = 'c8567654-97b1-45d1-ab73-854fda26e1e5'
  const sessionName = 'Scout / Review'
  const tmuxName = 'repo-pane'
  const session = aSession({ id, sessionName, tmuxName, cwd: '/repo', title: 'Review notes' })

  function fixture(rows = [session]) {
    const dispatch = vi.fn()
    const placementOf = vi.fn(() => undefined)
    const updateOverlay = vi.fn()
    const projection = {
      sessions: () => rows,
      dispatch,
      placementOf,
      updateOverlay,
    } as unknown as Projection
    const tmux = {
      listPanes: vi.fn(() =>
        Promise.resolve([{ session: tmuxName, dead: false, exitCode: undefined }]),
      ),
      newSession: vi.fn().mockResolvedValue(undefined),
      respawnPane: vi.fn().mockResolvedValue(undefined),
      killSession: vi.fn().mockResolvedValue(undefined),
      submitMessage: vi.fn().mockResolvedValue(undefined),
    }
    const harness = { ...fakeHarness(), resumeCommand: vi.fn(() => ['resume']) }
    const deps = { projection, serverPort: 4310, tmux, harness }
    return { deps, tmux, harness, dispatch, placementOf, updateOverlay }
  }

  it('resumes the selected UUID when called with its exact name', async () => {
    const { deps, tmux, harness, dispatch, placementOf } = fixture()
    tmux.listPanes.mockResolvedValue([])
    const result = await resumeSession(deps, { id: sessionName })
    expect(result.id).toBe(id)
    expect(harness.resumeCommand).toHaveBeenCalledWith({ id, cwd: '/repo' })
    expect(tmux.newSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id }))
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-registered', id }),
    )
    expect(placementOf).toHaveBeenCalledWith(id)
  })

  it.each([sessionName, id])(
    'kills the selected UUID and clears its alert for %s',
    async (target) => {
      const { deps, tmux, dispatch, updateOverlay } = fixture([
        aSession({ id: 'different', sessionName: id, tmuxName: 'wrong-pane' }),
        { ...session, alert: { text: 'look', raisedAt: 1, updatedAt: 1 } },
      ])
      await killSession(deps, { id: target })
      expect(tmux.killSession).toHaveBeenCalledExactlyOnceWith(tmuxName)
      expect(dispatch.mock.calls).toEqual([
        [{ type: 'session-unregistered', id }],
        [{ type: 'alert-changed', sessionId: id, alert: null }],
      ])
      expect(updateOverlay).toHaveBeenCalledOnce()
    },
  )

  it('uses the selected UUID even when the name changes before pending delivery', async () => {
    const rows = [{ ...session }]
    const { deps, tmux } = fixture(rows)
    const sendMessage = vi.fn(
      async (_id: string, _message: string, submitPending: () => Promise<void>) => {
        rows[0] = { ...session, sessionName: 'Renamed' }
        await submitPending()
      },
    )
    await sendSessionMessage({ ...deps, harness: { ...deps.harness, sendMessage } }, sessionName, {
      message: 'hello',
    })
    const expected = '[Message from external shell]\n\nhello'
    expect(sendMessage).toHaveBeenCalledWith(id, expected, expect.any(Function))
    expect(tmux.submitMessage).toHaveBeenCalledExactlyOnceWith(tmuxName, expected)
  })

  const callerId = '8fb1bdb0-acd1-4195-9d52-88dea91f21db'
  const unnamedCallerId = 'e70efe68-2546-4c22-8003-ea7b457dbea1'
  const callerName = 'upstream-work'
  const cases = [
    [
      { type: 'session', callerSessionId: callerId },
      `[Message from session ${callerId}/${callerName}]`,
    ],
    [
      { type: 'session', callerSessionId: unnamedCallerId },
      `[Message from session ${unnamedCallerId}]`,
    ],
    [{ type: 'session', callerSessionId: callerName }, '[Message from external shell]'],
    [
      { type: 'session', callerSessionId: 'native-conversation-id' },
      '[Message from external shell]',
    ],
    [undefined, '[Message from external shell]'],
    [{ type: 'pr-watch' }, '[PR watch notification]'],
  ] satisfies ReadonlyArray<readonly [SendSessionMessageRequest['source'], string]>

  describe.each(['queue', 'pending'])('%s delivery', (delivery) => {
    it.each(cases)(
      'formats source %j and preserves every body character',
      async (source, header) => {
        const { deps, tmux } = fixture([
          aSession({ id: 'lookalike', sessionName: callerId }),
          aSession({ id: callerId, sessionName: callerName, title: 'native-conversation-id' }),
          aSession({ id: unnamedCallerId }),
          session,
        ])
        const sendMessage = vi.fn(
          async (_id: string, _message: string, submitPending: () => Promise<void>) => {
            if (delivery === 'pending') await submitPending()
          },
        )
        const message = '  hi\n\t second line  \n'
        const expected = `${header}\n\n${message}`
        await sendSessionMessage(
          { ...deps, harness: { ...deps.harness, sendMessage } },
          sessionName,
          { message, ...(source === undefined ? {} : { source }) },
        )
        expect(sendMessage).toHaveBeenCalledExactlyOnceWith(id, expected, expect.any(Function))
        if (delivery === 'pending') {
          expect(tmux.submitMessage).toHaveBeenCalledExactlyOnceWith(tmuxName, expected)
        } else {
          expect(tmux.submitMessage).not.toHaveBeenCalled()
        }
      },
    )
  })

  it('does not send through a harness with no message delivery', async () => {
    const { deps, tmux } = fixture()
    await expect(sendSessionMessage(deps, id, { message: 'hello' })).rejects.toBeInstanceOf(
      SessionMessagingError,
    )
    expect(tmux.submitMessage).not.toHaveBeenCalled()
  })

  it('rejects missing, inexact and ambiguous targets without touching tmux or state', async () => {
    const { deps, tmux, dispatch, updateOverlay } = fixture([
      session,
      aSession({ id: '1-competing-id', sessionName }),
    ])
    for (const target of ['scout / review', 'Scout', tmuxName, 'Review notes']) {
      await expect(resumeSession(deps, { id: target })).rejects.toBeInstanceOf(SessionNotFoundError)
    }
    await expect(killSession(deps, { id: sessionName })).rejects.toBeInstanceOf(
      AmbiguousSessionNameError,
    )
    await expect(killSession(deps, { id: sessionName })).rejects.toThrow(
      `Matching IDs: 1-competing-id, ${id}`,
    )
    expect(tmux.listPanes).not.toHaveBeenCalled()
    expect(tmux.killSession).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(updateOverlay).not.toHaveBeenCalled()
  })
})
