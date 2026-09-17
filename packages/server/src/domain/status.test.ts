import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { hookOutcome } from './status.js';

describe('hookOutcome', () => {
  it('carries a Notification message through as the status reason', () => {
    const outcome = hookOutcome(
      aHookEvent({ hook_event_name: 'Notification', message: 'Claude needs your permission' }),
    );
    expect(outcome).toEqual({
      status: 'waiting',
      reason: 'Claude needs your permission',
      ended: null,
    });
  });

  it('does not report a reason for events other than Notification', () => {
    expect(
      hookOutcome(aHookEvent({ hook_event_name: 'Stop', message: 'ignored' })).reason,
    ).toBeNull();
  });

  it('marks a session needs-approval on a PermissionRequest hook', () => {
    expect(hookOutcome(aHookEvent({ hook_event_name: 'PermissionRequest' })).status).toBe(
      'needs-approval',
    );
  });

  it('marks a session needs-approval on a permission_prompt Notification, so it cannot downgrade an existing needs-approval', () => {
    const outcome = hookOutcome(
      aHookEvent({
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission',
      }),
    );
    expect(outcome).toEqual({
      status: 'needs-approval',
      reason: 'Claude needs your permission',
      ended: null,
    });
  });

  it('still marks waiting for a Notification with a different notification_type', () => {
    const outcome = hookOutcome(
      aHookEvent({
        hook_event_name: 'Notification',
        notification_type: 'idle_timeout',
        message: 'Claude is waiting for your input',
      }),
    );
    expect(outcome).toEqual({
      status: 'waiting',
      reason: 'Claude is waiting for your input',
      ended: null,
    });
  });

  it('still marks waiting for a Notification with no notification_type', () => {
    const outcome = hookOutcome(
      aHookEvent({ hook_event_name: 'Notification', message: 'Claude needs your permission' }),
    );
    expect(outcome.status).toBe('waiting');
  });

  it('ends the session on SessionEnd without asserting a status', () => {
    const outcome = hookOutcome(aHookEvent({ hook_event_name: 'SessionEnd' }));
    expect(outcome.ended).toBe(true);
    expect(outcome.status).toBeNull();
  });

  it('un-ends the session on SessionStart, so a respawned pane comes back live', () => {
    expect(hookOutcome(aHookEvent({ hook_event_name: 'SessionStart' })).ended).toBe(false);
  });

  it('does not report working for a resume-source SessionStart', () => {
    const outcome = hookOutcome(aHookEvent({ hook_event_name: 'SessionStart', source: 'resume' }));
    expect(outcome.status).toBe('waiting');
    expect(outcome.ended).toBe(false);
  });

  it('does not report working for a startup-source SessionStart, so a fresh session waits for its first prompt', () => {
    const outcome = hookOutcome(aHookEvent({ hook_event_name: 'SessionStart', source: 'startup' }));
    expect(outcome.status).toBe('waiting');
    expect(outcome.ended).toBe(false);
  });

  it('still reports working for a SessionStart with no source', () => {
    expect(hookOutcome(aHookEvent({ hook_event_name: 'SessionStart' })).status).toBe('working');
  });

  it('transitions to working on a session’s first UserPromptSubmit', () => {
    expect(hookOutcome(aHookEvent({ hook_event_name: 'UserPromptSubmit' })).status).toBe('working');
  });

  it('returns no status for an unrecognised event name rather than throwing', () => {
    const outcome = hookOutcome(aHookEvent({ hook_event_name: 'SomeFutureHook' }));
    expect(outcome).toEqual({ status: null, reason: null, ended: null });
  });
});
