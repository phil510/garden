import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger, type Logger } from './adapters/logger.js';

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
  readonly deadSessionCap: number;
  readonly terminalFontSize: number;
  readonly claudeCommand: string;
  readonly ignoreAuthors: readonly string[];
  readonly quietWindowMinutes: number;
  readonly pollIntervalMinutes: number;
}
export interface Config {
  readonly port: number;
  readonly host: string;
  readonly roots: readonly string[];
  readonly appDir: string;
  readonly tmuxSocket: string;
  readonly transcriptsDir: string;
  readonly claudeSessionsDir: string;
  readonly permissionMode: PermissionMode;
  readonly deadSessionCap: number;
  readonly terminalFontSize: number;
}

export const DEFAULT_CONFIG_FILE: ConfigFile = {
  port: 4310,
  roots: ['~/Desktop/Extend'],
  permissionMode: 'default',
  deadSessionCap: 10,
  terminalFontSize: 13,
  claudeCommand: 'claude',
  ignoreAuthors: [],
  quietWindowMinutes: 3,
  pollIntervalMinutes: 5,
};

/** Loopback-only, and deliberately not configurable: garden is not a remote-access tool. */
const HOST = '127.0.0.1';

/** Every garden tmux session lives on this socket, so `tmux -L garden` reaches them
 *  and nothing garden does can disturb a user's own tmux server. */
export const TMUX_SOCKET = 'garden';

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isDeadSessionCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000;
}

function isTerminalFontSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 6 && value <= 72;
}

