import type { SerializedDockview } from 'dockview-core';
import type { DockviewApi, DockviewPanelApi } from 'dockview-react';

/**
 * Applies `layout` to the stage. `reuseExistingPanels` matches on panel id and a panel id is a
 * session id, so a pane the new layout still holds keeps the xterm instance and pane socket the
 * registry gave it instead of being rebuilt.
 */
export function applyLayout(api: DockviewApi, layout: SerializedDockview): void {
  // fromJSON on a maximized stage would rebuild the grid underneath the hidden siblings.
  if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
  api.fromJSON(layout, { reuseExistingPanels: true });
}

/**
 * Collapses a maximized pane so a newly focused one is visible. The focused group itself is left
 * maximized: focusing the pane the user already expanded isn't a request to leave it.
 */
export function exitMaximizedUnlessFocused(api: DockviewApi, focusedGroupId: string): void {
  if (!api.hasMaximizedGroup()) return;
  if (api.getGroup(focusedGroupId)?.api.isMaximized()) return;
  api.exitMaximizedGroup();
}

/**
 * Toggles a pane's maximised state. Maximising also focuses the pane: the focus-change effect in
 * `Stage` is what un-hides a maximized stage when another session is picked, so a maximized pane
 * that wasn't focused would leave re-picking the focused session a no-op behind it.
 */
export function togglePaneMaximised(
  panel: Pick<DockviewPanelApi, 'isMaximized' | 'maximize' | 'exitMaximized'>,
  focus: () => void,
): void {
  if (panel.isMaximized()) {
    panel.exitMaximized();
    return;
  }
  focus();
  panel.maximize();
}
