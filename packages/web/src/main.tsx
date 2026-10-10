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

// Settings load before the first render so the sidebar doesn't first draw at the default cap and
// then re-flow once the configured one arrives.
getSettings()
  .then(({ deadSessionCap }) => useSettingsStore.getState().setSettings({ deadSessionCap }))
  .catch(reportCommandFailure)
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
