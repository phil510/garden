import type { IDockviewPanelProps } from 'dockview-react';
import { updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { useUiStore } from '../../state/uiStore';

/** The panel id is the session id, so the pane needs nothing from its dockview params. */
export function StagePane(props: IDockviewPanelProps) {
  const uiState = useUiStore((state) => state.uiState);
  const slot = uiState.slots.indexOf(props.api.id);
  const focused = slot !== -1 && slot === uiState.focusedSlot;

  function focus() {
    if (slot === -1 || focused) return;
    updateUiState({ focusedSlot: slot }).catch(reportCommandFailure);
  }

  // Maximising hides the siblings rather than unmounting them, so their xterm instances and
  // sockets carry on running behind the maximised pane.
  function toggleMaximise() {
    if (props.api.isMaximized()) props.api.exitMaximized();
    else props.api.maximize();
  }

  return (
    <div
      className={focused ? 'pane focused' : 'pane'}
      onClick={focus}
      onDoubleClick={toggleMaximise}
    />
  );
}

export function EmptySlotPane() {
  return <div className="pane empty">Empty slot — click a session to fill it</div>;
}
