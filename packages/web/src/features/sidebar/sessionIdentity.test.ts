import { aSession } from '@garden/shared/fixtures'
import { describe, expect, it } from 'vitest'
import { metaLineSegmentClassName, metaLineSegments, sessionIdentityLabel } from './sessionIdentity'

describe('sessionIdentityLabel', () => {
  it('passes a real name through unchanged', () => {
    expect(sessionIdentityLabel('scout')).toBe('scout')
  })

  it('treats null as absent', () => {
    expect(sessionIdentityLabel(null)).toBe(null)
  })

  it('treats an empty string as absent', () => {
    expect(sessionIdentityLabel('')).toBe(null)
  })
})

describe('metaLineSegments', () => {
  const now = 1_000_000

  it('includes the name segment when sessionName is present', () => {
    const session = aSession({ sessionName: 'scout', lastActivity: now })
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'name', text: 'scout' },
      { key: 'time', text: 'just now' },
    ])
  })

  it('leaves only the time segment when sessionName is null', () => {
    const session = aSession({ sessionName: null, lastActivity: now })
    expect(metaLineSegments(session, now)).toEqual([{ key: 'time', text: 'just now' }])
  })

  it('leaves only the time segment when sessionName is an empty string', () => {
    const session = aSession({ sessionName: '', lastActivity: now })
    expect(metaLineSegments(session, now)).toEqual([{ key: 'time', text: 'just now' }])
  })
})

describe('metaLineSegmentClassName', () => {
  it('gives the name segment its overflow-truncation layout class', () => {
    expect(metaLineSegmentClassName({ key: 'name', text: 'scout' })).toBe('row-name')
  })

  it('gives the time segment its layout class plus mono', () => {
    expect(metaLineSegmentClassName({ key: 'time', text: 'just now' })).toBe('row-time mono')
  })
})
