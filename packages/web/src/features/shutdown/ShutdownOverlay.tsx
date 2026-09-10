import './shutdown.css';

const STOPPED_ICON = (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </svg>
);

/** Rendered once `WS /events` closes with the deliberate-shutdown code — the server has
 *  stopped on purpose, so there is nothing left to reconnect to. */
export function ShutdownOverlay() {
  return (
    <div className="shutdown-overlay">
      <div className="shutdown-body">
        <div className="shutdown-icon">{STOPPED_ICON}</div>
        <div className="shutdown-line1">garden has stopped</div>
        <div className="shutdown-line2">Safe to close this window.</div>
      </div>
    </div>
  );
}
