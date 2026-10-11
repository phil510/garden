import type { SessionState } from '@garden/shared';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import {
  createSwarm,
  killSession,
  removeWatch,
  resumeSession,
  setSessionPlacement,
} from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { StatusPill } from '../../components/StatusPill';
import { usePipeGraceStore } from '../../state/pipeGraceStore';
import { WatchPopover } from '../watches/WatchPopover';
import { EyeIcon } from '../watches/WatchIcons';
import { faultSummary, rowWatchState } from '../watches/watchStatus';
import type { ActiveSwarmOption } from './groupSwarms';
import { HoverCard } from './HoverCard';
import { lastPathSegment } from './lastPathSegment';
import { NewSwarmPopover } from './NewSwarmPopover';
import { pressStartedInMenu } from './pressOrigin';
import {
  sessionRowMenuAction,
  sessionRowMenuItems,
  STOP_WATCH_KEY_PREFIX,
  type ConfirmingAction,
} from './sessionRowMenuItems';
import { metaLineSegmentClassName, metaLineSegments } from './sessionIdentity';

const ADD_SWARM_KEY_PREFIX = 'add-swarm:';

interface SessionRowProps {
  session: SessionState;
  onStage: boolean;
  focused: boolean;
  now: number;
  onSelect: (id: string) => void;
  /** This session's current swarm, resolved by the caller via `resolveTopLevelSwarmId` —
   *  undefined when it's solo. Drives whether the row menu offers "Remove from swarm". */
  currentSwarmId?: string | undefined;
  /** Active swarms, recency-sorted, for the row menu's "Add to swarm" submenu. */
  activeSwarms: readonly ActiveSwarmOption[];
  /** Swarms-mode tree rows only: whether this row has a rendered `<ul class="tree-children">`
   *  following it, which drives the parent-side rail corner in CSS
   *  (`.session-row.has-children::after`). Always false in Repos mode. */
  hasChildren?: boolean;
  /** Swarms-mode tree rows only: `useDraggable`'s wiring for membership drag, supplied by
   *  SwarmTree.tsx. Omitted in Repos mode — RepoGroup renders this row with no drag props at
   *  all, so a session is never draggable there. */
  dragRef?: (node: HTMLElement | null) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragStyle?: CSSProperties;
  isDragging?: boolean;
}

