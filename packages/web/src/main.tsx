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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

getSettings()
  .then(({ deadSessionCap }) => useSettingsStore.getState().setSettings({ deadSessionCap }))
  .catch(reportCommandFailure);
