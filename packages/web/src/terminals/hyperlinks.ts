const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Parses `text` as a URL, retrying once with an assumed `https://` scheme when it doesn't parse
 *  on its own — the only reading a bare host/path OSC 8 URI (`www.here.com`) can plausibly have.
 *  Returns `undefined` when neither reading parses. This is normalization only: it does not
 *  judge the result, so a caller cannot mistake "parsed" for "safe to open". */
function toUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    // not an absolute URL on its own — fall through to the https:// retry below
  }
  try {
    return new URL(`https://${text}`);
  } catch {
    return undefined;
  }
}

/**
 * Normalizes OSC 8 link text into an openable URL, or `undefined` if it isn't one. This is the
 * single point where the http(s) allowlist is enforced, and it runs on the fully normalized
 * result rather than on `text` itself — a scheme rejected here was never given a second look via
 * the https:// retry, and nothing else in this module inspects `text` directly. That keeps "did
 * this pass the allowlist" a property of the return value alone, not of which branch produced it.
 */
export function normalizeLinkUrl(text: string): URL | undefined {
  const url = toUrl(text);
  if (url === undefined || !ALLOWED_PROTOCOLS.has(url.protocol)) return undefined;
  return url;
}

/** Opens `url` the way a link click should: a new tab, explicitly isolated from this page via
 *  `noopener` (the new tab gets no `window.opener` back to us) and `noreferrer` (no Referer
 *  header naming this page) rather than relying on a browser's implicit `noopener` for
 *  `_blank`, which is default behavior in modern browsers but isn't guaranteed the same way an
 *  explicit feature string is. */
export function openExternalLink(
  url: string,
  openWindow: typeof window.open = (...args) => window.open(...args),
): void {
  const opened = openWindow(url, '_blank', 'noopener,noreferrer');
  if (opened === null) {
    console.warn('Opening link blocked by the browser');
  }
}

/** The `activate` half of an OSC 8 `linkHandler`: normalizes and validates the link text, then
 *  opens it if it passed. A link that fails normalization — no scheme and no plausible https://
 *  reading, or a scheme outside the http(s) allowlist — does nothing on click. */
export function activateOscLink(
  text: string,
  openWindow: typeof window.open = (...args) => window.open(...args),
): void {
  const url = normalizeLinkUrl(text);
  if (url === undefined) return;
  openExternalLink(url.toString(), openWindow);
}
