import type { FileResponse } from '@garden/shared';
import type { ThemedToken } from 'shiki';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { getFile } from '../../api/client';
import { commandFailureMessage } from '../../api/reportCommandFailure';
import { useLocalStore, type OpenFileRequest } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useToastStore } from '../../state/toastStore';
import { tokenizeFile } from './highlighter';
import { isMarkdownFile } from './markdown';
import { MarkdownBody } from './MarkdownBody';
import { displayPath, openFailureMessage } from './pathLineErrors';
import { tokenStyle } from './tokenStyle';
import { resetModeForOpenedFile, shouldResetMode, type ViewMode } from './viewMode';
import {
  activeSource,
  isLoading,
  liveTransient,
  nextLoaded,
  sourceKey,
  sourceScope,
  type LoadedFile,
  type TransientFile,
} from './viewerSource';

interface ViewerProps {
  /** The panel's shown project root, and that root's persisted open file (root-relative). */
  root: string | null;
  openFile: string | null;
  /** Called once a session-sourced request has loaded, so the panel can bring this tab forward. */
  onSessionFileOpened: () => void;
  /** The path of the file currently displayed, or null; the tab above takes its name from it. */
  onShownPathChange: (path: string | null) => void;
  /** Whether a session-sourced file is on top of the root's open file, so the tree can skip highlighting it. */
  onTransientShownChange: (shown: boolean) => void;
}

/**
 * Read-only, one file at a time, no tabs of its own. Shows the panel root's persisted open file,
 * unless a `path:line` click from a pane with no containing project put a session-sourced file
 * on top of it (transient: cleared when the root or open file changes, never persisted). Both
 * refetch on every refresh epoch. A file that fails to load shows its error in place of the
 * content, including when a refetch fails after an earlier success.
 */
