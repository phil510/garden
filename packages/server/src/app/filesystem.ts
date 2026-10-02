// One-shot node:fs reads are allowed in app/; see the dependency rules in docs/architecture.md.
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import type { FileResponse, TreeEntry, TreeResponse } from '@garden/shared';
import { isWithinRoot } from '../domain/paths.js';
import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';
import type { RepoCatalog } from './repoCatalog.js';
import { findSession } from './sessions.js';

type FilesystemGit = Pick<GitPort, 'workTreePrefix' | 'status'>;

export interface FilesystemDeps {
  readonly projection: Projection;
  readonly git: FilesystemGit;
  readonly repos: Pick<RepoCatalog, 'resolveRoot'>;
}

/** What a request is scoped to: a live session's cwd, or a project root from the repo list. */
export type ScopeRequest = { readonly sessionId: string } | { readonly root: string };

/** `refresh` identifies one refresh of a project: every `readTree` carrying the same token for
 *  the same directory shares one `git status`, and a new token always runs a fresh one. A
 *  request without a token never shares. */
export type TreeRequest = ScopeRequest & { readonly path: string; readonly refresh?: string };

export type FileRequest = ScopeRequest & { readonly path: string };

/** Nothing on disk resolves to the requested path — the common case is simply "does not
 *  exist", but a symlink whose target is missing lands here too. */
export class PathNotFoundError extends Error {}

/** The resolved path exists but is outside the root — `..` traversal, an absolute
 *  path, or a symlink whose target escapes the root. */
export class PathOutsideRootError extends Error {}

/** `/fs/file` was asked to read a directory. */
export class NotAFileError extends Error {}

/** `/fs/tree` was asked to list a file. */
export class NotADirectoryError extends Error {}

/** Above this many bytes a file response is truncated rather than read whole. */
const FILE_SIZE_CAP_BYTES = 1024 * 1024;

/** Above this many bytes an image is reported too large to preview rather than read whole —
 *  separate from `FILE_SIZE_CAP_BYTES` because a truncated image has no usable partial
 *  render, so there is no "open anyway" the way there is for text. */
const IMAGE_SIZE_CAP_BYTES = 10 * 1024 * 1024;

/** Extensions the viewer renders as `<img>`, lowercased and without the leading dot, mapped
 *  to the mime type the browser needs to decode the base64 payload. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * Resolves `requestedPath` against `cwd` and proves it never escapes that root. `join`
 * neutralises an absolute `requestedPath` into a nested segment rather than letting it
 * override the root the way `path.resolve` would; `realpath` then resolves every symlink
 * on both sides before `isWithinRoot` makes the actual security decision, since a lexical
 * `..` walk or an unresolved symlink target proves nothing about where a path really points.
 *
 * The echoed `relative` path is the lexically normalised request, not `resolved`'s own
 * path — a request through a symlink that stays inside the root should echo back the name
 * the caller asked for, not the real file it happens to point at.
 */
async function resolveScoped(
  cwd: string,
  requestedPath: string,
): Promise<{ readonly absolute: string; readonly relative: string }> {
  const joined = join(cwd, requestedPath);
  let root: string;
  let resolved: string;
  try {
    root = await realpath(cwd);
    resolved = await realpath(joined);
  } catch (error) {
    throw new PathNotFoundError(`no such path: ${requestedPath}`, { cause: error });
  }
  if (!isWithinRoot(root, resolved))
    throw new PathOutsideRootError(`path escapes root: ${requestedPath}`);
  return { absolute: resolved, relative: relative(cwd, joined) };
}

async function scopeDir(deps: FilesystemDeps, request: ScopeRequest): Promise<string> {
  if ('root' in request) return deps.repos.resolveRoot(request.root);
  return findSession(deps.projection, request.sessionId).cwd;
}

/** One `git status --porcelain` per `request.refresh`, re-keyed to the cwd-relative paths tree entries
 *  carry: git reports every path relative to the working tree root, so the prefix `cwd` sits
 *  at is what translates the two. A path outside `cwd` has no entry to decorate and is
 *  dropped; a directory entry's trailing slash is stripped so it matches the same key a tree
 *  entry would look up. A `cwd` outside any git repo decorates nothing rather than failing the
 *  whole listing. */
async function runGitStatusMap(git: FilesystemGit, cwd: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const prefix = await git.workTreePrefix(cwd).catch(() => undefined);
  if (prefix === undefined) return map;
  const entries = await git.status(cwd).catch(() => []);
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const path = entry.path.slice(prefix.length);
    map.set(path.endsWith('/') ? path.slice(0, -1) : path, entry.status);
  }
  return map;
}

interface TokenedRun {
  readonly token: string;
  readonly map: Promise<Map<string, string>>;
}

/** The latest tokened run per directory, per git port. Only the latest is kept, so the memo is
 *  bounded by the number of directories, and a new token replaces the run it supersedes without
 *  waiting on it — a backstop refetch is never served a status that began before its token. */
const latestRuns = new WeakMap<FilesystemGit, Map<string, TokenedRun>>();

function gitStatusMap(
  git: FilesystemGit,
  cwd: string,
  refresh: string | undefined,
): Promise<Map<string, string>> {
  if (refresh === undefined) return runGitStatusMap(git, cwd);
  let runs = latestRuns.get(git);
  if (runs === undefined) {
    runs = new Map();
    latestRuns.set(git, runs);
  }
  const latest = runs.get(cwd);
  if (latest?.token === refresh) return latest.map;
  const map = runGitStatusMap(git, cwd);
  runs.set(cwd, { token: refresh, map });
  return map;
}

