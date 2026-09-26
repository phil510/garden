export type ConfirmingAction = 'kill' | 'resume' | null;

/** The single Kill/Resume item to show in a session row's context menu, given its liveness
 *  and whether that row is mid-confirm for its own action. */
export function sessionRowMenuItems(
  dead: boolean,
  confirming: ConfirmingAction,
): Array<{ key: string; label: string; danger: boolean }> {
  if (dead) {
    return confirming === 'resume'
      ? [{ key: 'resume-confirm', label: 'Confirm resume', danger: false }]
      : [{ key: 'resume', label: 'Resume', danger: false }];
  }
  return confirming === 'kill'
    ? [{ key: 'kill-confirm', label: 'Confirm kill', danger: true }]
    : [{ key: 'kill', label: 'Kill session', danger: true }];
}

/** Maps a selected menu item's key to what the row should do next: move into a confirming
 *  state, fire the real action, or (for the confirm items) both reset and fire. */
export function sessionRowMenuAction(key: string): {
  confirming: ConfirmingAction;
  act: 'kill' | 'resume' | null;
} {
  switch (key) {
    case 'kill':
      return { confirming: 'kill', act: null };
    case 'kill-confirm':
      return { confirming: null, act: 'kill' };
    case 'resume':
      return { confirming: 'resume', act: null };
    case 'resume-confirm':
      return { confirming: null, act: 'resume' };
    default:
      return { confirming: null, act: null };
  }
}
