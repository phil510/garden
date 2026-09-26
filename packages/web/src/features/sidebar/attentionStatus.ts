import type { Status } from '@garden/shared';

/** The one rule for whether a session's status counts as needing the user's attention,
 *  shared by repo groups (a boolean) and swarm groups (a count) so neither re-declares it. */
export function isAttentionStatus(status: Status | null): boolean {
  return status === 'needs-approval' || status === 'waiting';
}