/** A dirent that is neither a plain file nor a plain directory is a symlink (or something
 *  more exotic); it is classified by following it, never by listing into it. */
async function entryKind(
  absolutePath: string,
  dirent: { isDirectory(): boolean; isFile(): boolean },
) {
  if (dirent.isDirectory()) return 'dir' as const;
  if (dirent.isFile()) return 'file' as const;
  const info = await stat(absolutePath).catch(() => undefined);
  return info?.isDirectory() ? ('dir' as const) : ('file' as const);
}

async function listEntries(
  absoluteDir: string,
  relativeDir: string,
  statuses: Map<string, string>,
): Promise<TreeEntry[]> {
  const dirents = await readdir(absoluteDir, { withFileTypes: true });
  const entries: TreeEntry[] = [];
  for (const dirent of dirents) {
    const entryPath = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;
    const kind = await entryKind(join(absoluteDir, dirent.name), dirent);
    entries.push({
      name: dirent.name,
      path: entryPath,
      kind,
      gitStatus: statuses.get(entryPath) ?? null,
    });
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  );
  return entries;
}

/** Lazy directory listing, scoped to a session's cwd or a listed root. */
export async function readTree(deps: FilesystemDeps, request: TreeRequest): Promise<TreeResponse> {
  const dir = await scopeDir(deps, request);
  const { absolute, relative: relativePath } = await resolveScoped(dir, request.path);
  const info = await stat(absolute);
  if (!info.isDirectory()) throw new NotADirectoryError(`not a directory: ${request.path}`);
  const statuses = await gitStatusMap(deps.git, dir, request.refresh);
  return { path: relativePath, entries: await listEntries(absolute, relativePath, statuses) };
}

/** Above `FILE_SIZE_CAP_BYTES`, only the leading bytes are read — this is a display cap
 *  for the viewer, not a validity guarantee, so a multi-byte character split at the cut
 *  point may render as a stray replacement character at the very end. */
async function readCapped(
  path: string,
  size: number,
  capBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const truncated = size > capBytes;
  const length = truncated ? capBytes : size;
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return { text: buffer.toString('utf8'), truncated };
  } finally {
    await handle.close();
  }
}

/** Reads at most `capBytes` bytes of an image by bounding the read call itself, the same
 *  technique `readCapped` uses for text: attempting to read one byte past the cap proves
 *  whether the file exceeds it at read time, immune to the file growing after the call
 *  starts — unlike a `stat()` taken beforehand, which a still-growing file (e.g. a live
 *  session writing a screenshot into the same cwd) can invalidate before the read runs. */
async function readCappedBinary(
  path: string,
  capBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const handle = await open(path, 'r');
  try {
    const probe = Buffer.alloc(capBytes + 1);
    const { bytesRead } = await handle.read(probe, 0, capBytes + 1, 0);
    if (bytesRead > capBytes) return { buffer: Buffer.alloc(0), truncated: true };
    return { buffer: probe.subarray(0, bytesRead), truncated: false };
  } finally {
    await handle.close();
  }
}

/** A NUL byte never appears in valid UTF-8 text, and always round-trips faithfully through
 *  UTF-8 decoding (it's never a continuation or lead byte of a multi-byte sequence) — so
 *  sniffing for it in the already-decoded text is equivalent to sniffing the raw bytes. This
 *  is the same heuristic git's own binary detection uses, including its blind spot: a
 *  UTF-16-encoded text file (NUL bytes between every ASCII-range character) reads as binary. */
function looksBinary(text: string): boolean {
  return text.includes('\0');
}

/** File contents, scoped to a session's cwd or a listed root. Extension decides the branch: a recognised
 *  image extension is read whole (or reported too large) and returned as base64; everything
 *  else is read through the existing text cap and, only then, sniffed for binary content —
 *  `capBytes` and `imageCapBytes` are overrides for tests, which would otherwise need
 *  multi-megabyte fixtures to exercise truncation. */
export async function readFile(
  deps: FilesystemDeps,
  request: FileRequest,
  capBytes: number = FILE_SIZE_CAP_BYTES,
  imageCapBytes: number = IMAGE_SIZE_CAP_BYTES,
): Promise<FileResponse> {
  const dir = await scopeDir(deps, request);
  const { absolute, relative: relativePath } = await resolveScoped(dir, request.path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new NotAFileError(`not a file: ${request.path}`);

  const extension = extname(absolute).slice(1).toLowerCase();
  const mimeType = IMAGE_EXTENSIONS[extension];
  if (mimeType !== undefined) {
    const { buffer, truncated } = await readCappedBinary(absolute, imageCapBytes);
    if (truncated) return { path: relativePath, kind: 'image', mimeType, truncated: true };
    return {
      path: relativePath,
      kind: 'image',
      mimeType,
      truncated: false,
      data: buffer.toString('base64'),
    };
  }

  const { text, truncated } = await readCapped(absolute, info.size, capBytes);
  if (looksBinary(text)) return { path: relativePath, kind: 'binary' };
  return { path: relativePath, kind: 'text', text, truncated };
}
