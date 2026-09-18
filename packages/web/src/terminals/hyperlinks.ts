import normalizeUrl from 'normalize-url';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** `normalize-url`'s job here is exactly one decision: does `text` get an assumed `https://`
 *  prefix, or does it already carry a scheme that must be left alone? Its defaults do far more
 *  than that — sorting query parameters, stripping `utm_*`, dropping trailing slashes, stripping
 *  `www.` — all of which would open a URL other than the one the terminal printed, so every
 *  meaning-rewriting default is turned off below. `stripAuthentication` stays off deliberately:
 *  silently dropping userinfo would make a `user@evil.example` link open cleanly instead of
 *  getting caught by the userinfo check in `normalizeLinkUrl`. What can't be turned off — scheme
 *  and host lowercasing — comes from the `URL` object itself, not from this package, and doesn't
 *  change what host a link opens. */
const NORMALIZE_OPTIONS = {
  defaultProtocol: 'https',
  stripAuthentication: false,
  stripTextFragment: false,
  stripWWW: false,
  removeQueryParameters: false,
  removeTrailingSlash: false,
  removeSingleSlash: false,
  sortQueryParameters: false,
} as const;

/** Parses `text` as a URL, prefixing an assumed `https://` only when `normalize-url` decides
 *  `text` has no scheme of its own (a bare host like `www.here.com`, or a `host:port` shape like
 *  `localhost:3000` that a naive `new URL` would misread as a custom scheme). A `text` that
 *  already carries an explicit scheme — including a malformed one like `ftp://` or `https://`
 *  with nothing after it — is never prefix-rescued into a different, unintended host: it is
 *  returned unchanged (for a recognized non-http(s) scheme) or rejected outright (for a
 *  malformed one), and either way `normalizeLinkUrl` rejects it below. Returns `undefined` when
 *  nothing usable comes out. This is normalization only: it does not judge the result, so a
 *  caller cannot mistake "parsed" for "safe to open". */
function toUrl(text: string): URL | undefined {
  let normalized: string;
  try {
    normalized = normalizeUrl(text, NORMALIZE_OPTIONS);
  } catch {
    return undefined;
  }
  try {
    return new URL(normalized);
  } catch {
    return undefined;
  }
}

/**
 * Normalizes OSC 8 link text into an openable URL, or `undefined` if it isn't one. This is the
 * single point where the http(s) allowlist and the userinfo check are enforced, and it runs on
 * the fully normalized result rather than on `text` itself — a scheme `toUrl` recognized and
 * left alone is never silently reinterpreted as http(s), and nothing else in this module
 * inspects `text` directly. That keeps "did this pass the allowlist" a property of the return
 * value alone, not of which branch produced it. A URL carrying a `username`/`password` is
 * rejected even though its protocol is http(s): userinfo is protocol-legal but resolves to
 * whatever host follows the `@`, which can differ completely from the host a reader sees first
 * (`https://trusted.example@evil.example` opens `evil.example`).
 */
export function normalizeLinkUrl(text: string): URL | undefined {
  const url = toUrl(text);
  if (url === undefined || !ALLOWED_PROTOCOLS.has(url.protocol)) return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  return url;
}

/** Normalizes and validates `text`, then opens it the way a link click should: a new tab,
 *  explicitly isolated from this page via `noopener` (the new tab gets no `window.opener` back
 *  to us) and `noreferrer` (no Referer header naming this page) rather than relying on a
 *  browser's implicit `noopener` for `_blank`. This is the only path to `window.open` in this
 *  module — both the OSC 8 `linkHandler` and the plain-URL `WebLinksAddon` handler call it
 *  directly with the matched text, so no caller can reach `window.open` without going through
 *  `normalizeLinkUrl`'s allowlist first. A `text` that fails normalization does nothing on
 *  click. There's no "was this actually blocked?" check on the result: `window.open` always
 *  returns `null` when `noopener`/`noreferrer` is present in the features string — there's no
 *  `WindowProxy` to hand back — so a real block and a normal successful open are indistinguishable
 *  from here. */
export function openExternalLink(
  text: string,
  openWindow: typeof window.open = (...args) => window.open(...args),
): void {
  const url = normalizeLinkUrl(text);
  if (url === undefined) return;
  openWindow(url.toString(), '_blank', 'noopener,noreferrer');
}
