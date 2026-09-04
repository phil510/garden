export interface Config {
  readonly port: number;
  readonly host: string;
}

const DEFAULT_PORT = 4310;

/**
 * Loopback-only, and deliberately not configurable: garden is not a multi-user
 * or remote-access tool.
 */
const HOST = '127.0.0.1';

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = env.GARDEN_PORT;
  // An empty value is treated as unset: `GARDEN_PORT=` in a shell or an env
  // file means "no opinion", not "port zero".
  if (raw === undefined || raw === '') return { port: DEFAULT_PORT, host: HOST };

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`GARDEN_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return { port, host: HOST };
}
