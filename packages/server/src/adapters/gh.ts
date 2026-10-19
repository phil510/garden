import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GhResult } from '../domain/github.js';

/** What `gh api --include` printed: the status line, the headers (names lower-cased) and the body. */
export interface GhResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const STATUS_LINE = /^HTTP\/\S+\s+(\d{3})/;

/** Splits `gh api --include` output; null when it does not start with an HTTP status line. A
 *  304 has no body, so a missing blank line is not an error. */
export function parseGhInclude(stdout: string): GhResponse | null {
  const separator = /\r?\n\r?\n/.exec(stdout);
  const head = separator === null ? stdout : stdout.slice(0, separator.index);
  const body = separator === null ? '' : stdout.slice(separator.index + separator[0].length);
  const [statusLine = '', ...headerLines] = head.split(/\r?\n/);
  const match = STATUS_LINE.exec(statusLine);
  if (match === null) return null;
  const headers: Record<string, string> = {};
  for (const headerLine of headerLines) {
    const colon = headerLine.indexOf(':');
    if (colon > 0)
      headers[headerLine.slice(0, colon).trim().toLowerCase()] = headerLine.slice(colon + 1).trim();
  }
  return { status: Number(match[1]), headers, body };
}

const SECONDARY_LIMIT_FALLBACK_MS = 60_000;

/** Epoch ms to resume at when the response is a rate limit, else null. A primary limit is a
 *  403/429 with no calls remaining and waits for the reset time; a secondary limit waits for
 *  `Retry-After`, or a minute when GitHub names the limit in the body without saying how long. */
export function rateLimitResumeAt(response: GhResponse, now: number): number | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const { headers } = response;
  const retryAfter = Number(headers['retry-after']);
  if (headers['retry-after'] !== undefined && Number.isFinite(retryAfter))
    return now + retryAfter * 1000;
  if (headers['x-ratelimit-remaining'] === '0') {
    const reset = Number(headers['x-ratelimit-reset']);
    if (Number.isFinite(reset)) return reset * 1000;
  }
  if (/secondary rate limit/i.test(response.body)) return now + SECONDARY_LIMIT_FALLBACK_MS;
  return null;
}

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
