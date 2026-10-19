import { useEffect } from 'react';
import { useToastStore, type ToastKind } from '../state/toastStore';
import './toast.css';

const AUTO_DISMISS_MS = 6000;

interface ToastViewProps {
  message: string | null;
  kind: ToastKind;
  onDismiss: () => void;
}

/** The toast's markup, apart from the store reads, so it can be rendered from props. The
 *  polite live region is always in the DOM and the toast is inserted into it — a region
 *  that appears together with its content is not reliably announced. */
export function ToastView({ message, kind, onDismiss }: ToastViewProps) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {message !== null && (
        <div className={`toast toast-${kind}`}>
          <div className="toast-message">{message}</div>
          <button className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/** A single, bottom-of-screen toast for an outcome the console can't otherwise surface: a
 *  failed command (e.g. a failed create, which produces nothing for the next broadcast to
 *  re-render) or a save that leaves nothing else on screen to show it landed. Auto-dismisses
 *  so a stale message doesn't linger over an otherwise-recovered console. */
export function Toast() {
  const message = useToastStore((state) => state.message);
  const kind = useToastStore((state) => state.kind);
  const token = useToastStore((state) => state.token);
  const clearToast = useToastStore((state) => state.clearToast);

  useEffect(() => {
    if (message === null) return;
    const timeout = setTimeout(clearToast, AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
    // `token` is in the deps so a repeat of the same message (unchanged `message` string)
    // still restarts the timer, rather than inheriting the first call's deadline.
  }, [message, token, clearToast]);

  return <ToastView message={message} kind={kind} onDismiss={clearToast} />;
}
