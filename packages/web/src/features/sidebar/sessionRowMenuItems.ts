import type { ActiveSwarmOption } from './groupSwarms';

export type ConfirmingAction = 'kill' | 'resume' | null;

const ADD_TO_SWARM_FILTER_THRESHOLD = 8;

interface PlainMenuItem {
  key: string;
  label: string;
  danger: boolean;
}

export interface SessionRowMenuEntry extends PlainMenuItem {
  submenu?: {
    items: PlainMenuItem[];
    filterable: boolean;
    footer: PlainMenuItem;
  };
}

/** The single Kill/Resume item to show in a session row's context menu, given its liveness
 *  and whether that row is mid-confirm for its own action. */
function killOrResumeItem(dead: boolean, confirming: ConfirmingAction): PlainMenuItem {
  if (dead) {
    return confirming === 'resume'
      ? { key: 'resume-confirm', label: 'Confirm resume', danger: false }
      : { key: 'resume', label: 'Resume', danger: false };
  }
  return confirming === 'kill'
    ? { key: 'kill-confirm', label: 'Confirm kill', danger: true }
    : { key: 'kill', label: 'Kill session', danger: true };
}

/** A session row's full context menu: an "Add to swarm ▸" submenu (entries in whatever order
 *  the caller already sorted `activeSwarms` — by recency, per groupSwarms.ts's `recency`
 *  field — with a filter above it once there are more than
 *  {@link ADD_TO_SWARM_FILTER_THRESHOLD} entries, and "New swarm…" always last), a
 *  "Remove from swarm" item only when `currentSwarmId` names one, and the existing
 *  Kill/Confirm-kill/Resume/Confirm-resume item. */
export function sessionRowMenuItems(
  dead: boolean,
  confirming: ConfirmingAction,
  currentSwarmId?: string,
  activeSwarms: readonly ActiveSwarmOption[] = [],
): SessionRowMenuEntry[] {
  const addToSwarm: SessionRowMenuEntry = {
    key: 'add-to-swarm',
    label: 'Add to swarm',
    danger: false,
    submenu: {
      items: activeSwarms.map((swarm) => ({
        key: `add-swarm:${swarm.swarmId}`,
        label: swarm.name,
        danger: false,
      })),
      filterable: activeSwarms.length > ADD_TO_SWARM_FILTER_THRESHOLD,
      footer: { key: 'new-swarm', label: 'New swarm…', danger: false },
    },
  };

  const removeFromSwarm: SessionRowMenuEntry[] =
    currentSwarmId !== undefined
      ? [{ key: 'remove-swarm', label: 'Remove from swarm', danger: false }]
      : [];

  return [addToSwarm, ...removeFromSwarm, killOrResumeItem(dead, confirming)];
}

/** Maps a selected Kill/Resume menu item's key to what the row should do next: move into a
 *  confirming state, fire the real action, or (for the confirm items) both reset and fire.
 *  The Add-to-swarm/Remove-from-swarm items above act immediately on selection instead —
 *  SessionRow.tsx wires those directly by key rather than through this confirm-state
 *  machine. */
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
