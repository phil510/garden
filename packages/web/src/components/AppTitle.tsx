import './app-title.css';

/** The console's name in the centre of the top bar. Purely decorative: it is positioned
 *  against the full-width `.topbar`, so it stays centred on the window regardless of what
 *  sits on either side. */
export function AppTitle() {
  return (
    <div className="app-title">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22V11" />
        <path d="M12 11C12 7 9 4 4 4c0 4 3 7 8 7Z" />
        <path d="M12 14c0-3 2-5 7-5 0 3-2 5-7 5Z" />
      </svg>
      <span>garden</span>
    </div>
  );
}
