import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ApiError, addWatch } from '../../api/client';
import { computeContextMenuPosition } from '../../components/contextMenuPosition';
import '../../components/context-menu.css';
import { FORM_KINDS, initialWatchForm, toAddWatchRequest, type FormKind } from './watchForm';
import './watches.css';

interface WatchPopoverProps {
  x: number;
  y: number;
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
}

/** The "Watch a PR…" form, shown at the row context menu's position. Server rejections (an
 *  unresolvable repo, say) are shown inline so the user can correct the form. */
export function WatchPopover({ x, y, sessionId, sessionTitle, onClose }: WatchPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prInputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [form, setForm] = useState(initialWatchForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    prInputRef.current?.focus();
  }, []);

  const submittingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (submittingRef.current) return;
      if (event.key === 'Escape') onCloseRef.current();
    }
    function onMouseDown(event: MouseEvent) {
      if (submittingRef.current) return;
      if (!containerRef.current?.contains(event.target as Node)) onCloseRef.current();
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

  function onContainerContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = toAddWatchRequest(form);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setSubmitting(true);
    submittingRef.current = true;
    try {
      await addWatch(sessionId, result.body);
      onCloseRef.current();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start the watch.');
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  function toggleKind(kind: FormKind) {
    setForm((current) => ({
      ...current,
      kinds: { ...current.kinds, [kind]: !current.kinds[kind] },
    }));
  }

  return (
    <div
      ref={containerRef}
      className="context-menu watch-form"
      style={
        position === null ? { visibility: 'hidden' } : { left: position.left, top: position.top }
      }
      onClick={stopBubbling}
      onMouseDown={stopBubbling}
      onPointerDown={stopBubbling}
      onContextMenu={onContainerContextMenu}
    >
      <div className="pop-head">
        <span className="upper muted">Watch a PR · {sessionTitle}</span>
      </div>
      <form className="wf" onSubmit={(event) => void submit(event)}>
        <div className="wf-row">
          <label className="wf-field pr">
            <span className="wf-label">PR</span>
            <span className="wf-pr-wrap">
              <span>#</span>
              <input
                ref={prInputRef}
                type="text"
                inputMode="numeric"
                value={form.pr}
                onChange={(event) => setForm({ ...form, pr: event.target.value })}
              />
            </span>
          </label>
          <label className="wf-field repo">
            <span className="wf-label">Repo</span>
            <input
              type="text"
              placeholder="this session's remote"
              value={form.repo}
              onChange={(event) => setForm({ ...form, repo: event.target.value })}
            />
          </label>
        </div>
        <div className="wf-kinds">
          {FORM_KINDS.map((kind) => (
            <label className="wf-kind" key={kind}>
              <input type="checkbox" checked={form.kinds[kind]} onChange={() => toggleKind(kind)} />
              {kind}
              {kind === 'checks' && (
                <select
                  value={form.checksAll ? 'all' : 'failures'}
                  disabled={!form.kinds.checks}
                  aria-label="Which check results to report"
                  onChange={(event) =>
                    setForm({ ...form, checksAll: event.target.value === 'all' })
                  }
                >
                  <option value="failures">failures</option>
                  <option value="all">all</option>
                </select>
              )}
            </label>
          ))}
          <label className="wf-kind locked">
            <input type="checkbox" checked disabled />
            closed
          </label>
        </div>
        {error !== null && <div className="wf-msg">{error}</div>}
        <div className="wf-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={submitting}>
            Watch
          </button>
        </div>
      </form>
    </div>
  );
}
