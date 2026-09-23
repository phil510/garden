import { useEffect } from 'react';
import { useToastStore } from '../state/toastStore';
import './toast.css';

const AUTO_DISMISS_MS = 6000;

/** A single, bottom-of-screen toast for a command failure the console can't otherwise
 *  surface (e.g. a failed create, which produces nothing for the next broadcast to
 *  re-render). Auto-dismisses so a stale message doesn't linger over an otherwise-recovered
 *  console. */
export function Toast() {
  const message = useToastStore((state) => state.message);
  const clearToast = useToastStore((state) => state.clearToast);

  useEffect(() => {
    if (message === null) return;
    const timeout = setTimeout(clearToast, AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [message, clearToast]);

  if (message === null) return null;

  return (
    <div className="toast" role="alert">
      <div className="toast-message">{message}</div>
      <button className="toast-close" aria-label="Dismiss" onClick={clearToast}>
        ✕
      </button>
    </div>
  );
}
