import { create } from 'zustand';

export interface OpenFileRequest {
  sessionId: string;
  path: string;
  line: number;
}

const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 560;
const FILE_PANEL_WIDTH_MIN = 220;
const FILE_PANEL_WIDTH_MAX = 640;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface LocalStore {
  /** Keyed by whatever id the caller scrolls — a pane, a tree, a list. */
  scrollOffsets: Record<string, number>;
  setScrollOffset: (key: string, offset: number) => void;
  /** Expanded directory paths per session, since each session's file tree is rooted at its
   *  own cwd. */
  expandedPaths: Record<string, readonly string[]>;
  toggleExpandedPath: (sessionId: string, path: string) => void;
  /** Drag-resized sidebar widths, clamped to a usable range. Reset to their defaults on reload
   *  like every other field here — not round-tripped through server state. */
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  filePanelWidth: number;
  setFilePanelWidth: (width: number) => void;
  /** A `path:line` clicked in a pane's terminal output, resolved against the session's cwd by
   *  whichever endpoint later opens it. Null once nothing is pending. */
  openFileRequest: OpenFileRequest | null;
  requestOpenFile: (sessionId: string, path: string, line: number) => void;
  /** Counts connections of the event socket. A pane keys its attach on this and opens a fresh
   *  socket on reconnect — the failure modes that drop this socket (server restart, sleep/wake)
   *  usually take pane attaches with them, and rebuilding a pane that was still fine costs only
   *  its local scrollback. */
  connectionEpoch: number;
  noteConnected: () => void;
}

export const useLocalStore = create<LocalStore>((set) => ({
  scrollOffsets: {},
  setScrollOffset: (key, offset) =>
    set((state) => ({ scrollOffsets: { ...state.scrollOffsets, [key]: offset } })),
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
  setSidebarWidth: (width) =>
    set({ sidebarWidth: clamp(width, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX) }),
  filePanelWidth: 320,
  setFilePanelWidth: (width) =>
    set({ filePanelWidth: clamp(width, FILE_PANEL_WIDTH_MIN, FILE_PANEL_WIDTH_MAX) }),
  openFileRequest: null,
  requestOpenFile: (sessionId, path, line) => set({ openFileRequest: { sessionId, path, line } }),
  connectionEpoch: 0,
  noteConnected: () => set((state) => ({ connectionEpoch: state.connectionEpoch + 1 })),
}));
