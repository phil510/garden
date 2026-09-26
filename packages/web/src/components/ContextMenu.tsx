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
      if (event.key === 'Escape') onClose();
    }
    function onMouseDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose]);

  // The menu is rendered inline in the row's own DOM (no portal — see plan.md), so an
  // item's click would otherwise bubble into the row's onClick and stage the session as
  // an unwanted side effect of picking a menu item.
  function onItemClick(event: ReactMouseEvent, item: ContextMenuItem) {
    event.stopPropagation();
    item.onSelect();
  }

  return (
    <div
      ref={containerRef}
      className="context-menu"
      style={
        position === null ? { visibility: 'hidden' } : { left: position.left, top: position.top }
      }
    >
      {items.map((item) => (
        <div
          key={item.key}
          className={`context-menu-item${item.danger === true ? ' danger' : ''}`}
          onClick={(event) => onItemClick(event, item)}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