export function Viewer({
  root,
  openFile,
  onSessionFileOpened,
  onShownPathChange,
  onTransientShownChange,
}: ViewerProps) {
  const openFileRequest = useLocalStore((state) => state.openFileRequest);
  const fsRefreshEpoch = useLocalStore((state) => state.fsRefreshEpoch);
  const [transient, setTransient] = useState<TransientFile | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  // A root or open-file change drops the transient file for good rather than just hiding it.
  const liveTransientFile = liveTransient(root, openFile, transient);
  if (liveTransientFile !== transient) setTransient(liveTransientFile);
  const source = activeSource(root, openFile, liveTransientFile);
  const key = source === null ? null : sourceKey(source);
  // A file fetched for another source is never shown, so a root switch can't flash the old file.
  const current = loaded !== null && loaded.key === key ? loaded.result : null;
  const file = current?.kind === 'file' ? current.file : null;
  const loadError = current?.kind === 'error' ? current.message : null;
  // Set when a request has just loaded the file for `key`, so the fetch effect doesn't repeat it.
  const justLoadedKey = useRef<string | null>(null);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const [openAnyway, setOpenAnyway] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<ViewMode>('rendered');
  const showMarkdown = file !== null && file.kind === 'text' && isMarkdownFile(file.path);
  // Tracks which `file` `mode` was last considered for, so a new file resets it during render
  // rather than in an effect. An effect would still leave the tokenize effect below reading
  // this render's stale `mode` (effects fire in declaration order against the same render's
  // closures), risking one stale frame before a second pass corrects it.
  const [modeResetFor, setModeResetFor] = useState<{
    file: FileResponse | null;
    key: string | null;
  }>({ file: null, key: null });
  if (file !== modeResetFor.file) {
    setModeResetFor({ file, key: file === null ? null : key });
    if (shouldResetMode(modeResetFor.key, file === null ? null : key, pendingLine)) {
      const nextMode = resetModeForOpenedFile(showMarkdown, pendingLine);
      setMode(nextMode);
      // A line request the new mode won't honor (rendered mode never scrolls) is already
      // consumed — leaving it pending would fire a late, unexpected scroll if the user manually
      // switches to source mode afterward.
      if (showMarkdown && nextMode === 'rendered' && pendingLine !== null) setPendingLine(null);
    }
  }
  const bodyRef = useRef<HTMLDivElement>(null);

  const recordResult = (nextKey: string, result: LoadedFile['result']) =>
    setLoaded((prev) => nextLoaded(prev, nextKey, result));

  const fetchShown = useEffectEvent(() => {
    if (source === null || key === null) return () => undefined;
    if (justLoadedKey.current === key) {
      justLoadedKey.current = null;
      return () => undefined;
    }
    let cancelled = false;
    getFile(sourceScope(source), source.path)
      .then((response) => {
        if (!cancelled) recordResult(key, { kind: 'file', file: response });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        recordResult(key, { kind: 'error', message: commandFailureMessage(error) });
        // No tokens will arrive to consume the line, so it would scroll whatever loads next.
        setPendingLine(null);
      });
    return () => {
      cancelled = true;
    };
  });

  useEffect(() => fetchShown(), [key, fsRefreshEpoch]);

  const handleRequest = useEffectEvent((request: OpenFileRequest) => {
    const { source: requested, path, line } = request;
    if (requested.kind === 'root') {
      // The root's open file drives the fetch; this only carries the line to it, and drops a
      // session-sourced file that would otherwise stay on top of it.
      if (requested.root !== root) return () => undefined;
      setTransient(null);
      // An errored file isn't refetched by this click, so nothing would consume the line.
      setPendingLine(loadError === null ? line : null);
      if (line === null) return () => undefined;
      if (showMarkdown) setMode('source');
      return () => undefined;
    }
    let cancelled = false;
    const show = (result: LoadedFile['result'], pendingLineAfter: number | null) => {
      const next: TransientFile = { sessionId: requested.sessionId, path, root, openFile };
      const nextKey = sourceKey({ kind: 'session', sessionId: next.sessionId, path });
      if (nextKey !== key) justLoadedKey.current = nextKey;
      setTransient(next);
      recordResult(nextKey, result);
      setPendingLine(pendingLineAfter);
      onSessionFileOpened();
    };
    getFile({ sessionId: requested.sessionId }, path)
      .then((response) => {
        if (!cancelled) show({ kind: 'file', file: response }, line);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A `path:line` the server can't resolve may be a false-positive match in terminal
        // output, so say so in a toast rather than opening an error view for it.
        const cwd = useSessionStore.getState().sessions[requested.sessionId]?.cwd;
        const message = openFailureMessage(error, displayPath(cwd, path));
        if (message !== null) {
          useToastStore.getState().showToast(message, 'error');
          return;
        }
        show({ kind: 'error', message: commandFailureMessage(error) }, null);
      });
    return () => {
      cancelled = true;
    };
  });

  useEffect(
    () => (openFileRequest === null ? undefined : handleRequest(openFileRequest)),
    [openFileRequest],
  );

  const shownPath = file?.path ?? (loadError !== null && source !== null ? source.path : null);
  useEffect(() => {
    onShownPathChange(shownPath);
  }, [shownPath, onShownPathChange]);

  const transientShown = source?.kind === 'session';
  useEffect(() => {
    onTransientShownChange(transientShown);
  }, [transientShown, onTransientShownChange]);

  const gated =
    file !== null && file.kind === 'text' && file.truncated && key !== null && !openAnyway.has(key);
  // A text file the server cut short that the user chose to open anyway.
  const truncatedShown =
    file !== null && file.kind === 'text' && file.truncated && key !== null && openAnyway.has(key);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [file]);

  useEffect(() => {
    if (file === null || file.kind !== 'text' || gated) {
      setTokens(null);
      return;
    }
    if (showMarkdown && mode === 'rendered') {
      // Rendered mode never displays the token view, so skip tokenizing the whole file —
      // fenced code blocks tokenize their own snippet on demand via MarkdownCodeBlock.
      setTokens(null);
      return;
    }
    let cancelled = false;
    tokenizeFile(file.path, file.text)
      .then((result) => {
        if (!cancelled) setTokens(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [file, gated, showMarkdown, mode]);

  useEffect(() => {
    if (gated || pendingLine === null || tokens === null || bodyRef.current === null) return;
    bodyRef.current.children[pendingLine - 1]?.scrollIntoView({ block: 'center' });
    setPendingLine(null);
  }, [gated, pendingLine, tokens]);

  if (file === null && loadError !== null && source !== null) {
    return (
      <div className="fp-viewer">
        <div className="fp-viewer-header">
          <span className="fp-viewer-path">{source.path}</span>
        </div>
        <div className="fp-viewer-body">
          <div className="fp-load-error" role="alert">
            Couldn&apos;t load this file: {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (source !== null && isLoading(source, current)) {
    return (
      <div className="fp-viewer">
        <div className="fp-viewer-header">
          <span className="fp-viewer-path">{source.path}</span>
        </div>
        <div className="fp-viewer-body">
          <div className="fp-viewer-empty" role="status">
            Loading…
          </div>
        </div>
      </div>
    );
  }

  if (file === null) {
    return (
      <div className="fp-viewer">
        <div className="fp-viewer-header">No file open</div>
        <div className="fp-viewer-body">
          <div className="fp-viewer-empty">Select a file to view its contents.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fp-viewer">
      <div className="fp-viewer-header">
        <span className="fp-viewer-path">{file.path}</span>
        {truncatedShown && (
          <span className="fp-viewer-truncated" title="Only the start of this file is shown.">
            Truncated
          </span>
        )}
        {showMarkdown && !gated && (
          <div className="fp-viewer-mode-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={mode === 'rendered' ? 'fp-tab active' : 'fp-tab'}
              aria-pressed={mode === 'rendered'}
              onClick={() => setMode('rendered')}
            >
              Rendered
            </button>
            <button
              type="button"
              className={mode === 'source' ? 'fp-tab active' : 'fp-tab'}
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
            >
              Source
            </button>
          </div>
        )}
      </div>
      <div className="fp-viewer-body" ref={bodyRef}>
        {file.kind === 'binary' || (file.kind === 'image' && imageFailed) ? (
          <div className="size-cap">
            <span>Can&apos;t preview this file.</span>
          </div>
        ) : file.kind === 'image' && file.truncated ? (
          <div className="size-cap">
            <span>This image is too large to preview.</span>
          </div>
        ) : file.kind === 'image' ? (
          <div className="fp-viewer-image">
            <img
              src={`data:${file.mimeType};base64,${file.data}`}
              alt={file.path}
              onError={() => setImageFailed(true)}
            />
          </div>
        ) : gated ? (
          <div className="size-cap">
            <span>This file is large — showing it may be slow.</span>
            <button
              className="primary"
              onClick={() => {
                if (key !== null) setOpenAnyway((current) => new Set(current).add(key));
              }}
            >
              Open anyway
            </button>
          </div>
        ) : showMarkdown && mode === 'rendered' ? (
          <MarkdownBody text={file.text} />
        ) : (
          (tokens ?? []).map((line, index) => (
            <div className="code-line" key={index}>
              <span className="lc">
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} style={tokenStyle(token)}>
                    {token.content}
                  </span>
                ))}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
