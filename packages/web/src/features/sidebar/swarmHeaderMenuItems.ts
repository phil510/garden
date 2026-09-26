export type SwarmMenuConfirming = 'delete' | null;

export interface SwarmHeaderMenuEntry {
  key: string;
  label: string;
  danger: boolean;
}

/** The swarm header's context menu: Rename, Archive/Unarchive (labeled by `archived`), and
 *  Delete swarm… behind a two-step confirm — mirrors sessionRowMenuItems.ts's
 *  ConfirmingAction pattern exactly. */
export function swarmHeaderMenuItems(
  archived: boolean,
  confirming: SwarmMenuConfirming,
): SwarmHeaderMenuEntry[] {
  return [
    { key: 'rename', label: 'Rename', danger: false },
    { key: 'toggle-archive', label: archived ? 'Unarchive' : 'Archive', danger: false },
    confirming === 'delete'
      ? {
          key: 'delete-confirm',
          label: 'Confirm delete — members become solo, nothing is killed',
          danger: true,
        }
      : { key: 'delete', label: 'Delete swarm…', danger: true },
  ];
}

/** Maps a selected menu item's key to what the header should do next: move Delete into its
 *  confirm state without acting, or fire the real action and reset confirming either way. */
export function swarmHeaderMenuAction(key: string): {
  confirming: SwarmMenuConfirming;
  act: 'rename' | 'toggle-archive' | 'delete' | null;
} {
  switch (key) {
    case 'delete':
      return { confirming: 'delete', act: null };
    case 'delete-confirm':
      return { confirming: null, act: 'delete' };
    case 'rename':
      return { confirming: null, act: 'rename' };
    case 'toggle-archive':
      return { confirming: null, act: 'toggle-archive' };
    default:
      return { confirming: null, act: null };
  }
}
