import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { computeContextMenuPosition, computeSubmenuFlip } from './contextMenuPosition';
import './context-menu.css';

export interface ContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
  /** A submenu opening off this item on hover. `onSelect` above is unused for such an item —
   *  selection happens on one of the submenu's own items. */
  submenu?: ContextMenuSubmenu;
}

export interface ContextMenuSubmenu {
  items: ContextMenuItem[];
  /** Whether to show a text filter above `items`, gated by the item-builder (e.g. "more than
   *  8 entries") rather than by this component. */
  filterable: boolean;
  /** Rendered last, below a divider, and excluded from the filter — e.g. "New swarm…". */
  footer?: ContextMenuItem;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** A generic, session-agnostic popup menu anchored at a point (typically a right-click).
 *  Measures itself hidden, then places itself with contextMenuPosition.ts, following
 *  HoverCard's measure-then-place pattern. Dismisses on Escape or an outside click. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [openSubmenuKey, setOpenSubmenuKey] = useState<string | null>(null);
  const [submenuFlip, setSubmenuFlip] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  // Read via a ref rather than listing onClose as a dependency below: onClose is a fresh
  // closure every render (it's an inline arrow in SessionRow), and re-subscribing the
  // document listeners on every render this menu is open for is unnecessary churn.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const menu = containerRef.current;
    if (menu === null) return;
    setPosition(
      computeContextMenuPosition(
        { x, y },
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [x, y]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const submenu = submenuRef.current;
    if (openSubmenuKey === null || container === null || submenu === null) return;
    const containerRect = container.getBoundingClientRect();
    setSubmenuFlip(
      computeSubmenuFlip(
        { left: containerRect.left, width: containerRect.width },
        submenu.offsetWidth,
        window.innerWidth,
      ),
    );
  }, [openSubmenuKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    function onMouseDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onCloseRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  // The menu is rendered inline in the row's own DOM (no portal, following HoverCard's
  // convention — nothing else in this codebase uses createPortal), so a native event
  // landing anywhere in this subtree would otherwise bubble up into the row's own
  // handlers: a click into onClick (staging the session) and a right-click into
  // onContextMenu (resetting the row's confirm state and repositioning the menu at the
  // new point). Stopped once at the container boundary rather than per item, so it
  // covers the container's own padding too and a later item doesn't need its own guard.
  // onPointerDown is stopped too: once a row/header is also draggable, the drag sensor
  // listens for pointerdown, and without this a click-drag to select text inside the
  // submenu's filter input would instead start a drag.
  function stopBubbling(event: ReactMouseEvent) {
    event.stopPropagation();
  }

  function onContainerContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function openSubmenu(key: string) {
    setOpenSubmenuKey(key);
    setFilterQuery('');
  }

  // A flyout opens on hover and should close on leaving it — except while its filter input
  // has focus, since a leave here can fire mid-drag-select inside that input even though the
  // user is still actively using the submenu.
  function closeSubmenuUnlessFilterFocused(key: string) {
    if (filterInputRef.current !== null && document.activeElement === filterInputRef.current) {
      return;
    }
    setOpenSubmenuKey((current) => (current === key ? null : current));
  }

  return (
    <div
      ref={containerRef}
      className="context-menu"
      style={
        position === null ? { visibility: 'hidden' } : { left: position.left, top: position.top }
      }
      onClick={stopBubbling}
      onMouseDown={stopBubbling}
      onPointerDown={stopBubbling}
      onContextMenu={onContainerContextMenu}
    >
      {items.map((item) => {
        const submenu = item.submenu;
        if (submenu === undefined) {
          return (
            <div
              key={item.key}
              className={`context-menu-item${item.danger === true ? ' danger' : ''}`}
              onClick={() => item.onSelect()}
            >
              {item.label}
            </div>
          );
        }

        const isOpen = openSubmenuKey === item.key;
        const query = filterQuery.trim().toLowerCase();
        const visibleItems = submenu.filterable
          ? submenu.items.filter((subitem) => subitem.label.toLowerCase().includes(query))
          : submenu.items;
        const footer = submenu.footer;

        return (
          <div
            key={item.key}
            className="context-menu-item has-submenu"
            onMouseEnter={() => openSubmenu(item.key)}
            onMouseLeave={() => closeSubmenuUnlessFilterFocused(item.key)}
          >
            <span>{item.label}</span>
            <span className="submenu-caret">&#9656;</span>
            {isOpen && (
              <div
                ref={submenuRef}
                className={`context-submenu${submenuFlip ? ' flip-submenu' : ''}`}
              >
                {submenu.filterable && (
                  <input
                    ref={filterInputRef}
                    className="submenu-filter"
                    placeholder="Filter swarms…"
                    autoComplete="off"
                    value={filterQuery}
                    onClick={stopBubbling}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setFilterQuery(event.target.value)
                    }
                  />
                )}
                {visibleItems.map((subitem) => (
                  <div
                    key={subitem.key}
                    className={`context-menu-item${subitem.danger === true ? ' danger' : ''}`}
                    onClick={() => subitem.onSelect()}
                  >
                    {subitem.label}
                  </div>
                ))}
                {footer !== undefined && (
                  <>
                    {submenu.items.length > 0 && <div className="context-menu-divider" />}
                    <div
                      className={`context-menu-item${footer.danger === true ? ' danger' : ''}`}
                      onClick={() => footer.onSelect()}
                    >
                      {footer.label}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
