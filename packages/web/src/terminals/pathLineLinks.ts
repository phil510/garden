export interface PathLineLink {
  path: string;
  /** Null for a bare path with no `:line` suffix: open the file without jumping anywhere. */
  line: number | null;
  /** Offset into the scanned text where the match starts, so a caller can map it back to a
   *  buffer column. */
  index: number;
  length: number;
}

const CANDIDATE = /[\w.\-/]+(?::(\d+))?/g;
const FILE_EXTENSION = /\.[a-z][a-z0-9]{0,4}$/;
const TOKEN_START_PREFIX = /[\s([{<"'`]/;

/**
 * Finds file links in a line of terminal output: `path:line` (a trailing `:column` is matched
 * but ignored) and bare paths. A `path:line` candidate whose path has neither a `.` nor a `/` is
 * dropped — otherwise `Error:42` or the port half of `host:8080` would read as a link. Any
 * candidate containing `//` is dropped: that is always a URL authority (`http://host`), never a
 * real file path.
 *
 * A bare path must also end in a short lowercase extension (`src/foo.ts`, `package.json`),
 * which keeps prose, identifiers, versions and slash-joined words from linking, and must start
 * a token, so the tail of a URL (`localhost:5173/src/App.tsx`, `?next=/x.html`) is never
 * claimed ahead of WebLinksAddon. `continuesPreviousRow` marks a soft-wrapped row, whose first
 * characters may be the middle of a URL. Dotted member access like `console.log` looks like a
 * filename and links; clicking a non-file is a silent no-op. Extensionless files (`Makefile`)
 * only link with a `:line`.
 */
export function findPathLineLinks(text: string, continuesPreviousRow = false): PathLineLink[] {
  const links: PathLineLink[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const [full, lineText] = match;
    if (lineText !== undefined) {
      const path = full.slice(0, full.lastIndexOf(':'));
      if (path.includes('//')) continue;
      if (!path.includes('.') && !path.includes('/')) continue;
      links.push({ path, line: Number(lineText), index: match.index, length: full.length });
      continue;
    }
    const path = full.replace(/\.+$/, '');
    if (path === '' || path.includes('//') || !FILE_EXTENSION.test(path)) continue;
    const before = match.index === 0 ? undefined : text[match.index - 1];
    const startsToken =
      before === undefined ? !continuesPreviousRow : TOKEN_START_PREFIX.test(before);
    if (!startsToken) continue;
    links.push({ path, line: null, index: match.index, length: path.length });
  }
  return links;
}
