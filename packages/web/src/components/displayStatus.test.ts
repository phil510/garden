import type { Alert, Status } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { displayStatus } from './displayStatus';

const alert: Alert = { text: 'need a call', raisedAt: 1, updatedAt: 1 };

describe('displayStatus', () => {
  it.each<[Status, Status | 'alert']>([
    ['needs-approval', 'needs-approval'],
    ['working', 'working'],
    ['waiting', 'alert'],
    ['unknown', 'alert'],
  ])('shows %s with an open alert as %s', (status, expected) => {
    expect(displayStatus(status, alert)).toBe(expected);
  });

  it.each<Status>(['needs-approval', 'working', 'waiting', 'unknown'])(
    'shows %s unchanged when there is no alert',
    (status) => {
      expect(displayStatus(status, null)).toBe(status);
    },
  );
});
