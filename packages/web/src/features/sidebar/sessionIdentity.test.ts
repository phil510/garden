import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  metaLineSegmentClassName,
  metaLineSegments,
  sessionIdentityLabel,
} from './sessionIdentity';

describe('sessionIdentityLabel', () => {
  it('passes a real name through unchanged', () => {
    expect(sessionIdentityLabel('scout')).toBe('scout');
  });

  it('treats null as absent', () => {
    expect(sessionIdentityLabel(null)).toBe(null);
  });

  it('treats an empty string as absent', () => {
    expect(sessionIdentityLabel('')).toBe(null);
  });
});

describe('metaLineSegments', () => {
  const now = 1_000_000;

  it('includes the name and branch when both are present', () => {
    const session = aSession({ claudeSessionName: 'scout', branch: 'main', lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'name', text: 'scout' },
      { key: 'branch', text: 'main' },
      { key: 'time', text: 'just now' },
    ]);
  });

  it('omits the name segment when claudeSessionName is null', () => {
    const session = aSession({ claudeSessionName: null, branch: 'main', lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'branch', text: 'main' },
      { key: 'time', text: 'just now' },
    ]);
  });

  it('omits the branch segment when branch is null', () => {
    const session = aSession({ claudeSessionName: 'scout', branch: null, lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'name', text: 'scout' },
      { key: 'time', text: 'just now' },
    ]);
  });

  it('leaves only the time segment when name and branch are both unresolved', () => {
    const session = aSession({ claudeSessionName: null, branch: null, lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([{ key: 'time', text: 'just now' }]);
  });

  it('omits the name segment when claudeSessionName is an empty string', () => {
    const session = aSession({ claudeSessionName: '', branch: 'main', lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'branch', text: 'main' },
      { key: 'time', text: 'just now' },
    ]);
  });
});

describe('metaLineSegmentClassName', () => {
  it('gives the name segment its overflow-truncation layout class', () => {
    expect(metaLineSegmentClassName({ key: 'name', text: 'scout' })).toBe('row-name');
  });

  it('gives the branch segment its layout class plus mono', () => {
    expect(metaLineSegmentClassName({ key: 'branch', text: 'main' })).toBe('row-branch mono');
  });

  it('gives the time segment its layout class plus mono', () => {
    expect(metaLineSegmentClassName({ key: 'time', text: 'just now' })).toBe('row-time mono');
  });
});
