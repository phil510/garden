import { describe, expect, it } from 'vitest';
import { sessionRowMenuAction, sessionRowMenuItems } from './sessionRowMenuItems';

describe('sessionRowMenuItems', () => {
  it('shows Kill session for a live, un-confirmed row', () => {
    expect(sessionRowMenuItems(false, null)).toEqual([
      { key: 'kill', label: 'Kill session', danger: true },
    ]);
  });

  it('shows Confirm kill for a live row mid-kill-confirm', () => {
    expect(sessionRowMenuItems(false, 'kill')).toEqual([
      { key: 'kill-confirm', label: 'Confirm kill', danger: true },
    ]);
  });

  it('shows Resume for a dead, un-confirmed row', () => {
    expect(sessionRowMenuItems(true, null)).toEqual([
      { key: 'resume', label: 'Resume', danger: false },
    ]);
  });

  it('shows Confirm resume for a dead row mid-resume-confirm', () => {
    expect(sessionRowMenuItems(true, 'resume')).toEqual([
      { key: 'resume-confirm', label: 'Confirm resume', danger: false },
    ]);
  });

  it('ignores a mismatched confirming value for a live row', () => {
    expect(sessionRowMenuItems(false, 'resume')).toEqual([
      { key: 'kill', label: 'Kill session', danger: true },
    ]);
  });

  it('ignores a mismatched confirming value for a dead row', () => {
    expect(sessionRowMenuItems(true, 'kill')).toEqual([
      { key: 'resume', label: 'Resume', danger: false },
    ]);
  });
});

describe('sessionRowMenuAction', () => {
  it('moves kill into its confirm state without acting', () => {
    expect(sessionRowMenuAction('kill')).toEqual({ confirming: 'kill', act: null });
  });

  it('fires kill and resets confirming on kill-confirm', () => {
    expect(sessionRowMenuAction('kill-confirm')).toEqual({ confirming: null, act: 'kill' });
  });

  it('moves resume into its confirm state without acting', () => {
    expect(sessionRowMenuAction('resume')).toEqual({ confirming: 'resume', act: null });
  });

  it('fires resume and resets confirming on resume-confirm', () => {
    expect(sessionRowMenuAction('resume-confirm')).toEqual({ confirming: null, act: 'resume' });
  });
});
