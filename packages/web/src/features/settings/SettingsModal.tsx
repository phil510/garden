import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { getSettings, updateSettings } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { fieldsFromSettings, toSettingsRequest, type SettingsFields } from './settingsFields';
import './settings.css';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [fields, setFields] = useState<SettingsFields>({
    claudeCommand: '',
    ignoreAuthors: '',
    quietWindowMinutes: '',
    pollIntervalMinutes: '',
  });
  const request = toSettingsRequest(fields);
  const setField = (key: keyof SettingsFields) => (event: ChangeEvent<HTMLInputElement>) =>
    setFields((prev) => ({ ...prev, [key]: event.target.value }));
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
          setFields(fieldsFromSettings(settings));
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
    if (request === null) return;
    setSaving(true);
    setSaveFailed(false);
    updateSettings(request)
      .then(() =>
        getSettings()
          .then((settings) => {
            if (mountedRef.current) setFields(fieldsFromSettings(settings));
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
    <div className="modal-overlay settings-overlay" onClick={onOverlayClick}>
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
            value={fields.claudeCommand}
            onChange={setField('claudeCommand')}
          />
        </div>
        <div className="settings-note faint">
          A saved command applies to the next new or resumed session, no restart required.
          GARDEN_CLAUDE_COMMAND still overrides a saved value when set.
        </div>
        <div className="settings-field">
          <label htmlFor="settings-ignore-authors">Ignored PR authors</label>
          <input
            id="settings-ignore-authors"
            type="text"
            autoComplete="off"
            placeholder="dependabot, renovate"
            disabled={!loaded || saving}
            value={fields.ignoreAuthors}
            onChange={setField('ignoreAuthors')}
          />
        </div>
        <div className="settings-note faint">
          Comma or space separated. Watches do not report these authors' comments or reviews.
        </div>
        <div className="settings-row">
          <div className="settings-field">
            <label htmlFor="settings-quiet-window">Quiet window (minutes)</label>
            <input
              id="settings-quiet-window"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={!loaded || saving}
              value={fields.quietWindowMinutes}
              onChange={setField('quietWindowMinutes')}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="settings-poll-interval">Poll interval (minutes)</label>
            <input
              id="settings-poll-interval"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={!loaded || saving}
              value={fields.pollIntervalMinutes}
              onChange={setField('pollIntervalMinutes')}
            />
          </div>
        </div>
        {loaded && request === null && (
          <div className="settings-note settings-error">
            Minutes must be whole numbers: quiet window 0 or more, poll interval 1 or more.
          </div>
        )}
        {loadFailed && <div className="settings-note settings-error">Could not load settings.</div>}
        {saveFailed && <div className="settings-note settings-error">Could not save settings.</div>}
        <div className="settings-actions">
          <button className="ghost" onClick={onClose}>
            Close
          </button>
          <button disabled={!loaded || saving || request === null} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
