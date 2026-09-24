export interface MarkdownLink {
  url: string;
  /** Offset into the scanned text where the link's **visible label** starts — inside the
   *  brackets, not the brackets themselves — so a caller can map exactly that span to a buffer
   *  column range. The clickable region is the label, matching how a rendered markdown link
   *  works. */
  index: number;
  length: number;
}

// No space allowed between `]` and `(`, which rejects `[text] (url)`. The label excludes `[`/`]`,
// which rejects unbalanced/nested brackets and a bare `[text]` with no following `(url)`. The url
// excludes whitespace and parens — a known, accepted limitation: a url containing a literal `(` or
// `)` (some Wikipedia links, for example) won't match. Not special-cased; scheme/url validation
// itself stays downstream in hyperlinks.ts.
const CANDIDATE = /\[([^[\]]+)\]\(([^\s()]+)\)/g;

/** Finds `[text](url)` markdown-style link spans in a line of terminal output. */
export function findMarkdownLinks(text: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const [, label, url] = match;
    // Both groups are required by CANDIDATE, so a match always has them — this guard is only to
    // satisfy noUncheckedIndexedAccess, not a real runtime possibility.
    if (label === undefined || url === undefined) continue;
    links.push({ url, index: match.index + 1, length: label.length });
  }
  return links;
}
