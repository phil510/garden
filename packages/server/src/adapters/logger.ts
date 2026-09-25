import { appendFileSync } from 'node:fs';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function line(level: string, message: string): string {
  return `${new Date().toISOString()} ${level} ${message}`;
}

type Sink = (level: string, formatted: string) => void;

function consoleSink(level: string, formatted: string): void {
  if (level === 'info') {
    console.log(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.error(formatted);
  }
}

/** Appends to `path`, dropping the line on a write failure rather than falling back to the
 *  console sink — a fallback would need its own crash-safety story, and a dropped log line
 *  is already an accepted cost the console-pipe bug itself demonstrates. */
function fileSink(path: string): Sink {
  return (_level, formatted) => {
    try {
      appendFileSync(path, formatted + '\n');
    } catch {
      // dropped
    }
  };
}

/** Info goes to stdout; warn and error go to stderr, until `redirectToFile` is called. */
export function createLogger(): Logger & { redirectToFile(path: string): void } {
  let sink: Sink = consoleSink;
  return {
    info: (message) => {
      sink('info', line('info', message));
    },
    warn: (message) => {
      sink('warn', line('warn', message));
    },
    error: (message) => {
      sink('error', line('error', message));
    },
    redirectToFile: (path) => {
      sink = fileSink(path);
    },
  };
}

/** Attaches a no-op 'error' listener to process.stderr once, so a write that fails
 *  after the reading end has closed (e.g. the CLI that spawned this detached server
 *  has exited) surfaces as a dropped write instead of an uncaught exception.
 *  Server-only — call once from main()'s composition root. Do not call this from
 *  `config.ts`'s `ensureConfigFile` default or from anything on the `cli/` side:
 *  those run as the user's own foreground process, and `ensureConfigFile(home)` with
 *  no logger argument constructs a fresh `createLogger()` on every `garden` CLI
 *  invocation (`cli/start.ts`, `cli/http.ts`, `cli/stop.ts` and their unit tests all
 *  hit that default) — attaching the guard inside `createLogger()` itself would
 *  reach every one of those and silently change their stderr behaviour, which is out
 *  of the brief's scope, and would stack a listener per `createLogger()` call across
 *  a test run. */
export function guardStderr(): void {
  process.stderr.on('error', () => {});
}
