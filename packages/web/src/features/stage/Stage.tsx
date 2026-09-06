import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from 'dockview-react';
import { useEffect, useRef, useState } from 'react';
import { updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { useUiStore } from '../../state/uiStore';
import { detachPane } from '../../terminals/registry';
import { applyLayout } from './applyLayout';
import { EMPTY_SLOT_COMPONENT, PANE_COMPONENT, isEmptySlotId, presetLayout } from './presetLayout';
import { EmptySlotPane, StagePane } from './StagePane';
import { stageLayout } from './storedLayout';
import 'dockview-react/dist/styles/dockview.css';
import './stage.css';

const components = { [PANE_COMPONENT]: StagePane, [EMPTY_SLOT_COMPONENT]: EmptySlotPane };

/** Long enough that dragging a sash writes once rather than per animation frame, short enough
 *  that a reload straight after a drag still finds the new sizes. */
const PERSIST_DEBOUNCE_MS = 400;

export function Stage() {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const preset = useUiStore((state) => state.uiState.preset);
  const slots = useUiStore((state) => state.uiState.slots);
  const storedLayout = useUiStore((state) => state.uiState.layout);
  const hydrated = useUiStore((state) => state.hydrated);

  // The layout the server's state asks for. Read through a ref inside the effects so a change
  // to the stored blob — which every persist round-trips back — never itself re-applies a layout.
  const applyRef = useRef<() => void>(() => undefined);
  applyRef.current = () => {
    if (api === null) return;
    applyLayout(api, stageLayout(presetLayout(preset, slots), storedLayout));
  };

  // Every `ui-state` message brings a fresh object, so identity says nothing about whether the
  // stage changed. Re-applying an unchanged arrangement would reset the preset's track sizes and
  // throw away a splitter the user had dragged, so the value is what gates the call.
  const arrangement = JSON.stringify([preset, slots]);

  useEffect(() => {
    applyRef.current();
  }, [api, arrangement]);

  useEffect(() => {
    if (api === null) return;
    // The only teardown trigger: a panel reused across a `fromJSON` fires nothing here, so a
    // pane keeps its socket, and a panel the new arrangement genuinely dropped fires once.
    const disposable = api.onDidRemovePanel((panel) => {
      if (!isEmptySlotId(panel.id)) detachPane(panel.id);
    });
    return () => disposable.dispose();
  }, [api]);

  useEffect(() => {
    if (api === null || !hydrated) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disposable = api.onDidLayoutChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        updateUiState({ layout: api.toJSON() }).catch(reportCommandFailure);
      }, PERSIST_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      disposable.dispose();
    };
  }, [api, hydrated]);

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
