import type { FileResponse } from '@garden/shared';
import type { ThemedToken } from 'shiki';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getFile } from '../../api/client';
import { useLocalStore } from '../../state/localStore';
import { tokenizeFile } from './highlighter';
import { isMarkdownFile } from './markdown';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { tokenStyle } from './tokenStyle';
import { resetModeForOpenedFile, type ViewMode } from './viewMode';

interface ViewerProps {
  sessionId: string;
  /** Called once a requested file has actually loaded, so the tab above can pick up its name. */
  onFileOpened: (path: string) => void;
}

/** Every link renders as inert text — the viewer has no route to resolve a relative link's
 *  target, and the brief scopes navigation and absolute-vs-relative treatment out alike. */
const MarkdownLink: NonNullable<Components['a']> = ({ children }) => (
  <span className="fp-md-link">{children}</span>
);

/** Images never fetch — same reasoning as links, plus no appetite for a markdown file to
 *  reach out to an arbitrary URL from inside the console. */
const MarkdownImage: NonNullable<Components['img']> = ({ alt }) => (
  <span className="fp-md-image">{alt || 'image'}</span>
);

/** Overrides `pre` rather than `code` so a fenced block (wrapped in `pre`) and an inline code
 *  span (bare `code`, never reaching this component) are told apart structurally instead of by
 *  guessing from a `language-*` class that a fence without an info string never gets. Reads the
 *  fence's language and text straight off the raw hast node rather than `props.children`, since
 *  `children` here is already-rendered output from the default (unoverridden) `code` element. */
const MarkdownPre: NonNullable<Components['pre']> = ({ node }) => {
  let language: string | undefined;
  let value = '';
  for (const child of node?.children ?? []) {
    if (child.type !== 'element' || child.tagName !== 'code') continue;
    const classNameProp = child.properties?.className;
    const classNames = Array.isArray(classNameProp) ? classNameProp.map(String) : [];
    language = classNames.find((name) => name.startsWith('language-'))?.slice('language-'.length);
    value = child.children
      .map((grandchild) => (grandchild.type === 'text' ? grandchild.value : ''))
      .join('')
      .replace(/\n$/, '');
  }
  return <MarkdownCodeBlock language={language} value={value} />;
};

const markdownComponents: Components = {
  pre: MarkdownPre,
  a: MarkdownLink,
  img: MarkdownImage,
};

/** Per-file dismissal of the size-cap gate, so switching sessions or files re-shows it —
 *  a decision made about one large file says nothing about the next one. */
function openAnywayKey(sessionId: string, path: string): string {
  return `${sessionId} ${path}`;
}

/**
 * Read-only, one file at a time, no tabs of its own. Reacts to `openFileRequest` — set by
 * either a tree row click or a `path:line` link clicked in a pane's terminal — by fetching
 * that file scoped to this session's cwd; a request for a different session is not this
 * viewer's to show, and a path the server can't resolve is a no-op: the viewer is left exactly
 * as it was.
 */
export function Viewer({ sessionId, onFileOpened }: ViewerProps) {
  const openFileRequest = useLocalStore((state) => state.openFileRequest);
  const [file, setFile] = useState<FileResponse | null>(null);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const [openAnyway, setOpenAnyway] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<ViewMode>('rendered');
  const showMarkdown = file !== null && file.kind === 'text' && isMarkdownFile(file.path);
  // Tracks which `file` `mode` was last reset for, so a new file resets it to 'rendered'
  // during render rather than in an effect. An effect would still leave the tokenize effect
  // below reading this render's stale `mode` (effects fire in declaration order against the
  // same render's closures), risking one stale frame before a second pass corrects it.
  const [modeResetFor, setModeResetFor] = useState<FileResponse | null>(null);
  if (file !== modeResetFor) {
    setModeResetFor(file);
    const nextMode = resetModeForOpenedFile(showMarkdown, pendingLine);
    setMode(nextMode);
    // A line request the new mode won't honor (rendered mode never scrolls) is already
    // consumed — leaving it pending would fire a late, unexpected scroll if the user manually
    // switches to source mode afterward.
    if (showMarkdown && nextMode === 'rendered' && pendingLine !== null) setPendingLine(null);
  }
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFile(null);
    setTokens(null);
    setPendingLine(null);
  }, [sessionId]);

  useEffect(() => {
    if (openFileRequest === null || openFileRequest.source.kind !== 'session') return;
    if (openFileRequest.source.sessionId !== sessionId) return;
    const { path, line } = openFileRequest;
    let cancelled = false;
    getFile({ sessionId }, path)
      .then((response) => {
        if (cancelled) return;
        setFile(response);
        setPendingLine(line);
        onFileOpened(response.path);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [openFileRequest, sessionId, onFileOpened]);

  const gated =
    file !== null &&
    file.kind === 'text' &&
    file.truncated &&
    !openAnyway.has(openAnywayKey(sessionId, file.path));
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
              onClick={() =>
                setOpenAnyway((current) =>
                  new Set(current).add(openAnywayKey(sessionId, file.path)),
                )
              }
            >
              Open anyway
            </button>
          </div>
        ) : showMarkdown && mode === 'rendered' ? (
          <div className="fp-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {file.text}
            </ReactMarkdown>
          </div>
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
