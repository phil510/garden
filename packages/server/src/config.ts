import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** What `~/.garden/config.json` may contain. Omitted keys fall back to the defaults below. */
export interface ConfigFile {
  readonly port: number;
  readonly roots: readonly string[];
}
export interface Config {
  readonly port: number;
  readonly host: string;
  readonly roots: readonly string[];
  readonly appDir: string;
}

export const DEFAULT_CONFIG_FILE: ConfigFile = { port: 4310, roots: ['~/Desktop/Extend'] };

/** Loopback-only, and deliberately not configurable: garden is not a remote-access tool. */
const HOST = '127.0.0.1';

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function envPort(env: Record<string, string | undefined>): number | undefined {
  const raw = env.GARDEN_PORT;
  // An empty value is treated as unset: `GARDEN_PORT=` means "no opinion", not "port zero".
  if (raw === undefined || raw === '') return undefined;
  const port = Number(raw);
  if (!isPort(port)) {
    throw new Error(`GARDEN_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  return path.startsWith('~/') ? join(home, path.slice(2)) : path;
}

export function parseConfigFile(text: string, source: string): ConfigFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${source} is not valid JSON: ${(cause as Error).message}`, { cause });
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  const { port, roots } = raw as { port?: unknown; roots?: unknown };
  if (port !== undefined && !isPort(port)) {
    throw new Error(`${source}: "port" must be an integer between 1 and 65535`);
  }
  if (
    roots !== undefined &&
    (!Array.isArray(roots) || (roots as unknown[]).some((r) => typeof r !== 'string'))
  ) {
    throw new Error(`${source}: "roots" must be an array of strings`);
  }
  return {
    port: port ?? DEFAULT_CONFIG_FILE.port,
    roots: (roots as readonly string[] | undefined) ?? DEFAULT_CONFIG_FILE.roots,
  };
}

export function appDirPath(home: string = homedir()): string {
  return join(home, '.garden');
}

/** Resolves the effective config. `GARDEN_PORT` outranks the file; roots come back absolute. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  file: ConfigFile = DEFAULT_CONFIG_FILE,
  home: string = homedir(),
): Config {
  return {
    port: envPort(env) ?? file.port,
    host: HOST,
    roots: file.roots.map((root) => expandHome(root, home)),
    appDir: appDirPath(home),
  };
}

/** Creates the app directory and writes `config.json` on first run, then reads it back. */
export function ensureConfigFile(home: string): ConfigFile {
  const dir = appDirPath(home);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'config.json');
  try {
    return parseConfigFile(readFileSync(path, 'utf8'), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG_FILE, null, 2)}\n`, 'utf8');
    return DEFAULT_CONFIG_FILE;
  }
}
