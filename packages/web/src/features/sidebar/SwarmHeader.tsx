import { useDroppable, type DraggableAttributes } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { archiveSwarm, deleteSwarm, renameSwarm, unarchiveSwarm } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import type { SwarmGroup } from './groupSwarms';
import { resolveSwarmRename } from './resolveSwarmRename';
import {
  swarmHeaderMenuAction,
  swarmHeaderMenuItems,
  type SwarmMenuConfirming,
} from './swarmHeaderMenuItems';

interface SwarmHeaderProps {
  swarm: Pick<SwarmGroup, 'swarmId' | 'name' | 'liveCount' | 'collapsed' | 'archived'>;
  onToggle: () => void;
  className?: string;
  /** `useSortable`'s drag attributes/listeners for an active swarm, spread onto the header
   *  div; omitted for a Finished-section entry, which isn't reorderable. */
  dragAttributes?: DraggableAttributes;
  dragListeners?: ReturnType<typeof useSortable>['listeners'];
}

/** The swarm-header row shared by an active swarm and a Finished-section entry: chevron,
 *  name (double-click, or the header's own context menu, to rename in place), live count. Finished entries pass no drag props and fold in their own `finished`
 *  class via `className`. */
export function SwarmHeader({
  swarm,
  onToggle,
  className = '',
  dragAttributes,
  dragListeners,
}: SwarmHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(swarm.name);
  const inputRef = useRef<HTMLInputElement>(null);
  // Whether Enter/Escape has already resolved the open rename session (commit or cancel).
  // Removing a focused input from the DOM can still fire a trailing native blur afterward —
  // this guards that stray onBlur from re-committing (or, after Escape, committing at all).
  const renameSessionActiveRef = useRef(false);
  const [contextMenuPoint, setContextMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState<SwarmMenuConfirming>(null);
  // A separate droppable from the group's own header-reorder sortable (which shares the group
  // div and the plain swarmId as its id) — this is specifically "drop a session onto this
  // header", targeted at the header alone, not the whole swarm-group. Disabled (never a valid
  // drop target) for a Finished-section entry, which passes no drag props either.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `swarm-header:${swarm.swarmId}`,
    disabled: dragAttributes === undefined,
    data: { type: 'swarm-header', swarmId: swarm.swarmId },
  });

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  function startRenaming() {
    setDraft(swarm.name);
    setRenaming(true);
    renameSessionActiveRef.current = true;
  }

  function commitRename() {
    if (!renameSessionActiveRef.current) return;
    renameSessionActiveRef.current = false;
    setRenaming(false);
    const name = resolveSwarmRename(swarm.name, draft);
    if (name === null) return;
    renameSwarm(swarm.swarmId, name).catch(reportCommandFailure);
  }

  function cancelRename() {
    renameSessionActiveRef.current = false;
    setRenaming(false);
  }

  function onHeaderClick(event: ReactMouseEvent<HTMLDivElement>) {
    // Mirrors the mock's own guard: a click landing on the name (or its rename input) never
    // toggles collapse, whether it's the first or second click of a double-click.
    if (event.target instanceof Element && event.target.closest('[data-rename]') !== null) return;
    onToggle();
  }

  function onHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggle();
  }

  function onHeaderContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setConfirming(null);
    setContextMenuPoint({ x: event.clientX, y: event.clientY });
  }

  function closeContextMenu() {
    setContextMenuPoint(null);
    setConfirming(null);
  }

  // Stopped from bubbling to the header div: otherwise a Space in the name is swallowed by
  // the header's Space-toggles-collapse handler, and dragging to select text starts a header
  // reorder once the pointer sensor's 8px threshold is crossed.
  function stopBubbling(event: ReactMouseEvent) {
    event.stopPropagation();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Enter') commitRename();
    else if (event.key === 'Escape') cancelRename();
  }

  function handleMenuSelect(key: string) {
    const result = swarmHeaderMenuAction(key);
    setConfirming(result.confirming);
    if (result.act === 'rename') startRenaming();
    if (result.act === 'toggle-archive') {
      (swarm.archived ? unarchiveSwarm(swarm.swarmId) : archiveSwarm(swarm.swarmId)).catch(
        reportCommandFailure,
      );
    }
    if (result.act === 'delete') deleteSwarm(swarm.swarmId).catch(reportCommandFailure);
    if (result.act !== null) closeContextMenu();
  }

  const menuItems: ContextMenuItem[] = swarmHeaderMenuItems(swarm.archived, confirming).map(
    (item) => ({ ...item, onSelect: () => handleMenuSelect(item.key) }),
  );

  return (
    <div
      ref={setDropRef}
      className={`swarm-header${swarm.collapsed ? ' collapsed' : ''}${isOver ? ' drop-target' : ''}${className ? ` ${className}` : ''}`}
      data-swarm-id={swarm.swarmId}
      onClick={onHeaderClick}
      onKeyDown={onHeaderKeyDown}
      onContextMenu={onHeaderContextMenu}
      {...dragAttributes}
      {...dragListeners}
    >
      <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
        <path d="M6 9l6 6 6-6" />
      </svg>
      {renaming ? (
        <input
          ref={inputRef}
          className="swarm-name-input"
          data-rename={swarm.swarmId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onInputKeyDown}
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
          onBlur={commitRename}
        />
      ) : (
        <span className="swarm-name" data-rename={swarm.swarmId} onDoubleClick={startRenaming}>
          {swarm.name}
        </span>
      )}
      <span className={`repo-count mono${swarm.liveCount > 0 ? ' live' : ''}`}>
        {swarm.liveCount} live
      </span>
      {contextMenuPoint !== null && (
        <ContextMenu
          x={contextMenuPoint.x}
          y={contextMenuPoint.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
