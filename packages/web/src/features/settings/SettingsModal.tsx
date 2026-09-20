import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { getSettings, updateSettings } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import './settings.css';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [claudeCommand, setClaudeCommand] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // Always fetches on mount rather than trusting a value carried over from a prior open —
  // config.json may have changed on disk since then.
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (!cancelled) {
          setClaudeCommand(settings.claudeCommand);
          setLoaded(true);
        }
      })
      .catch((err: unknown) => {
        reportCommandFailure(err);
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Closing (or Escape) while a save is in flight must not set state on an unmounted modal.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function onOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  // No optimistic update: the server is the writer, so the input is reset from a fresh
  // getSettings() call rather than trusting the value just typed to have stuck. The
  // re-read's failure is caught separately from the write's: a failed PUT means the save
  // failed, but a PUT that succeeds followed by a GET that fails is a stale display, not a
  // failed save, and must not tell the user their change didn't land when it did.
  function save() {
    setSaving(true);
    setSaveFailed(false);
    updateSettings({ claudeCommand })
      .then(() =>
        getSettings()
          .then((settings) => {
            if (mountedRef.current) setClaudeCommand(settings.claudeCommand);
          })
          .catch((err: unknown) => {
            reportCommandFailure(err);
          }),
      )
      .catch((err: unknown) => {
        reportCommandFailure(err);
        if (mountedRef.current) setSaveFailed(true);
      })
      .finally(() => {
        if (mountedRef.current) setSaving(false);
      });
  }

  return (
    <div className="modal-overlay" onClick={onOverlayClick}>
      <div
        className="modal-box settings-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title" className="settings-title">
          Settings
        </h2>
        <div className="settings-field">
          <label htmlFor="settings-claude-command">Claude Code launch command</label>
          <input
            id="settings-claude-command"
            type="text"
            autoComplete="off"
            autoFocus
            disabled={!loaded || saving}
            value={claudeCommand}
            onChange={(event) => setClaudeCommand(event.target.value)}
          />
        </div>
        <div className="settings-note faint">
          Restarting the garden server is required for a saved change to take effect.
        </div>
        {loadFailed && <div className="settings-note settings-error">Could not load settings.</div>}
        {saveFailed && <div className="settings-note settings-error">Could not save settings.</div>}
        <div className="settings-actions">
          <button className="ghost" onClick={onClose}>
            Close
          </button>
          <button disabled={!loaded || saving || claudeCommand.trim() === ''} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
