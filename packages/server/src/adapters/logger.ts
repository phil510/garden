export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function line(level: string, message: string): string {
  return `${new Date().toISOString()} ${level} ${message}`;
}

/** Info goes to stdout; warn and error go to stderr. */
export function createLogger(): Logger {
  return {
    info: (message) => console.log(line('info', message)),
    warn: (message) => console.warn(line('warn', message)),
    error: (message) => console.error(line('error', message)),
  };
}
