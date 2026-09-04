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
      recap: null,
      ended: null,
    });
  });

  it('does not report a reason for events other than Notification', () => {
    expect(
      hookOutcome(aHookEvent({ hook_event_name: 'Stop', message: 'ignored' })).reason,
    ).toBeNull();
  });

  it('takes the recap from last_assistant_message on Stop', () => {
    expect(
      hookOutcome(aHookEvent({ hook_event_name: 'Stop', last_assistant_message: 'Done.' })).recap,
    ).toBe('Done.');
  });

  it('ends the session on SessionEnd without asserting a status', () => {
    const outcome = hookOutcome(aHookEvent({ hook_event_name: 'SessionEnd' }));
    expect(outcome.ended).toBe(true);
    expect(outcome.status).toBeNull();
  });

  it('un-ends the session on SessionStart, so a respawned pane comes back live', () => {
    expect(hookOutcome(aHookEvent({ hook_event_name: 'SessionStart' })).ended).toBe(false);
  });

  it('returns no status for an unrecognised event name rather than throwing', () => {
    const outcome = hookOutcome(aHookEvent({ hook_event_name: 'SomeFutureHook' }));
    expect(outcome).toEqual({ status: null, reason: null, recap: null, ended: null });
  });
});
