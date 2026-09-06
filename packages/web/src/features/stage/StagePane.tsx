import type { IDockviewPanelProps } from 'dockview-react';
import { useUiStore } from '../../state/uiStore';

/** The panel id is the session id, so the pane needs nothing from its dockview params. */
export function StagePane(props: IDockviewPanelProps) {
  const uiState = useUiStore((state) => state.uiState);
  const focused = uiState.slots[uiState.focusedSlot] === props.api.id;
  return <div className={focused ? 'pane focused' : 'pane'} />;
}

export function EmptySlotPane() {
  return <div className="pane empty">Empty slot — click a session to fill it</div>;
}
