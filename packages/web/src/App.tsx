import { useEffect, useState } from 'react';
import { connectEventSocket } from './api/eventSocket';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ResizeHandle } from './components/ResizeHandle';
import { Toast } from './components/Toast';
import { FilePanel } from './features/filetree/FilePanel';
import { Sidebar } from './features/sidebar/Sidebar';
import { SettingsModal } from './features/settings/SettingsModal';
import { ShutdownOverlay } from './features/shutdown/ShutdownOverlay';
import { PresetSwitcher } from './features/stage/PresetSwitcher';
import { Stage } from './features/stage/Stage';
import { useLocalStore } from './state/localStore';
import { useSessionStore } from './state/sessionStore';
import { useUiStore } from './state/uiStore';

export function App() {
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
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
      onShutdown: () => setStopped(true),
    });
  }, []);

  if (stopped) return <ShutdownOverlay />;

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <div className="topbar">
          <PresetSwitcher />
          <div className="topbar-spacer" />
          <button className="ghost icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
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
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
          <div
            className="filepanel"
            hidden={!filePanelOpen}
            style={{ width: `${filePanelWidth}px` }}
          >
            <FilePanel />
          </div>
        </div>
      </div>
      <Toast />
    </ErrorBoundary>
  );
}
