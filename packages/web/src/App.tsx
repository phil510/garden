import { useEffect, useState } from 'react';
import { connectEventSocket } from './api/eventSocket';
import { ResizeHandle } from './components/ResizeHandle';
import { FilePanel } from './features/filetree/FilePanel';
import { Sidebar } from './features/sidebar/Sidebar';
import { PresetSwitcher } from './features/stage/PresetSwitcher';
import { Stage } from './features/stage/Stage';
import { useLocalStore } from './state/localStore';
import { useSessionStore } from './state/sessionStore';
import { useUiStore } from './state/uiStore';

export function App() {
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const sidebarWidth = useLocalStore((state) => state.sidebarWidth);
  const resizeSidebarBy = useLocalStore((state) => state.resizeSidebarBy);
  const filePanelWidth = useLocalStore((state) => state.filePanelWidth);
  const resizeFilePanelBy = useLocalStore((state) => state.resizeFilePanelBy);

  useEffect(() => {
    const sessionStore = useSessionStore.getState();
    const uiStore = useUiStore.getState();
    const localStore = useLocalStore.getState();
    return connectEventSocket({
      onSnapshot: (message) => {
        sessionStore.setSnapshot(message.sessions);
        uiStore.setUiState(message.uiState);
      },
      onDeltas: (message) => {
        sessionStore.applyDeltas(message.deltas);
      },
      onUiState: (message) => {
        uiStore.setUiState(message.uiState);
      },
      onConnect: localStore.noteConnected,
    });
  }, []);

  return (
    <div className="app-shell">
      <div className="topbar">
        <PresetSwitcher />
        <div className="topbar-spacer" />
        <button
          className={filePanelOpen ? 'ghost icon-btn active-btn' : 'ghost icon-btn'}
          title="Toggle file panel"
          aria-pressed={filePanelOpen}
          onClick={() => setFilePanelOpen((open) => !open)}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="3" y="4" width="18" height="16" rx="1.5" />
            <path d="M14 4v16" />
          </svg>
        </button>
      </div>
      <div className="body-row">
        <div className="sidebar" style={{ width: `${sidebarWidth}px` }}>
          <Sidebar />
        </div>
        <ResizeHandle
          onResize={(delta) =>
            resizeSidebarBy(delta, window.innerWidth, filePanelOpen ? filePanelWidth : 0)
          }
        />
        <div className="stage-wrap">
          <Stage />
        </div>
        <ResizeHandle
          onResize={(delta) => resizeFilePanelBy(-delta, window.innerWidth, sidebarWidth)}
          hidden={!filePanelOpen}
        />
        <div className="filepanel" hidden={!filePanelOpen} style={{ width: `${filePanelWidth}px` }}>
          <FilePanel />
        </div>
      </div>
    </div>
  );
}
