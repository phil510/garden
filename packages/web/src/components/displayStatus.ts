import type { Alert, Status } from '@garden/shared';

export type DisplayStatus = Status | 'alert';

/**
 * The status a row or pane header shows. An open alert outranks an idle session (`waiting`,
 * `unknown`) but never hides one that is working or waiting on an approval.
 */
export function displayStatus(status: Status, alert: Alert | null): DisplayStatus {
  if (status === 'needs-approval' || status === 'working') return status;
  return alert === null ? status : 'alert';
}
