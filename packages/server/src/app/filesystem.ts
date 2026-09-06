import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { FileResponse, TreeEntry, TreeResponse } from '@garden/shared';
import { isWithinRoot } from '../domain/paths.js';
import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';
import { SessionNotFoundError } from './sessions.js';

type FilesystemGit = Pick<GitPort, 'workTreePrefix' | 'status'>;

export interface FilesystemDeps {
  readonly projection: Projection;
  readonly git: FilesystemGit;
}

export interface TreeRequest {
  readonly sessionId: string;
  readonly path: string;
}

export interface FileRequest {
  readonly sessionId: string;
  readonly path: string;
}

/** Nothing on disk resolves to the requested path — the common case is simply "does not
 *  exist", but a symlink whose target is missing lands here too. */
export class PathNotFoundError extends Error {}

/** The resolved path exists but is outside the session's cwd — `..` traversal, an absolute
 *  path, or a symlink whose target escapes the root. */
export class PathOutsideRootError extends Error {}

/** `/fs/file` was asked to read a directory. */
export class NotAFileError extends Error {}

/** `/fs/tree` was asked to list a file. */
export class NotADirectoryError extends Error {}

/** Above this many bytes a file response is truncated rather than read whole. */
const FILE_SIZE_CAP_BYTES = 1024 * 1024;

function findSession(projection: Projection, id: string) {
  const session = projection.sessions().find((candidate) => candidate.id === id);
  if (session === undefined) throw new SessionNotFoundError(`no such session: ${id}`);
  return session;
}

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
    throw new PathOutsideRootError(`path escapes session root: ${requestedPath}`);
  return { absolute: resolved, relative: relative(cwd, joined) };
}

/** One `git status --porcelain` per refresh, re-keyed to the cwd-relative paths tree entries
 *  carry: git reports every path relative to the working tree root, so the prefix `cwd` sits
 *  at is what translates the two. A path outside `cwd` has no entry to decorate and is
 *  dropped; a directory entry's trailing slash is stripped so it matches the same key a tree
 *  entry would look up. A `cwd` outside any git repo decorates nothing rather than failing the
 *  whole listing. */
async function gitStatusMap(git: FilesystemGit, cwd: string): Promise<Map<string, string>> {
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

/** Lazy directory listing, scoped to the session's cwd. */
export async function readSessionTree(
  deps: FilesystemDeps,
  request: TreeRequest,
): Promise<TreeResponse> {
  const session = findSession(deps.projection, request.sessionId);
  const { absolute, relative: relativePath } = await resolveScoped(session.cwd, request.path);
  const info = await stat(absolute);
  if (!info.isDirectory()) throw new NotADirectoryError(`not a directory: ${request.path}`);
  const statuses = await gitStatusMap(deps.git, session.cwd);
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

/** File contents, scoped to the session's cwd, capped at `FILE_SIZE_CAP_BYTES`. `capBytes`
 *  is an override for tests, which would otherwise need a multi-megabyte fixture to
 *  exercise truncation. */
export async function readSessionFile(
  deps: FilesystemDeps,
  request: FileRequest,
  capBytes: number = FILE_SIZE_CAP_BYTES,
): Promise<FileResponse> {
  const session = findSession(deps.projection, request.sessionId);
  const { absolute, relative: relativePath } = await resolveScoped(session.cwd, request.path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new NotAFileError(`not a file: ${request.path}`);
  const { text, truncated } = await readCapped(absolute, info.size, capBytes);
  return { path: relativePath, text, truncated };
}
