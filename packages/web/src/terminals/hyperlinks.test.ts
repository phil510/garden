import { describe, expect, it, vi } from 'vitest';
import { activateOscLink, normalizeLinkUrl, openExternalLink } from './hyperlinks.js';

describe('normalizeLinkUrl', () => {
  it('normalizes a schemeless bare host by assuming https', () => {
    expect(normalizeLinkUrl('www.here.com')?.href).toBe('https://www.here.com/');
  });

  it('normalizes a schemeless host with a path, not just the www. example', () => {
    expect(normalizeLinkUrl('example.com/path')?.href).toBe('https://example.com/path');
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

  it('rejects text that fails to parse even after assuming https', () => {
    expect(normalizeLinkUrl('not a url, has spaces')).toBeUndefined();
  });

  it('rejects the empty string', () => {
    expect(normalizeLinkUrl('')).toBeUndefined();
  });

  it('rejects text that fails the first parse and also fails the https:// retry, rather than opening the raw text', () => {
    // An embedded NUL byte is invalid inside a URL scheme, so `new URL(text)` throws. The
    // https:// retry has the NUL land in the host/port section instead, which also throws
    // (an invalid port). Both parses failing is the only way, in practice, for a `text` to
    // fail its first parse here: the https:// retry parses whatever comes after a literal
    // "https://" prefix, so when it succeeds at all its scheme is always `https:` by
    // construction — there is no reachable case where the retry succeeds with some other,
    // non-http(s) scheme. This test pins the other half of that guarantee: when the retry
    // itself can't produce a URL, normalization reports "no URL" rather than falling through
    // to open the unvalidated text.
    expect(normalizeLinkUrl('java\x00script:alert(1)')).toBeUndefined();
  });
});

describe('openExternalLink', () => {
  it('opens the url in a new tab with explicit noopener and noreferrer', () => {
    const fakeWindow = {} as Window;
    const openWindow = vi.fn().mockReturnValue(fakeWindow);

    openExternalLink('https://example.com/', openWindow);

    expect(openWindow).toHaveBeenCalledWith(
      'https://example.com/',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('warns instead of throwing when the browser blocks the popup', () => {
    const openWindow = vi.fn().mockReturnValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => openExternalLink('https://example.com/', openWindow)).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});

describe('activateOscLink', () => {
  it('opens a normalized url via the injected openWindow', () => {
    const fakeWindow = {} as Window;
    const openWindow = vi.fn().mockReturnValue(fakeWindow);

    activateOscLink('www.here.com', openWindow);

    expect(openWindow).toHaveBeenCalledWith(
      'https://www.here.com/',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('never calls openWindow for a link that fails normalization', () => {
    const openWindow = vi.fn();

    activateOscLink('javascript:alert(1)', openWindow);

    expect(openWindow).not.toHaveBeenCalled();
  });

  it('does not throw and logs a warning when openWindow returns null', () => {
    const openWindow = vi.fn().mockReturnValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => activateOscLink('www.here.com', openWindow)).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
