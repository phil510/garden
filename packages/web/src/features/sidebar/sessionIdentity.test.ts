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
      { key: 'name', text: 'scout', mono: false },
      { key: 'branch', text: 'main', mono: true },
      { key: 'time', text: 'just now', mono: true },
    ]);
  });

  it('omits the name segment when claudeSessionName is null', () => {
    const session = aSession({ claudeSessionName: null, branch: 'main', lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'branch', text: 'main', mono: true },
      { key: 'time', text: 'just now', mono: true },
    ]);
  });

  it('omits the branch segment when branch is null', () => {
    const session = aSession({ claudeSessionName: 'scout', branch: null, lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'name', text: 'scout', mono: false },
      { key: 'time', text: 'just now', mono: true },
    ]);
  });

  it('leaves only the time segment when name and branch are both unresolved', () => {
    const session = aSession({ claudeSessionName: null, branch: null, lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([{ key: 'time', text: 'just now', mono: true }]);
  });

  it('omits the name segment when claudeSessionName is an empty string', () => {
    const session = aSession({ claudeSessionName: '', branch: 'main', lastActivity: now });
    expect(metaLineSegments(session, now)).toEqual([
      { key: 'branch', text: 'main', mono: true },
      { key: 'time', text: 'just now', mono: true },
    ]);
  });
});

describe('metaLineSegmentClassName', () => {
  it('gives the name segment no layout class', () => {
    expect(metaLineSegmentClassName({ key: 'name', text: 'scout', mono: false })).toBe(undefined);
  });

  it('gives the branch segment its layout class plus mono', () => {
    expect(metaLineSegmentClassName({ key: 'branch', text: 'main', mono: true })).toBe(
      'row-branch mono',
    );
  });

  it('gives the time segment its layout class plus mono', () => {
    expect(metaLineSegmentClassName({ key: 'time', text: 'just now', mono: true })).toBe(
      'row-time mono',
    );
  });
});
