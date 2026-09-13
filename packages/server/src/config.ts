import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The permission mode garden passes to a spawned or resumed Claude Code process.
 *  `'bypassPermissions'` skips its permission prompts; `'default'` passes no flag. */
export type PermissionMode = 'default' | 'bypassPermissions';

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'default' || value === 'bypassPermissions';
}

/** What `~/.garden/config.json` may contain. Omitted keys fall back to the defaults below. */
export interface ConfigFile {
  readonly port: number;
  readonly roots: readonly string[];
  readonly permissionMode: PermissionMode;
}
export interface Config {
  readonly port: number;
  readonly host: string;
  readonly roots: readonly string[];
  readonly appDir: string;
  readonly tmuxSocket: string;
  readonly transcriptsDir: string;
  readonly claudeCommand: readonly string[];
  readonly permissionMode: PermissionMode;
}

export const DEFAULT_CONFIG_FILE: ConfigFile = {
  port: 4310,
  roots: ['~/Desktop/Extend'],
  permissionMode: 'default',
};

/** Loopback-only, and deliberately not configurable: garden is not a remote-access tool. */
const HOST = '127.0.0.1';

/** Every garden tmux session lives on this socket, so `tmux -L garden` reaches them
 *  and nothing garden does can disturb a user's own tmux server. */
export const TMUX_SOCKET = 'garden';

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

/** An empty value is treated as unset, matching `envPort`'s "no opinion" convention. */
function envString(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key];
  return raw === undefined || raw === '' ? undefined : raw;
}

function envClaudeCommand(env: Record<string, string | undefined>): readonly string[] | undefined {
  const raw = envString(env, 'GARDEN_CLAUDE_COMMAND');
  if (raw === undefined) return undefined;
  const parts = raw.split(/\s+/).filter(Boolean);
  // A value of only whitespace names no command, so it falls back rather than
  // spawning an argv whose first element is the session flag.
  return parts.length === 0 ? undefined : parts;
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
  const { port, roots, permissionMode } = raw as {
    port?: unknown;
    roots?: unknown;
    permissionMode?: unknown;
  };
  if (port !== undefined && !isPort(port)) {
    throw new Error(`${source}: "port" must be an integer between 1 and 65535`);
  }
  if (
    roots !== undefined &&
    (!Array.isArray(roots) || (roots as unknown[]).some((r) => typeof r !== 'string'))
  ) {
    throw new Error(`${source}: "roots" must be an array of strings`);
  }
  if (permissionMode !== undefined && !isPermissionMode(permissionMode)) {
    throw new Error(`${source}: "permissionMode" must be "default" or "bypassPermissions"`);
  }
  return {
    port: port ?? DEFAULT_CONFIG_FILE.port,
    roots: (roots as readonly string[] | undefined) ?? DEFAULT_CONFIG_FILE.roots,
    permissionMode: permissionMode ?? DEFAULT_CONFIG_FILE.permissionMode,
  };
}

export function appDirPath(home: string, env: Record<string, string | undefined>): string {
  return envString(env, 'GARDEN_APP_DIR') ?? join(home, '.garden');
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
    appDir: appDirPath(home, env),
    tmuxSocket: envString(env, 'GARDEN_TMUX_SOCKET') ?? TMUX_SOCKET,
    transcriptsDir: envString(env, 'GARDEN_TRANSCRIPTS_DIR') ?? join(home, '.claude', 'projects'),
    claudeCommand: envClaudeCommand(env) ?? ['claude'],
    permissionMode: file.permissionMode ?? DEFAULT_CONFIG_FILE.permissionMode,
  };
}

/** Creates the app directory and writes `config.json` on first run, then reads it back. */
export function ensureConfigFile(home: string): ConfigFile {
  const dir = appDirPath(home, process.env);
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