export function isClaudeCommand(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isIgnoreAuthors(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((author) => typeof author === 'string');
}

export function isQuietWindowMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isPollIntervalMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Splits a raw command string on whitespace into argv, collapsing to `undefined` when
 *  nothing survives — a value of only whitespace names no command. Shared by the env var
 *  and the config-file field, which resolve to the same argv shape but validate differently:
 *  the env var falls back silently (see `envClaudeCommand`), the file field rejects loudly
 *  (see `isClaudeCommand`). */
function splitCommand(raw: string): readonly string[] | undefined {
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length === 0 ? undefined : parts;
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
  // A value of only whitespace names no command, so it falls back rather than
  // spawning an argv whose first element is the session flag.
  return splitCommand(raw);
}

/** The `claudeCommand` precedence: `GARDEN_CLAUDE_COMMAND` outranks the file, which outranks
 *  the single-element default. `main.ts`'s `readClaudeCommand` binding re-applies this against
 *  a fresh `configPort.read()` on every session spawn so a saved change takes effect without a
 *  restart. A command carrying `--bare` skips hooks, so its sessions send garden no status
 *  updates. */
export function resolveClaudeCommand(
  env: Record<string, string | undefined>,
  file: Pick<ConfigFile, 'claudeCommand'>,
): readonly string[] {
  return envClaudeCommand(env) ?? splitCommand(file.claudeCommand) ?? ['claude'];
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
  const {
    port,
    roots,
    permissionMode,
    deadSessionCap,
    terminalFontSize,
    claudeCommand,
    ignoreAuthors,
    quietWindowMinutes,
    pollIntervalMinutes,
  } = raw as {
    port?: unknown;
    roots?: unknown;
    permissionMode?: unknown;
    deadSessionCap?: unknown;
    terminalFontSize?: unknown;
    claudeCommand?: unknown;
    ignoreAuthors?: unknown;
    quietWindowMinutes?: unknown;
    pollIntervalMinutes?: unknown;
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
  if (deadSessionCap !== undefined && !isDeadSessionCap(deadSessionCap)) {
    throw new Error(`${source}: "deadSessionCap" must be an integer between 1 and 1000`);
  }
  if (terminalFontSize !== undefined && !isTerminalFontSize(terminalFontSize)) {
    throw new Error(`${source}: "terminalFontSize" must be an integer between 6 and 72`);
  }
  if (claudeCommand !== undefined && !isClaudeCommand(claudeCommand)) {
    throw new Error(`${source}: "claudeCommand" must be a non-empty string`);
  }
  if (ignoreAuthors !== undefined && !isIgnoreAuthors(ignoreAuthors)) {
    throw new Error(`${source}: "ignoreAuthors" must be an array of strings`);
  }
  if (quietWindowMinutes !== undefined && !isQuietWindowMinutes(quietWindowMinutes)) {
    throw new Error(`${source}: "quietWindowMinutes" must be a non-negative integer`);
  }
  if (pollIntervalMinutes !== undefined && !isPollIntervalMinutes(pollIntervalMinutes)) {
    throw new Error(`${source}: "pollIntervalMinutes" must be a positive integer`);
  }
  return {
    port: port ?? DEFAULT_CONFIG_FILE.port,
    roots: (roots as readonly string[] | undefined) ?? DEFAULT_CONFIG_FILE.roots,
    permissionMode: permissionMode ?? DEFAULT_CONFIG_FILE.permissionMode,
    deadSessionCap: deadSessionCap ?? DEFAULT_CONFIG_FILE.deadSessionCap,
    terminalFontSize: terminalFontSize ?? DEFAULT_CONFIG_FILE.terminalFontSize,
    claudeCommand: claudeCommand ?? DEFAULT_CONFIG_FILE.claudeCommand,
    ignoreAuthors: ignoreAuthors ?? DEFAULT_CONFIG_FILE.ignoreAuthors,
    quietWindowMinutes: quietWindowMinutes ?? DEFAULT_CONFIG_FILE.quietWindowMinutes,
    pollIntervalMinutes: pollIntervalMinutes ?? DEFAULT_CONFIG_FILE.pollIntervalMinutes,
  };
}

export function appDirPath(home: string, env: Record<string, string | undefined>): string {
  return envString(env, 'GARDEN_APP_DIR') ?? join(home, '.garden');
}

export function configFilePath(appDir: string): string {
  return join(appDir, 'config.json');
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
    claudeSessionsDir: join(home, '.claude', 'sessions'),
    permissionMode: file.permissionMode,
    deadSessionCap: file.deadSessionCap,
    terminalFontSize: file.terminalFontSize,
  };
}

/**
 * Creates the app directory and writes `config.json` on first run, then reads it back.
 * A missing file is created from the defaults, same as always. Any other read failure —
 * malformed JSON, or a field failing `parseConfigFile`'s validation — logs a warning and
 * falls back to `DEFAULT_CONFIG_FILE` without touching the file on disk, so the user's file
 * survives for them to fix rather than being silently overwritten.
 */
export function ensureConfigFile(
  home: string,
  logger: Pick<Logger, 'warn'> = createLogger(),
): ConfigFile {
  const dir = appDirPath(home, process.env);
  mkdirSync(dir, { recursive: true });
  const path = configFilePath(dir);
  try {
    return parseConfigFile(readFileSync(path, 'utf8'), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // parseConfigFile's thrown message already names `path` (it's the `source` argument), so
      // this doesn't repeat it — the message alone carries which file and why.
      logger.warn(`config unusable, falling back to defaults: ${(error as Error).message}`);
      return DEFAULT_CONFIG_FILE;
    }
    writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG_FILE, null, 2)}\n`, 'utf8');
    return DEFAULT_CONFIG_FILE;
  }
}

/** Writes `contents` to `path` via a temp-file-then-rename, matching `writeOverlayState`'s
 *  atomic pattern in `adapters/store.ts` — a concurrent reader sees either the previous file
 *  or the new one, never a half-written one. Takes a plain object rather than `ConfigFile`:
 *  the caller may be persisting a raw parsed file merged with a patch, which need not carry
 *  every `ConfigFile` field. */
export function writeConfigFile(path: string, contents: Record<string, unknown>): void {
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, path);
}

/** Live, tolerant read of `config.json` at `path` for display purposes: a missing or
 *  unusable file resolves to `DEFAULT_CONFIG_FILE`, same as `ensureConfigFile`, but without
 *  writing anything or logging — a `GET /settings` re-read isn't the boot-time warning path.
 *
 *  A file that parses as JSON but fails `parseConfigFile`'s validation on some field (e.g. a
 *  hand-edited `"port"`) recovers `claudeCommand`, `ignoreAuthors`, `quietWindowMinutes` and
 *  `pollIntervalMinutes` individually — each keeps its on-disk value when it validates on its
 *  own, and takes its default only when it is itself invalid or absent — rather than reporting
 *  defaults for values that are actually sitting on disk. Every other key falls back to its
 *  default. */
export function readConfigFile(path: string): ConfigFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return DEFAULT_CONFIG_FILE;
  }
  try {
    return parseConfigFile(text, path);
  } catch {
    return recoverValidKeys(text);
  }
}

/** Best-effort per-key extraction from JSON text that failed whole-object validation. Yields
 *  the defaults when the text isn't even a JSON object — there's nothing to recover then. */
function recoverValidKeys(text: string): ConfigFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_CONFIG_FILE;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_CONFIG_FILE;
  const { claudeCommand, ignoreAuthors, quietWindowMinutes, pollIntervalMinutes } = raw as Record<
    string,
    unknown
  >;
  return {
    ...DEFAULT_CONFIG_FILE,
    claudeCommand: isClaudeCommand(claudeCommand)
      ? claudeCommand
      : DEFAULT_CONFIG_FILE.claudeCommand,
    ignoreAuthors: isIgnoreAuthors(ignoreAuthors)
      ? ignoreAuthors
      : DEFAULT_CONFIG_FILE.ignoreAuthors,
    quietWindowMinutes: isQuietWindowMinutes(quietWindowMinutes)
      ? quietWindowMinutes
      : DEFAULT_CONFIG_FILE.quietWindowMinutes,
    pollIntervalMinutes: isPollIntervalMinutes(pollIntervalMinutes)
      ? pollIntervalMinutes
      : DEFAULT_CONFIG_FILE.pollIntervalMinutes,
  };
}

/** Thrown by `patchConfigFile` when the on-disk file fails to parse or validate: writing the
 *  patch would otherwise serialize resolved defaults over a file the user can still fix by
 *  hand. */
export class ConfigWriteRefusedError extends Error {}

/**
 * Merges `patch` over `path`'s on-disk file and writes it back atomically. ENOENT is fine —
 * there is nothing to clobber, so the patch merges over `DEFAULT_CONFIG_FILE` instead. An
 * existing file that fails to parse or validate throws `ConfigWriteRefusedError` rather than
 * writing anything. On success, the patch merges over the *raw* parsed object, not
 * `parseConfigFile`'s defaulted return — merging onto the defaulted return would inject every
 * `ConfigFile` field's default into a file that only ever set one key.
 */
export function patchConfigFile(path: string, patch: Partial<ConfigFile>): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    writeConfigFile(path, { ...DEFAULT_CONFIG_FILE, ...patch });
    return;
  }
  try {
    parseConfigFile(text, path); // validates; its defaulted return is not the merge base
  } catch (error) {
    throw new ConfigWriteRefusedError(
      `refusing to write ${path}: existing file is invalid (${(error as Error).message})`,
    );
  }
  // parseConfigFile above already guarantees text parses as a JSON object, so this reparse
  // (for the raw, non-defaulted merge base) cannot fail.
  const raw = JSON.parse(text) as Record<string, unknown>;
  writeConfigFile(path, { ...raw, ...patch });
}
