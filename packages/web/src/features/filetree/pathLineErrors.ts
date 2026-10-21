import { ApiError } from '../../api/client';
import { resolveAgainst } from './projectPaths';

/** The toast for a clicked path the server couldn't open: a 404 is a missing file, a 400 carries
 *  the server's reason (path escapes the root, not a file). Null for any other failure, which
 *  the caller still handles itself. */
export function openFailureMessage(error: unknown, abs: string): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 404) return `File not found: ${abs}`;
  if (error.status === 400) return `Can't open ${abs}: ${error.message}`;
  return null;
}

/** The path shown in a failure toast: resolved when the session's cwd is known, else as clicked. */
export function displayPath(cwd: string | undefined, clicked: string): string {
  return cwd === undefined ? clicked : resolveAgainst(cwd, clicked);
}

export function noSessionDirectoryMessage(clicked: string): string {
  return `Can't open ${clicked}: session directory unknown`;
}

export function outsideProjectsMessage(abs: string): string {
  return `${abs} isn't in any known project`;
}
