import type { Alert } from '@garden/shared';
import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { alertAgesLine, collectAlerts } from './allAlerts';

const MIN = 60 * 1000;
const alert = (raisedAt: number, updatedAt = raisedAt): Alert => ({
  text: 'text',
  raisedAt,
  updatedAt,
});
const ids = (sessions: { id: string }[]) => sessions.map((session) => session.id);

describe('collectAlerts', () => {
  it('leaves out sessions without an alert', () => {
    const sessions = [aSession({ id: 'a' }), aSession({ id: 'b', alert: alert(1) })];
    expect(ids(collectAlerts(sessions))).toEqual(['b']);
  });

  it('orders by when the alert was first raised, oldest first', () => {
    const sessions = [
      aSession({ id: 'new', alert: alert(300) }),
      aSession({ id: 'old', alert: alert(100) }),
      aSession({ id: 'mid', alert: alert(200) }),
    ];
    expect(ids(collectAlerts(sessions))).toEqual(['old', 'mid', 'new']);
  });

  it('keeps a replaced alert in its place', () => {
    const sessions = [
      aSession({ id: 'replaced', alert: alert(100, 900) }),
      aSession({ id: 'later', alert: alert(200) }),
    ];
    expect(ids(collectAlerts(sessions))).toEqual(['replaced', 'later']);
  });

  it('breaks a raisedAt tie by session id', () => {
    const sessions = [
      aSession({ id: 'b', alert: alert(100) }),
      aSession({ id: 'a', alert: alert(100) }),
    ];
    expect(ids(collectAlerts(sessions))).toEqual(['a', 'b']);
  });

  it('includes dead sessions', () => {
    const sessions = [aSession({ id: 'dead', liveness: 'dead', alert: alert(1) })];
    expect(ids(collectAlerts(sessions))).toEqual(['dead']);
  });
});

describe('alertAgesLine', () => {
  const now = 10 * 60 * MIN;

  it('shows only the raised age for an alert that was never replaced', () => {
    expect(alertAgesLine(alert(now - 3 * 60 * MIN), now)).toBe('raised 3h ago');
  });

  it('adds the updated age once it differs from the raised age', () => {
    expect(alertAgesLine(alert(now - 3 * 60 * MIN, now - 60 * MIN), now)).toBe(
      'raised 3h ago · updated 1h ago',
    );
  });

  it('omits the updated age when both round to the same age', () => {
    expect(alertAgesLine(alert(now - 5 * MIN - 30000, now - 5 * MIN), now)).toBe('raised 5m ago');
  });
});
