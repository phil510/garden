import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from 'dockview-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { detachPane } from '../../terminals/registry';
import { applyLayout } from './applyLayout';
import { groupIdsFromAppliedGrid2x2, resolveRowMirror, type RowWidths } from './mirrorRows';
import { EMPTY_SLOT_COMPONENT, PANE_COMPONENT, isEmptySlotId, presetLayout } from './presetLayout';
import { EmptySlotPane, StagePane } from './StagePane';
import { stageLayout } from './storedLayout';
import { swapSlots } from './swapSlots';
import 'dockview-react/dist/styles/dockview.css';
import './stage.css';

const components = { [PANE_COMPONENT]: StagePane, [EMPTY_SLOT_COMPONENT]: EmptySlotPane };

function rowWidths(api: DockviewApi, ids: readonly [string, string]): RowWidths {
  return [api.getGroup(ids[0])?.api.width ?? 0, api.getGroup(ids[1])?.api.width ?? 0];
}

/** Long enough that dragging a sash writes once rather than per animation frame, short enough
 *  that a reload straight after a drag still finds the new sizes. */
const PERSIST_DEBOUNCE_MS = 400;

export function Stage() {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const preset = useUiStore((state) => state.uiState.preset);
  const slots = useUiStore((state) => state.uiState.slots);
  const focusedSlot = useUiStore((state) => state.uiState.focusedSlot);
  const storedLayout = useUiStore((state) => state.uiState.layout);
  const hydrated = useUiStore((state) => state.hydrated);
  const draggedSession = useSessionStore((state) =>
    draggedId === null ? undefined : state.sessions[draggedId],
  );

  // The layout the server's state asks for. Read through a ref inside the effects so a change
  // to the stored blob — which every persist round-trips back — never itself re-applies a layout.
  const applyRef = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    applyRef.current = () => {
      if (api === null) return;
      applyLayout(api, stageLayout(presetLayout(preset, slots), storedLayout));
    };
  });

  // Every `ui-state` message brings a fresh object, so identity says nothing about whether the
  // stage changed. Re-applying an unchanged arrangement would reset the preset's track sizes and
  // throw away a splitter the user had dragged, so the value is what gates the call.
  const arrangement = JSON.stringify([preset, slots]);

  useEffect(() => {
    applyRef.current();
  }, [api, arrangement]);

  // Keeps the 2x2 preset's two rows' column splits in sync: whichever row's own widths just
  // changed gets copied onto the other. Declared after the apply effect above so it runs after
  // `applyLayout`, seeding its "previous widths" from what that effect just applied — a legacy
  // lopsided persisted layout stays exactly as loaded until a real column-width change. Row group
  // ids come from the live applied grid, not `slots` (see `groupIdsFromAppliedGrid2x2`). Re-seeds
  // whenever the arrangement changes since the effect is fully torn down and recreated then
  // anyway.
  //
  // `onDidLayoutChange` fires for the row-height divider, a window resize, or anything else that
  // touches the layout, not just a column-width drag — diffing each row against its own
  // last-observed widths, rather than whether the two rows currently match, is what keeps this
  // inert for those. `setSize` re-fires the event asynchronously, but needs no re-entrancy guard:
  // after mirroring, both rows have been observed at their new widths, so the re-fire sees
  // neither row as changed and `resolveRowMirror` returns `null`.
  useEffect(() => {
    if (api === null || preset !== 'grid-2x2') return;
    const ids = groupIdsFromAppliedGrid2x2(api.toJSON().grid.root);
    if (ids === null) return;
    const [topLeft, topRight, bottomLeft, bottomRight] = ids;
    let previousTop = rowWidths(api, [topLeft, topRight]);
    let previousBottom = rowWidths(api, [bottomLeft, bottomRight]);
    const disposable = api.onDidLayoutChange(() => {
      const top = rowWidths(api, [topLeft, topRight]);
      const bottom = rowWidths(api, [bottomLeft, bottomRight]);
      const mirror = resolveRowMirror(top, bottom, previousTop, previousBottom);
      if (mirror !== null) {
        const [leftId, rightId] =
          mirror.target === 'top' ? [topLeft, topRight] : [bottomLeft, bottomRight];
        api.getGroup(leftId)?.api.setSize({ width: mirror.widths[0] });
        api.getGroup(rightId)?.api.setSize({ width: mirror.widths[1] });
      }
      previousTop = mirror?.target === 'top' ? mirror.widths : top;
      previousBottom = mirror?.target === 'bottom' ? mirror.widths : bottom;
    });
    return () => disposable.dispose();
  }, [api, preset, arrangement]);

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function onDragStart(event: DragStartEvent) {
    setDraggedId(event.active.id as string);
  }

  function onDragEnd(event: DragEndEvent) {
    setDraggedId(null);
    if (event.over === null) return;
    const targetSlot = Number(event.over.id);
    updateUiState(swapSlots(slots, focusedSlot, event.active.id as string, targetSlot)).catch(
      reportCommandFailure,
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDraggedId(null)}
    >
      <DockviewReact
        className="stage dockview-theme-dark"
        components={components}
        onReady={onReady}
      />
      {/* dockview's `always`-renderer overlay clips each pane to its own group's box (`contain:
          layout paint`), so a plain CSS-transform drag becomes invisible once it crosses a cell
          boundary. This overlay is the one exception to "no DragOverlay" in the plan's own
          notes: a lightweight title-only preview, not the live pane, portaled outside that
          containment so it stays visible for the whole drag. */}
      <DragOverlay>
        {draggedSession && (
          <div className="pane-drag-preview">{draggedSession.title ?? draggedSession.cwd}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
