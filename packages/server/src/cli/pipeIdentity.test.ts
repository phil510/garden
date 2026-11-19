import { describe, expect, it } from 'vitest'
import { ownPipeSession } from './pipeIdentity.js'

describe('ownPipeSession', () => {
  it('uses the garden id alone inside a Codex pane', () => {
    expect(
      ownPipeSession({
        GARDEN_HARNESS: 'codex',
        GARDEN_SESSION_ID: 'garden',
        CLAUDE_CODE_SESSION_ID: 'other',
      }),
    ).toBe('garden')
    expect(ownPipeSession({ GARDEN_HARNESS: 'codex', GARDEN_SESSION_ID: '' })).toBeNull()
  })
  it('is null when GARDEN_SESSION_ID is unset', () => {
    expect(ownPipeSession({ CLAUDE_CODE_SESSION_ID: 'abc' })).toBeNull()
  })

  it('is null when GARDEN_SESSION_ID is empty, even if the Claude id is empty too', () => {
    expect(ownPipeSession({ GARDEN_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '' })).toBeNull()
  })

  it('is null when the ids differ', () => {
    expect(ownPipeSession({ GARDEN_SESSION_ID: 'abc', CLAUDE_CODE_SESSION_ID: 'xyz' })).toBeNull()
  })

  it('is null when the Claude id is unset', () => {
    expect(ownPipeSession({ GARDEN_SESSION_ID: 'abc' })).toBeNull()
  })

  it('is the garden id when both match', () => {
    expect(ownPipeSession({ GARDEN_SESSION_ID: 'abc', CLAUDE_CODE_SESSION_ID: 'abc' })).toBe('abc')
  })
})
