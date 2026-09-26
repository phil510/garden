import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { computeContextMenuPosition } from '../../components/contextMenuPosition';
import '../../components/context-menu.css';

interface NewSwarmPopoverProps {
  x: number;
  y: number;
  initialName: string;
  onCancel: () => void;
  onCreate: (name: string) => void;
}

/** The standalone "New swarm…" form swapped in at the same position as the row's context
 *  menu (plan.md's Notes: a small popover, not a submenu-nested form — ContextMenu's
 *  architecture doesn't support arbitrary child content inside an item). Pre-fills and
 *  selects the session's own title, mirroring the mock's `showNewSwarmForm`. */
export function NewSwarmPopover({ x, y, initialName, onCancel, onCreate }: NewSwarmPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [name, setName] = useState(initialName);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    setPosition(
      computeContextMenuPosition(
        { x, y },
        { width: container.offsetWidth, height: container.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [x, y]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onCancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancelRef.current();
    }
    function onMouseDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onCancelRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  function stopBubbling(event: ReactMouseEvent) {
    event.stopPropagation();
  }

  function commit() {
    onCreate(name.trim() || initialName);
  }

  return (
    <div
      ref={containerRef}
      className="context-menu new-swarm-form"
      style={
        position === null ? { visibility: 'hidden' } : { left: position.left, top: position.top }
      }
      onClick={stopBubbling}
      onMouseDown={stopBubbling}
      onPointerDown={stopBubbling}
    >
      <div className="ns-label muted">New swarm</div>
      <input
        ref={inputRef}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      <div className="ns-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={commit}>
          Create
        </button>
      </div>
    </div>
  );
}
