import type { FastifyBaseLogger } from 'fastify';
import type { Logger } from '../app/ports.js';

/** Folds a pino-style call — `(msg)`, `(err)` or `(obj, msg?)` — into the one string a
 *  `Logger` takes. Errors are read by stack because their fields aren't enumerable. */
function fold(first: unknown, second?: unknown): string {
  const describe = (err: unknown): string =>
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  if (typeof first === 'string') return first;
  if (first instanceof Error) return describe(first);
  const { msg, err } = (first ?? {}) as { msg?: unknown; err?: unknown };
  const parts = [typeof second === 'string' ? second : msg, err === undefined ? '' : describe(err)];
  return parts.filter((part) => typeof part === 'string' && part !== '').join(' ');
}

/** Presents the injected `Logger` as Fastify's logger, so `request.log` and Fastify's own
 *  warnings reach the same sink. Only `warn` and above are kept. */
export function fastifyLogger(logger: Logger): FastifyBaseLogger {
  const nothing = (): void => undefined;
  const adapter: FastifyBaseLogger = {
    level: 'warn',
    silent: nothing,
    trace: nothing,
    debug: nothing,
    info: nothing,
    warn: (first: unknown, second?: unknown) => logger.warn(fold(first, second)),
    error: (first: unknown, second?: unknown) => logger.error(fold(first, second)),
    fatal: (first: unknown, second?: unknown) => logger.error(fold(first, second)),
    child: () => adapter,
  };
  return adapter;
}
