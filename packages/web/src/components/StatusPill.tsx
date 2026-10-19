import type { DisplayStatus } from './displayStatus';

const STATUS_LABEL: Record<DisplayStatus, string> = {
  working: 'working',
  'needs-approval': 'needs approval',
  waiting: 'waiting',
  unknown: 'unknown',
  alert: 'alert!',
};

const STATUS_COLOR_VAR: Record<DisplayStatus, string> = {
  working: 'var(--st-working)',
  'needs-approval': 'var(--st-needs-approval)',
  waiting: 'var(--st-waiting)',
  unknown: 'var(--st-unknown)',
  alert: 'var(--st-alert)',
};

/** The pill's border carries its status colour at a third of the text's opacity. */
const STATUS_BORDER_VAR: Record<DisplayStatus, string> = {
  working: 'var(--st-working-border)',
  'needs-approval': 'var(--st-needs-approval-border)',
  waiting: 'var(--st-waiting-border)',
  unknown: 'var(--st-unknown-border)',
  alert: 'var(--st-alert-border)',
};

interface StatusPillProps {
  status: DisplayStatus;
}

/** The sidebar row and the pane header both show a live session's status; this is the one
 *  place that maps a `DisplayStatus` to its label and colour. */
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
