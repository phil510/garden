import { describe, expect, it, vi } from 'vitest';
import { normalizeLinkUrl, openExternalLink } from './hyperlinks.js';

describe('normalizeLinkUrl', () => {
  it('normalizes a schemeless bare host by assuming https', () => {
    expect(normalizeLinkUrl('www.here.com')?.href).toBe('https://www.here.com/');
  });

  it('normalizes a schemeless host with a path, not just the www. example', () => {
    expect(normalizeLinkUrl('example.com/path')?.href).toBe('https://example.com/path');
  });

  it('normalizes a schemeless host:port, not misreading the host as a scheme', () => {
    // `new URL('localhost:3000')` parses on its own, with the host misread as a scheme
    // (`localhost:`), which used to short-circuit the https:// retry and drop a very common
    // shape of CLI-emitted link (dev server URLs). normalize-url's `localhost:port` carve-out
    // is what makes this resolve to a host, not a rejected scheme.
    expect(normalizeLinkUrl('localhost:3000')?.href).toBe('https://localhost:3000/');
  });

  it('normalizes a schemeless host:port with a path and a non-localhost host', () => {
    expect(normalizeLinkUrl('www.here.com:8080/path')?.href).toBe('https://www.here.com:8080/path');
  });

  it('preserves a query string and trailing slash rather than tidying them', () => {
    // Pins that the meaning-rewriting normalize-url defaults (utm_* stripping, query-parameter
    // sorting, trailing-slash removal) are disabled: the goal is opening exactly what the
    // terminal printed, not a cleaned-up version of it.
    expect(normalizeLinkUrl('https://foo.com/redirect/?utm_source=x&b=1&a=2')?.href).toBe(
      'https://foo.com/redirect/?utm_source=x&b=1&a=2',
    );
  });

  it('preserves a duplicate slash in the path rather than collapsing it', () => {
    // An S3 object key genuinely differs with and without the second slash. normalize-url
    // collapses this unconditionally, with no disabling option — this pins that the final URL
    // is built from the original text, never from normalize-url's own rewritten output.
    expect(normalizeLinkUrl('https://s3.example.com/bucket//key.txt')?.href).toBe(
      'https://s3.example.com/bucket//key.txt',
    );
  });

  it('preserves a trailing dot on the host rather than stripping it', () => {
    // A trailing dot changes DNS resolution (it forces an absolute lookup), so it is part of
    // the host the terminal printed, not noise. normalize-url strips it unconditionally.
    expect(normalizeLinkUrl('https://example.com./x')?.href).toBe('https://example.com./x');
  });

  it('preserves percent-encoding in the path rather than decoding it', () => {
    // normalize-url runs `decodeURI` on the path with no disabling option. `%7E` decoding to
    // `~` happens to be spec-equivalent (tilde is unreserved under RFC 3986), but this pins the
    // property generally: the path opened is the exact bytes the terminal printed, not a
    // percent-decoded version of them where a genuinely encoded character (`%2F`, `%25`) would
    // silently change meaning.
    expect(normalizeLinkUrl('https://example.com/a%7Eb')?.href).toBe('https://example.com/a%7Eb');
    expect(normalizeLinkUrl('https://example.com/a%25b')?.href).toBe('https://example.com/a%25b');
  });

  it('passes an already-qualified https URL through unchanged', () => {
    expect(normalizeLinkUrl('https://foo.com')?.href).toBe('https://foo.com/');
  });

  it('passes an already-qualified http URL through unchanged', () => {
    expect(normalizeLinkUrl('http://foo.com')?.href).toBe('http://foo.com/');
  });

  it('rejects a javascript: URI', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('rejects a javascript: URI even though it would re-parse as https after prepending', () => {
    // `javascript:/*` parses fine on the first, unprepended try (scheme `javascript:`), so a
    // correct implementation must reject it there and never give it a second look through the
    // https:// retry — even though `https://javascript/*` would itself parse to `https:`. This
    // pins that a scheme rejected on the first parse is never rescued by the fallback.
    expect(normalizeLinkUrl('javascript:/*')).toBeUndefined();
  });

  it('rejects a data: URI', () => {
    expect(normalizeLinkUrl('data:text/html,x')).toBeUndefined();
  });

  it('rejects a file: URI without retrying it as https', () => {
    // `https://file///etc/passwd` would itself parse successfully if `file:///etc/passwd` were
    // naively retried through the https:// fallback — this pins that a recognized non-http(s)
    // scheme from the first parse short-circuits before the fallback is ever attempted.
    expect(normalizeLinkUrl('file:///etc/passwd')).toBeUndefined();
  });

  it('rejects an ftp: URI without retrying it as https', () => {
    // Same shape as the file: case above: `https://ftp//host` would parse fine, so this pins
    // that ftp: is rejected on its own first parse rather than surviving via the retry.
    expect(normalizeLinkUrl('ftp://host')).toBeUndefined();
  });

  it.each(['https://', 'http://', 'ftp://'])(
    'rejects a malformed explicit scheme %s rather than rescuing it into an unintended host',
    (text) => {
      // A naive `https://` + text retry rescues `ftp://` into `https://ftp//`, opening a host
      // (`ftp`) that was never displayed and that no scheme-shaped input named. `https://` and
      // `http://` are rejected because they already have the `scheme://` authority shape and
      // `new URL` then fails on the empty host; `ftp://` is rejected because it never reads as
      // schemeless in the first place (its own scheme is recognized and left alone).
      expect(normalizeLinkUrl(text)).toBeUndefined();
    },
  );

  it.each(['file:/etc/passwd', 'https:/example.com'])(
    'rejects a single-slash form of a known scheme %s rather than rescuing it into an unintended host',
    (text) => {
      // `new URL` is lenient about a missing or single slash after `https:`/`http:`/`file:` and
      // would otherwise resolve these to a host the text never unambiguously named (`file:/etc/passwd`
      // resolves to host `file`, not a rejection) — normalize-url's own classifier has this same
      // blind spot, since it only recognizes these three schemes as "already qualified" when the
      // full `://` authority marker is present. Only the canonical `scheme://` form is trusted.
      expect(normalizeLinkUrl(text)).toBeUndefined();
    },
  );

  it('rejects text that spells the internal sentinel scheme rather than rescuing it', () => {
    // The classifier's own default-protocol sentinel is itself a syntactically valid custom
    // scheme, so text that already starts with it must not be misread as "normalize-url
    // prepended this" — it is `text`'s own (unsupported) scheme and gets rejected on that basis.
    expect(normalizeLinkUrl('garden-schemeless-marker://evil.example/x')).toBeUndefined();
    expect(normalizeLinkUrl('garden-schemeless-marker:80')).toBeUndefined();
  });

  it('rejects a URL carrying userinfo, even though its protocol is http(s)', () => {
    // OSC 8 already lets display text and target differ; userinfo compounds that by making the
    // *URL itself* show a familiar host before the real one. `https://trusted.example@evil.example`
    // is protocol-legal and would pass a bare http(s) allowlist while opening evil.example.
    expect(normalizeLinkUrl('https://trusted.example@evil.example')).toBeUndefined();
  });

  it('rejects a URL carrying only a username, with no password', () => {
    expect(normalizeLinkUrl('https://trusted.example@evil.example/path')).toBeUndefined();
  });

  it('rejects text that fails to parse even after assuming https', () => {
    expect(normalizeLinkUrl('not a url, has spaces')).toBeUndefined();
  });

  it('rejects the empty string', () => {
    expect(normalizeLinkUrl('')).toBeUndefined();
  });

  it('rejects text that fails to parse even after normalize-url assumes a scheme', () => {
    // An embedded NUL byte is invalid inside a URL, so normalization throws regardless of
    // whether normalize-url treats `text` as scheme-qualified or bare. This pins that a failed
    // normalization reports "no URL" rather than falling through to open the unvalidated text.
    expect(normalizeLinkUrl('java\x00script:alert(1)')).toBeUndefined();
  });
});

describe('openExternalLink', () => {
  // `openExternalLink` is the only function in this module that calls `window.open` — the OSC 8
  // `linkHandler` and the `WebLinksAddon` handler in registry.ts both hand it their matched text
  // directly, unnormalized, so it has to normalize internally rather than trust a caller to have
  // done so. These tests exercise it the way both call sites do: with raw text, not a pre-built
  // URL.
  it('normalizes text and opens the result in a new tab with explicit noopener and noreferrer', () => {
    const fakeWindow = {} as Window;
    const openWindow = vi.fn().mockReturnValue(fakeWindow);

    openExternalLink('www.here.com', openWindow);

    expect(openWindow).toHaveBeenCalledWith(
      'https://www.here.com/',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('never calls openWindow for text that fails normalization', () => {
    const openWindow = vi.fn();

    openExternalLink('javascript:alert(1)', openWindow);

    expect(openWindow).not.toHaveBeenCalled();
  });

  it('does not warn when openWindow returns null, since noopener/noreferrer always makes it return null', () => {
    // window.open has no WindowProxy to hand back whenever `noopener` or `noreferrer` is in the
    // features string, so it returns null on every successful open, not just a blocked one —
    // there is no way to tell the two apart from the return value, so this must not try to.
    const openWindow = vi.fn().mockReturnValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => openExternalLink('https://example.com/', openWindow)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});
