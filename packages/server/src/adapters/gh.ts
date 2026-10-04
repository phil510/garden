import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGhInclude, rateLimitResumeAt } from '../domain/github.js';
import type { GhResult } from '../domain/github.js';

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 30_000;
/** Responses are JSON pages of at most 100 items; this only has to clear the largest of those. */
const GH_MAX_BUFFER = 32 * 1024 * 1024;
/** `gh`'s exit status when it has no credentials. */
const EXIT_NOT_LOGGED_IN = 4;

interface GhExit {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: unknown;
}

/** `gh api` exits 1 for any HTTP status of 300 or more, and the response is on stdout either
 *  way, so a failed exit is data here, not an error. Only "could not run `gh`" throws. */
async function run(binary: string, args: readonly string[]): Promise<GhExit> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, [...args], {
      timeout: GH_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (failure.code === 'ENOENT') throw failure;
    if (typeof failure.code !== 'number')
      throw new Error(`gh ${args.join(' ')} failed: ${failure.code ?? failure.message}`, {
        cause: error,
      });
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code };
  }
}

/** One GET of `path` (relative to the API root) through the `gh` binary at `binary`. */
export async function ghGet(
  binary: string,
  path: string,
  etag: string | null,
  now: number,
): Promise<GhResult> {
  const args = [
    'api',
    '--include',
    ...(etag === null ? [] : ['-H', `If-None-Match: ${etag}`]),
    path,
  ];
  let exit: GhExit;
  try {
    exit = await run(binary, args);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { kind: 'unavailable', reason: 'missing' };
    throw error;
  }
  const response = parseGhInclude(exit.stdout);
  if (response === null) {
    if (exit.code === EXIT_NOT_LOGGED_IN) return { kind: 'unavailable', reason: 'logged-out' };
    throw new Error(`gh ${args.join(' ')} printed no HTTP response: ${exit.stderr.trim()}`);
  }
  const resumeAt = rateLimitResumeAt(response, now);
  if (resumeAt !== null) return { kind: 'rate-limited', resumeAt };
  if (response.status === 304) return { kind: 'not-modified' };
  if (response.status === 401) return { kind: 'unavailable', reason: 'logged-out' };
  if (response.status === 403 || response.status === 404)
    return { kind: 'inaccessible', status: response.status };
  if (response.status < 200 || response.status >= 300)
    throw new Error(`gh ${args.join(' ')} answered HTTP ${String(response.status)}`);
  return { kind: 'ok', etag: response.headers['etag'] ?? null, body: JSON.parse(response.body) };
}