export function SessionRow({
  session,
  onStage,
  focused,
  now,
  onSelect,
  currentSwarmId,
  activeSwarms,
  hasChildren = false,
  dragRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging = false,
}: SessionRowProps) {
  // A callback ref feeding state, not a plain ref, so the hover card's anchor is safe to
  // read during render — a raw ref's `.current` is not.
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [contextMenuPoint, setContextMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState<ConfirmingAction>(null);
  const [newSwarmPromptOpen, setNewSwarmPromptOpen] = useState(false);
  const [watchPromptOpen, setWatchPromptOpen] = useState(false);
  const dead = session.liveness === 'dead';
  const crashed = dead && session.exitCode !== null && session.exitCode !== 0;
  const title = session.title ?? lastPathSegment(session.cwd);
  const pipeFaulted = usePipeGraceStore((state) => state.faulted.has(session.id));
  const watchState = rowWatchState(session, pipeFaulted);

  // Memoized so identity is stable across renders that don't change dragRef (Repos mode never
  // supplies one) — otherwise a new function every render makes React re-invoke both the old
  // and new ref callback on every commit, an avoidable extra setRowEl/re-render pair.
  const setCombinedRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      setRowEl(node);
      dragRef?.(node);
    },
    [dragRef],
  );

  // A press on a menu item that releases on the row body reaches the row as a click without
  // passing through ContextMenu's own guard, since the browser routes a mismatched
  // mousedown/mouseup pair to their common ancestor. Tracked here on the capture phase, ahead
  // of that guard; reset whenever the menu's lifecycle changes.
  const pressStartedInMenuRef = useRef(false);
  useEffect(() => {
    pressStartedInMenuRef.current = false;
  }, [contextMenuPoint]);

  function handleRowMouseDown(event: MouseEvent) {
    pressStartedInMenuRef.current = pressStartedInMenu(
      event.target instanceof Element ? event.target : null,
    );
  }

  function handleRowClick() {
    const pressStartedInMenu = pressStartedInMenuRef.current;
    pressStartedInMenuRef.current = false;
    if (pressStartedInMenu) return;
    onSelect(session.id);
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setConfirming(null);
    setNewSwarmPromptOpen(false);
    setWatchPromptOpen(false);
    setContextMenuPoint({ x: event.clientX, y: event.clientY });
  }

  function closeContextMenu() {
    setContextMenuPoint(null);
    setConfirming(null);
    setNewSwarmPromptOpen(false);
    setWatchPromptOpen(false);
  }

  async function createSwarmAndAssign(name: string) {
    try {
      const { id } = await createSwarm(name);
      await setSessionPlacement(session.id, { type: 'swarm', swarmId: id });
    } catch (error) {
      reportCommandFailure(error);
    }
  }

  function handleMenuSelect(key: string) {
    if (key === 'remove-swarm') {
      setSessionPlacement(session.id, { type: 'none' }).catch(reportCommandFailure);
      closeContextMenu();
      return;
    }
    if (key.startsWith(ADD_SWARM_KEY_PREFIX)) {
      const swarmId = key.slice(ADD_SWARM_KEY_PREFIX.length);
      setSessionPlacement(session.id, { type: 'swarm', swarmId }).catch(reportCommandFailure);
      closeContextMenu();
      return;
    }
    if (key === 'new-swarm') {
      setNewSwarmPromptOpen(true);
      return;
    }
    if (key === 'watch-pr') {
      setWatchPromptOpen(true);
      return;
    }
    if (key.startsWith(STOP_WATCH_KEY_PREFIX)) {
      // Repo names can't contain '#', so the last one separates repo from PR number.
      const target = key.slice(STOP_WATCH_KEY_PREFIX.length);
      const split = target.lastIndexOf('#');
      removeWatch(session.id, Number(target.slice(split + 1)), target.slice(0, split)).catch(
        reportCommandFailure,
      );
      closeContextMenu();
      return;
    }
    const result = sessionRowMenuAction(key);
    setConfirming(result.confirming);
    if (result.act === 'kill') killSession(session.id).catch(reportCommandFailure);
    if (result.act === 'resume') resumeSession(session.id).catch(reportCommandFailure);
    if (result.act === 'stop-all') {
      void Promise.allSettled(
        session.watches.map((watch) => removeWatch(session.id, watch.pr, watch.repo)),
      ).then((outcomes) => {
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected') reportCommandFailure(outcome.reason);
        }
      });
    }
    if (result.act !== null) setContextMenuPoint(null);
  }

  const menuItems: ContextMenuItem[] = sessionRowMenuItems(
    dead,
    confirming,
    currentSwarmId,
    activeSwarms,
    session.watches,
  ).map((item): ContextMenuItem => {
    const submenu = item.submenu;
    return {
      key: item.key,
      label: item.label,
      danger: item.danger,
      onSelect: () => handleMenuSelect(item.key),
      ...(submenu === undefined
        ? {}
        : {
            submenu: {
              filterable: submenu.filterable,
              items: submenu.items.map((subitem) => ({
                ...subitem,
                onSelect: () => handleMenuSelect(subitem.key),
              })),
              footer: { ...submenu.footer, onSelect: () => handleMenuSelect(submenu.footer.key) },
            },
          }),
    };
  });

  return (
    <div
      ref={setCombinedRowRef}
      className={`session-row${onStage ? ' on-stage' : ''}${dead ? ' dead' : ''}${hasChildren ? ' has-children' : ''}${isDragging ? ' dragging' : ''}`}
      style={dragStyle}
      tabIndex={0}
      onClick={handleRowClick}
      onMouseDownCapture={handleRowMouseDown}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...dragAttributes}
      {...dragListeners}
    >
      {focused && <span className="focused-mark" title="Focused" />}
      <div className="row-title-line">
        {crashed && (
          <span className="crashed-mark" title={`Exited with code ${session.exitCode}`}>
            !
          </span>
        )}
        <div className="row-title">{title}</div>
        {watchState !== null && (
          <span
            className={`wg wg-${watchState.tone === 'fault' ? 'error' : 'watching'}`}
            title={
              watchState.tone === 'fault'
                ? `Fault: ${faultSummary(session, pipeFaulted)}`
                : `${String(watchState.count)} ${watchState.count === 1 ? 'watch' : 'watches'}`
            }
          >
            <EyeIcon />
            {watchState.count > 1 && watchState.count}
          </span>
        )}
        {session.liveness === 'live' && session.status !== null && (
          <StatusPill status={session.status} />
        )}
      </div>
      <div className="row-meta">
        {metaLineSegments(session, now).map((segment) => (
          <span key={segment.key} className={metaLineSegmentClassName(segment)}>
            {segment.text}
          </span>
        ))}
      </div>
      {hovered && rowEl !== null && contextMenuPoint === null && (
        <HoverCard title={title} session={session} anchor={rowEl} now={now} />
      )}
      {contextMenuPoint !== null && !newSwarmPromptOpen && !watchPromptOpen && (
        <ContextMenu
          x={contextMenuPoint.x}
          y={contextMenuPoint.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      )}
      {contextMenuPoint !== null && newSwarmPromptOpen && (
        <NewSwarmPopover
          x={contextMenuPoint.x}
          y={contextMenuPoint.y}
          initialName={title}
          onCancel={closeContextMenu}
          onCreate={(name) => {
            void createSwarmAndAssign(name);
            closeContextMenu();
          }}
        />
      )}
      {contextMenuPoint !== null && watchPromptOpen && (
        <WatchPopover
          x={contextMenuPoint.x}
          y={contextMenuPoint.y}
          sessionId={session.id}
          sessionTitle={title}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
