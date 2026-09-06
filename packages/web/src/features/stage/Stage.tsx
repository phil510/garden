import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from 'dockview-react';
import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../../state/uiStore';
import { EMPTY_SLOT_COMPONENT, PANE_COMPONENT, presetLayout } from './presetLayout';
import { EmptySlotPane, StagePane } from './StagePane';
import 'dockview-react/dist/styles/dockview.css';
import './stage.css';

const components = { [PANE_COMPONENT]: StagePane, [EMPTY_SLOT_COMPONENT]: EmptySlotPane };

export function Stage() {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const preset = useUiStore((state) => state.uiState.preset);
  const slots = useUiStore((state) => state.uiState.slots);

  const layout = presetLayout(preset, slots);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Every `ui-state` message brings a fresh object, so identity says nothing about whether the
  // stage changed. Re-applying an unchanged layout would reset the preset's track sizes and throw
  // away a splitter the user had dragged, so the value is what gates the call.
  const layoutKey = JSON.stringify(layout);

  useEffect(() => {
    // `reuseExistingPanels` matches on panel id, so a pane the new layout still holds keeps the
    // xterm instance and pane socket the registry gave it instead of being rebuilt.
    api?.fromJSON(layoutRef.current, { reuseExistingPanels: true });
  }, [api, layoutKey]);

  function onReady(event: DockviewReadyEvent) {
    setApi(event.api);
  }

  return (
    <DockviewReact
      className="stage dockview-theme-dark"
      components={components}
      onReady={onReady}
    />
  );
}
