import normalizeUrl from 'normalize-url';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** `normalize-url` is used only as a classifier here, never as a value producer: it answers one
 *  question — does `text` have no scheme of its own (a bare host like `www.here.com`, or a
 *  `host:port` shape like `localhost:3000` that a naive `new URL` would misread as a custom
 *  scheme), so an assumed `https://` prefix is warranted? Its own output is discarded immediately
 *  after that question is answered (see `isSchemelessHost`); `toUrl` always builds the final URL
 *  itself from the untouched original `text`. That split exists because several of the package's
 *  rewrites — duplicate-slash collapse, percent-decoding the path, trailing-dot host stripping —
 *  have no disabling option and would silently open a different resource than the terminal
 *  printed. `stripAuthentication` stays off in the options below anyway, on the off chance a
 *  future caller reads the normalized string directly: silently dropping userinfo would make a
 *  `user@evil.example` link open cleanly instead of getting caught by the userinfo check in
 *  `normalizeLinkUrl`. */
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

/** `normalize-url` treats `https:`, `http:`, and `file:` as schemes it normalizes in place
 *  rather than as opaque custom protocols — which means its classifier never recognizes a
 *  malformed, slash-less form of these three (`https:/example.com`, `file:/etc/passwd`) as
 *  already scheme-qualified: it falls through to the same path a bare, schemeless host takes.
 *  Checking for these three ourselves closes that gap without asking the classifier a question
 *  its own logic doesn't answer correctly. */
const KNOWN_SCHEME_PREFIX = /^(?:https?|file):/i;

/** Only the canonical `scheme://` authority form of the three schemes above is trusted; a
 *  single-slash or no-slash form is rejected outright rather than parsed, because the `URL`
 *  constructor's own slash-leniency for these "special" schemes would otherwise silently resolve
 *  it to a host nothing in `text` unambiguously named (`https:/example.com` parses to
 *  `https://example.com/`, not an error). */
const KNOWN_SCHEME_AUTHORITY = /^(?:https?|file):\/\//i;

/** No URI scheme this module cares about could legitimately start with this exact string. Once
 *  `isSchemelessHost` has ruled out `text` itself starting with it, the sentinel's presence at
 *  the front of `normalize-url`'s output unambiguously means `text` was schemeless and got this
 *  prefix assumed for it. */
const SCHEMELESS_SENTINEL = 'garden-schemeless-marker:';

/** Asks `normalize-url` the one question it is uniquely good at: would `text` be assumed
 *  schemeless and get a default protocol prepended? The sentinel default protocol makes that
 *  answer readable without inspecting anything else about the returned string, which is
 *  discarded immediately after. */
function isSchemelessHost(text: string): boolean {
  // `text` that already begins with the sentinel's own scheme carries an explicit (if
  // nonsensical) scheme of its own — normalize-url's classifier recognizes that and returns
  // `text` unchanged, which would otherwise be indistinguishable from "got prefixed" once this
  // function checks whether the output starts with the sentinel.
  if (text.toLowerCase().startsWith(SCHEMELESS_SENTINEL)) return false;

  try {
    return normalizeUrl(text, {
      ...NORMALIZE_OPTIONS,
      // normalize-url's type declares this option as 'https' | 'http', narrower than what it
      // actually accepts at runtime (any string gets prepended as-is).
      defaultProtocol: SCHEMELESS_SENTINEL as 'https',
    })
      .toLowerCase()
      .startsWith(SCHEMELESS_SENTINEL);
  } catch {
    return false;
  }
}

/** Parses `text` as a URL, prefixing an assumed `https://` only when `text` has no scheme of its
 *  own. Every branch constructs the returned `URL` from `text` itself (trimmed, never rewritten,
 *  never read back from `normalize-url`), so what opens is exactly what the terminal printed. A
 *  `text` that already carries an explicit scheme — including a malformed one like `ftp://` or
 *  `https://` with nothing after it, or a slash-less one like `file:/etc/passwd` — is never
 *  prefix-rescued into a different, unintended host: it is parsed as its own scheme (for a
 *  recognized non-http(s) scheme) or rejected outright (for a malformed one), and either way
 *  `normalizeLinkUrl` rejects it below. Returns `undefined` when nothing usable comes out. This
 *  is normalization only: it does not judge the result, so a caller cannot mistake "parsed" for
 *  "safe to open". */
function toUrl(text: string): URL | undefined {
  const trimmed = text.trim();

  if (KNOWN_SCHEME_PREFIX.test(trimmed)) {
    if (!KNOWN_SCHEME_AUTHORITY.test(trimmed)) return undefined;
    try {
      return new URL(trimmed);
    } catch {
      return undefined;
    }
  }

  if (isSchemelessHost(trimmed)) {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      return undefined;
    }
  }

  try {
    return new URL(trimmed);
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
