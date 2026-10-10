import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getSettings } from './api/client';
import { reportCommandFailure } from './api/reportCommandFailure';
import { useSettingsStore } from './state/settingsStore';
import './styles/tokens.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root element');
}

// Settings load before the first render: panes attach as soon as the first snapshot arrives, so
// a fetch started from an effect could lose the race and build a terminal at the default size.
getSettings()
  .then(({ deadSessionCap, terminalFontSize }) =>
    useSettingsStore.getState().setSettings({ deadSessionCap, terminalFontSize }),
  )
  .catch(reportCommandFailure)
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
