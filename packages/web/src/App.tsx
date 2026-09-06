import { useEffect } from 'react';
import { connectEventSocket } from './api/eventSocket';
import { Sidebar } from './features/sidebar/Sidebar';
import { useSessionStore } from './state/sessionStore';
import { useUiStore } from './state/uiStore';

export function App() {
  useEffect(() => {
    const sessionStore = useSessionStore.getState();
    const uiStore = useUiStore.getState();
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
      onConnect: () => {},
    });
  }, []);

  return (
    <div className="app-shell">
      <div className="topbar" />
      <div className="body-row">
        <div className="sidebar">
          <Sidebar />
        </div>
        <div className="stage-wrap" />
        <div className="filepanel" />
      </div>
    </div>
  );
}
