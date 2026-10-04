import type { ActiveSwarmOption } from './groupSwarms';

export type ConfirmingAction = 'kill' | 'resume' | 'stop-all' | null;

const ADD_TO_SWARM_FILTER_THRESHOLD = 8;

interface PlainMenuItem {
  key: string;
  label: string;
  danger: boolean;
}

/** The part of a watch the menu needs to label and key its stop item. */
export interface MenuWatch {
  repo: string;
  pr: number;
}

export const STOP_WATCH_KEY_PREFIX = 'stop-watch:';

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

/** The "Stop watching ▸" submenu: one item per watch, "Stop all" as the footer, which becomes
 *  a danger confirm item while the row is mid-confirm. */
function stopWatchingEntry(
  watches: readonly MenuWatch[],
  confirming: ConfirmingAction,
): SessionRowMenuEntry {
  return {
    key: 'stop-watching',
    label: 'Stop watching',
    danger: false,
    submenu: {
      items: watches.map((watch) => ({
        key: `${STOP_WATCH_KEY_PREFIX}${watch.repo}#${String(watch.pr)}`,
        label: `#${String(watch.pr)} ${watch.repo}`,
        danger: false,
      })),
      filterable: false,
      footer:
        confirming === 'stop-all'
          ? {
              key: 'stop-all-confirm',
              label: `Confirm stop all ${String(watches.length)}`,
              danger: true,
            }
          : { key: 'stop-all', label: 'Stop all', danger: false },
    },
  };
}

/** A session row's full context menu: a "Watch a PR…" item, a "Stop watching ▸" submenu only
 *  when the session has watches, an "Add to swarm ▸" submenu (entries in whatever order
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
  watches: readonly MenuWatch[] = [],
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

  const watchEntries: SessionRowMenuEntry[] = [
    { key: 'watch-pr', label: 'Watch a PR…', danger: false },
    ...(watches.length > 0 ? [stopWatchingEntry(watches, confirming)] : []),
  ];

  return [...watchEntries, addToSwarm, ...removeFromSwarm, killOrResumeItem(dead, confirming)];
}

/** Maps a selected Kill/Resume menu item's key to what the row should do next: move into a
 *  confirming state, fire the real action, or (for the confirm items) both reset and fire.
 *  The Add-to-swarm/Remove-from-swarm items above act immediately on selection instead —
 *  SessionRow.tsx wires those directly by key rather than through this confirm-state
 *  machine. */
export function sessionRowMenuAction(key: string): {
  confirming: ConfirmingAction;
  act: 'kill' | 'resume' | 'stop-all' | null;
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
    case 'stop-all':
      return { confirming: 'stop-all', act: null };
    case 'stop-all-confirm':
      return { confirming: null, act: 'stop-all' };
    default:
      return { confirming: null, act: null };
  }
}
