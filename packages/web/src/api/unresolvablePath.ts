import { ApiError } from './client.js';

/** Whether a file load failed because the server can't resolve the path: it doesn't exist (404)
 *  or lies outside the root or isn't a file (400). A clicked `path:line` that fails this way is
 *  a false-positive match, so the click does nothing; other failures are worth showing. */
export function isUnresolvablePath(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}
