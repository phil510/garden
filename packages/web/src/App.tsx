import { useEffect, useState } from 'react';
import { connectEventSocket } from './api/eventSocket';
import { FilePanel } from './features/filetree/FilePanel';
import { Sidebar } from './features/sidebar/Sidebar';
import { PresetSwitcher } from './features/stage/PresetSwitcher';
import { Stage } from './features/stage/Stage';
import { useLocalStore } from './state/localStore';
import { useSessionStore } from './state/sessionStore';
import { useUiStore } from './state/uiStore';

export function App() {
  const [filePanelOpen, setFilePanelOpen] = useState(true);

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
        <div className="sidebar">
          <Sidebar />
        </div>
        <div className="stage-wrap">
          <Stage />
        </div>
        <div className="filepanel" hidden={!filePanelOpen}>
          <FilePanel />
        </div>
      </div>
    </div>
  );
}
