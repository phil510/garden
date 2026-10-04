import { useEffect, useRef, useState } from 'react';
import { connectEventSocket } from './api/eventSocket';
import { AppTitle } from './components/AppTitle';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ResizeHandle } from './components/ResizeHandle';
import { Toast } from './components/Toast';
import { FilePanel } from './features/filetree/FilePanel';
import { Sidebar } from './features/sidebar/Sidebar';
import { SettingsModal } from './features/settings/SettingsModal';
import { ShutdownOverlay } from './features/shutdown/ShutdownOverlay';
import { anyFault, collectWatchGroups, summarizeWatchGroups } from './features/watches/allWatches';
import { EyeIcon } from './features/watches/WatchIcons';
import { WatchesPanel } from './features/watches/WatchesPanel';
import { usePipeGrace } from './features/watches/usePipeGrace';
import { PresetSwitcher } from './features/stage/PresetSwitcher';
import { Stage } from './features/stage/Stage';
import { useLocalStore } from './state/localStore';
import { usePipeGraceStore } from './state/pipeGraceStore';
import { useSessionStore } from './state/sessionStore';
import { useUiStore } from './state/uiStore';

type RightPanel = 'files' | 'watches' | null;

export function App() {
  const [rightPanel, setRightPanel] = useState<RightPanel>('files');
  // What the eye button returns to when it closes the watches view.
  const beforeWatches = useRef<RightPanel>('files');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const sidebarWidth = useLocalStore((state) => state.sidebarWidth);
  const resizeSidebarBy = useLocalStore((state) => state.resizeSidebarBy);
  const filePanelWidth = useLocalStore((state) => state.filePanelWidth);
  const resizeFilePanelBy = useLocalStore((state) => state.resizeFilePanelBy);
  usePipeGrace();
  const sessions = useSessionStore((state) => state.sessions);
  const pipeFaulted = usePipeGraceStore((state) => state.faulted);
  const groups = collectWatchGroups(Object.values(sessions), pipeFaulted);
  const hasFault = anyFault(groups);
  const { faultedSessions } = summarizeWatchGroups(groups);

  useEffect(() => {
    const sessionStore = useSessionStore.getState();
    const uiStore = useUiStore.getState();
    const localStore = useLocalStore.getState();
    let connectedBefore = false;
    const controller = connectEventSocket({
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
      onFsChanged: (root) => {
        if (root === useLocalStore.getState().filePanel.root) localStore.bumpFsRefresh();
      },
      onConnect: () => {
        localStore.noteConnected();
        // `fs-changed` messages sent while disconnected are lost, so a reconnect refetches.
        if (connectedBefore) localStore.bumpFsRefresh();
        connectedBefore = true;
      },
      onShutdown: () => setStopped(true),
    });
    // `subscribe` doesn't fire with the current value, so the initial root is watched by hand.
    controller.watch(useLocalStore.getState().filePanel.root);
    const unsubscribe = useLocalStore.subscribe((state, previous) => {
      if (state.filePanel.root !== previous.filePanel.root) controller.watch(state.filePanel.root);
    });
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, []);

  function toggleWatches() {
    if (rightPanel === 'watches') {
      setRightPanel(beforeWatches.current);
    } else {
      beforeWatches.current = rightPanel;
      setRightPanel('watches');
    }
  }

  if (stopped) return <ShutdownOverlay />;

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <div className="topbar">
          <PresetSwitcher />
          <AppTitle />
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
            id="aw-open"
            className={`ghost icon-btn${rightPanel === 'watches' ? ' active-btn' : ''}${hasFault ? ' has-fault' : ''}`}
            title={
              hasFault
                ? `All watches: ${String(faultedSessions)} ${faultedSessions === 1 ? 'session' : 'sessions'} with a fault`
                : 'All watches'
            }
            aria-pressed={rightPanel === 'watches'}
            onClick={toggleWatches}
          >
            <EyeIcon />
          </button>
          <button
            className={rightPanel === 'files' ? 'ghost icon-btn active-btn' : 'ghost icon-btn'}
            title="Toggle file panel"
            aria-pressed={rightPanel === 'files'}
            onClick={() => setRightPanel(rightPanel === 'files' ? null : 'files')}
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
              resizeSidebarBy(delta, window.innerWidth, rightPanel !== null ? filePanelWidth : 0)
            }
          />
          <div className="stage-wrap">
            <Stage />
          </div>
          <ResizeHandle
            onResize={(delta) => resizeFilePanelBy(-delta, window.innerWidth, sidebarWidth)}
            hidden={rightPanel === null}
          />
          <div
            className="filepanel"
            hidden={rightPanel === null}
            style={{ width: `${filePanelWidth}px` }}
          >
            {/* Both stay mounted so switching views keeps the file tree's expansion and tabs. */}
            <div className="filepanel-pane" hidden={rightPanel !== 'files'}>
              <FilePanel />
            </div>
            <div className="filepanel-pane" hidden={rightPanel !== 'watches'}>
              <WatchesPanel />
            </div>
          </div>
        </div>
      </div>
      <Toast />
    </ErrorBoundary>
  );
}
