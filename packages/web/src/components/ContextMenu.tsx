import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { computeContextMenuPosition } from './contextMenuPosition';
import './context-menu.css';

export interface ContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
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
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

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
  function stopBubbling(event: ReactMouseEvent) {
    event.stopPropagation();
  }

  function onContainerContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
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
      onContextMenu={onContainerContextMenu}
    >
      {items.map((item) => (
        <div
          key={item.key}
          className={`context-menu-item${item.danger === true ? ' danger' : ''}`}
          onClick={() => item.onSelect()}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
