export interface PathLineLink {
  path: string;
  line: number;
  /** Offset into the scanned text where the match starts, so a caller can map it back to a
   *  buffer column. */
  index: number;
  length: number;
}

const CANDIDATE = /[\w.\-/]+:(\d+)/g;

/**
 * Finds `path:line` occurrences in a line of terminal output. A trailing `:column` is matched
 * but ignored, since the spec names only `path:line`. A candidate whose path has neither a `.`
 * nor a `/` is dropped — otherwise `Error:42` or the port half of `host:8080` would read as a
 * link. A candidate containing `//` is dropped too: that is always a URL authority (`http://host`),
 * never a real file path, and would otherwise survive the first filter on the strength of its
 * slash alone.
 */
export function findPathLineLinks(text: string): PathLineLink[] {
  const links: PathLineLink[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const full = match[0];
    const path = full.slice(0, full.lastIndexOf(':'));
    if (path.includes('//')) continue;
    if (!path.includes('.') && !path.includes('/')) continue;
    links.push({ path, line: Number(match[1]), index: match.index, length: full.length });
  }
  return links;
}
