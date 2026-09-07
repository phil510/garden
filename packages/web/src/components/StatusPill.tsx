import type { Status } from '@garden/shared';

const STATUS_LABEL: Record<Status, string> = {
  working: 'working',
  'needs-approval': 'needs approval',
  waiting: 'waiting',
  unknown: 'unknown',
};

const STATUS_COLOR_VAR: Record<Status, string> = {
  working: 'var(--st-working)',
  'needs-approval': 'var(--st-needs-approval)',
  waiting: 'var(--st-waiting)',
  unknown: 'var(--st-unknown)',
};

/** The pill's border carries its status colour at a third of the text's opacity. */
const STATUS_BORDER_VAR: Record<Status, string> = {
  working: 'var(--st-working-border)',
  'needs-approval': 'var(--st-needs-approval-border)',
  waiting: 'var(--st-waiting-border)',
  unknown: 'var(--st-unknown-border)',
};

interface StatusPillProps {
  status: Status;
}

/** The sidebar row and the pane header both show a live session's status; this is the one
 *  place that maps a `Status` to its label and colour. */
export function StatusPill({ status }: StatusPillProps) {
  return (
    <span
      className="status-pill"
      style={{ color: STATUS_COLOR_VAR[status], borderColor: STATUS_BORDER_VAR[status] }}
    >
      <span className="dot" style={{ background: STATUS_COLOR_VAR[status] }} />
      {STATUS_LABEL[status]}
    </span>
  );
}
