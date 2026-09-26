import { create } from 'zustand';

export interface OpenFileRequest {
  sessionId: string;
  path: string;
  /** Null means "no jump target" — a plain tree click, as opposed to a real `path:line` link. */
  line: number | null;
}

const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 560;
const FILE_PANEL_WIDTH_MIN = 220;
const FILE_PANEL_WIDTH_MAX = 640;

/** Floor left for `.stage-wrap` (and whatever dockview panes it holds) once both sidebars have
 *  taken their share of the viewport. Each sidebar's own min/max only bounds that one field, so
 *  without this a drag that's individually valid on both sides can still squeeze the stage down
 *  to a sliver — see `resizeSidebarBy`/`resizeFilePanelBy`. */
const STAGE_MIN_WIDTH = 200;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export type SidebarMode = 'repos' | 'swarms';

interface LocalStore {
  /** Keyed by whatever id the caller scrolls — a pane, a tree, a list. */
  scrollOffsets: Record<string, number>;
  setScrollOffset: (key: string, offset: number) => void;
  /** The sidebar's [ Repos | Swarms ] toggle. Per-browser like every other field in this
   *  store: it resets to `repos` on reload rather than round-tripping through state.json — no
   *  AC requires the toggle itself to survive a reload, only swarm collapse/order (via
   *  UiState). */
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  /** Expanded directory paths per session, since each session's file tree is rooted at its
   *  own cwd. */
  expandedPaths: Record<string, readonly string[]>;
  toggleExpandedPath: (sessionId: string, path: string) => void;
  /** Drag-resized sidebar widths, clamped to a usable range. Reset to their defaults on reload
   *  like every other field here — not round-tripped through server state. */
  sidebarWidth: number;
  /** Applies an incremental delta (e.g. a pointermove's movementX) against the *current* store
   *  value rather than a value the caller read earlier — a drag fires many of these per render,
   *  so resolving against a React-render snapshot of sidebarWidth would drop deltas whenever a
   *  render hasn't committed between two pointermove events. `viewportWidth` and
   *  `otherPanelReserved` (the file panel's width, or 0 when it's closed) let the caller fold in
   *  the room `.stage-wrap` needs so the two sidebars' independent clamps can't jointly squeeze
   *  it below `STAGE_MIN_WIDTH`. */
  resizeSidebarBy: (deltaPx: number, viewportWidth: number, otherPanelReserved: number) => void;
  filePanelWidth: number;
  resizeFilePanelBy: (deltaPx: number, viewportWidth: number, otherPanelReserved: number) => void;
  /** A `path:line` clicked in a pane's terminal output, resolved against the session's cwd by
   *  whichever endpoint later opens it. Null once nothing is pending. */
  openFileRequest: OpenFileRequest | null;
  requestOpenFile: (sessionId: string, path: string, line: number | null) => void;
  /** Counts connections of the event socket. A pane keys its attach on this and opens a fresh
   *  socket on reconnect — the failure modes that drop this socket (server restart, sleep/wake)
   *  usually take pane attaches with them, and rebuilding a pane that was still fine costs only
   *  its local scrollback. */
  connectionEpoch: number;
  noteConnected: () => void;
  /** A swarm the pane-header chip asked the Swarms sidebar to scroll to and flash. A one-shot
   *  target the sidebar clears after acting on it, same shape as `openFileRequest`. */
  selectedSwarmId: string | null;
  setSelectedSwarmId: (id: string | null) => void;
}

export const useLocalStore = create<LocalStore>((set) => ({
  scrollOffsets: {},
  setScrollOffset: (key, offset) =>
    set((state) => ({ scrollOffsets: { ...state.scrollOffsets, [key]: offset } })),
  sidebarMode: 'repos',
  setSidebarMode: (mode) => set({ sidebarMode: mode }),
  expandedPaths: {},
  toggleExpandedPath: (sessionId, path) =>
    set((state) => {
      const current = state.expandedPaths[sessionId] ?? [];
      const next = current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path];
      return { expandedPaths: { ...state.expandedPaths, [sessionId]: next } };
    }),
  sidebarWidth: 280,
  resizeSidebarBy: (deltaPx, viewportWidth, otherPanelReserved) =>
    set((state) => {
      const roomForStage = viewportWidth - otherPanelReserved - STAGE_MIN_WIDTH;
      const effectiveMax = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, roomForStage));
      return { sidebarWidth: clamp(state.sidebarWidth + deltaPx, SIDEBAR_WIDTH_MIN, effectiveMax) };
    }),
  filePanelWidth: 320,
  resizeFilePanelBy: (deltaPx, viewportWidth, otherPanelReserved) =>
    set((state) => {
      // Half the viewport on a wide display, but never less than the 640px floor that governs
      // narrow ones — so behaviour there is unchanged.
      const proportionalMax = Math.max(FILE_PANEL_WIDTH_MAX, viewportWidth / 2);
      const roomForStage = viewportWidth - otherPanelReserved - STAGE_MIN_WIDTH;
      const effectiveMax = Math.min(proportionalMax, Math.max(FILE_PANEL_WIDTH_MIN, roomForStage));
      return {
        filePanelWidth: clamp(state.filePanelWidth + deltaPx, FILE_PANEL_WIDTH_MIN, effectiveMax),
      };
    }),
  openFileRequest: null,
  requestOpenFile: (sessionId, path, line) => set({ openFileRequest: { sessionId, path, line } }),
  connectionEpoch: 0,
  noteConnected: () => set((state) => ({ connectionEpoch: state.connectionEpoch + 1 })),
  selectedSwarmId: null,
  setSelectedSwarmId: (id) => set({ selectedSwarmId: id }),
}));
