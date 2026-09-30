import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import type { SessionsFilter, SpawnOptions } from '@garden/shared';
import {
  EFFORT_LEVELS,
  isEffortLevel,
  isModelName,
  isStatus,
  parseNonNegativeInt,
} from '@garden/shared';
import type { CliClient, Io } from './commands.js';
import { defaultClient, runAdopt, runKill, runLs, runNew, runResume } from './commands.js';
import { writeAll } from './io.js';
import { SERVER_DETACHED_FLAG } from './start.js';
import { defaultStopAllDeps, runStop, runStopAll, type StopAllDeps } from './stop.js';
import { runUninstall } from './uninstall.js';

const CLI_COMMANDS = ['new', 'ls', 'kill', 'resume', 'adopt', 'stop', 'uninstall'] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export function isCliCommand(command: string | undefined): command is CliCommand {
  return command !== undefined && (CLI_COMMANDS as readonly string[]).includes(command);
}

export function usageLines(): string {
  return (
    'usage: garden [new <dir> | ls | kill <id> | ' +
    'resume <id> | adopt <id> | stop [--all] | uninstall]\n'
  );
}

/**
 * Splits `SERVER_DETACHED_FLAG` off the front of `argv`, when it's there. Only a leading
 * position counts — `spawnServer` always puts it right after `scriptPath`, so a real
 * subcommand argument that happens to share the same literal string (e.g. `garden new
 * --detached`, naming a directory) is left in `rest` untouched rather than silently dropped.
 */
export function parseEntrypointArgv(argv: readonly string[]): {
  readonly command: string | undefined;
  readonly rest: readonly string[];
  readonly isDetached: boolean;
} {
  const isDetached = argv[0] === SERVER_DETACHED_FLAG;
  const [command, ...rest] = isDetached ? argv.slice(1) : argv;
  return { command, rest, isDetached };
}

export type EntrypointAction =
  | { readonly kind: 'server' }
  | { readonly kind: 'cli'; readonly command: CliCommand }
  | { readonly kind: 'start' }
  | { readonly kind: 'unknown'; readonly command: string };

/**
 * Checking `isCliCommand` before `isServerProcess` is the fix: a known subcommand always
 * dispatches, independent of whatever the process's environment claims. The marker only
 * matters when there's no subcommand at all, to tell apart `garden`'s detached
 * re-invocation (marker set) from a bare `garden` typed at a shell (marker unset).
 *
 * Whether that re-invocation is detached or attached (`pnpm dev` / `pnpm dev:sandbox`) never
 * changes which case below applies, so it isn't a parameter here — `bin/garden.ts` reads it
 * straight off argv (see `SERVER_DETACHED_FLAG` in `cli/start.ts`) and passes it directly to
 * `runServer`.
 */
export function decideEntrypointAction(
  command: string | undefined,
  isServerProcess: boolean,
): EntrypointAction {
  if (isCliCommand(command)) {
    return { kind: 'cli', command };
  }
  if (command === undefined) {
    return isServerProcess ? { kind: 'server' } : { kind: 'start' };
  }
  return { kind: 'unknown', command };
}

async function usage(io: Io, line: string): Promise<1> {
  await writeAll(io.stderr, `garden: usage: ${line}\n`);
  return 1;
}

type LsFilterResult =
  { ok: true; filter: SessionsFilter | undefined } | { ok: false; message: string };

/** `parseArgs` has no numeric option type, so `--since-days`/`--max-recap-chars` arrive as
 *  strings here and are parsed and range-checked before `runLs` sees them — a non-numeric
 *  value is a usage error, not a `NaN` passed through to the server. `filter` comes back
 *  `undefined` when no flag was given, but `sessionRoutes` always passes an object to
 *  `projection.sessions`, so a bare `garden ls` is still bounded by the 7-day/500-char
 *  defaults rather than unfiltered. */
function parseLsFilter(values: {
  'since-days': string | undefined;
  'max-recap-chars': string | undefined;
  live: boolean;
  status: string | undefined;
  swarm: string | undefined;
}): LsFilterResult {
  const filter: SessionsFilter = {};
  let hasAny = false;

  if (values['since-days'] !== undefined) {
    const sinceDays = parseNonNegativeInt(values['since-days']);
    if (sinceDays === undefined)
      return { ok: false, message: 'garden ls --since-days <non-negative integer days>' };
    filter.sinceDays = sinceDays;
    hasAny = true;
  }

  if (values['max-recap-chars'] !== undefined) {
    const maxRecapChars = parseNonNegativeInt(values['max-recap-chars']);
    if (maxRecapChars === undefined)
      return { ok: false, message: 'garden ls --max-recap-chars <non-negative integer chars>' };
    filter.maxRecapChars = maxRecapChars;
    hasAny = true;
  }

  if (values.live) {
    filter.live = true;
    hasAny = true;
  }

  if (values.status !== undefined) {
    if (!isStatus(values.status))
      return { ok: false, message: 'garden ls --status <working|waiting|needs-approval|unknown>' };
    filter.status = values.status;
    hasAny = true;
  }

  if (values.swarm !== undefined) {
    filter.swarmId = values.swarm;
    hasAny = true;
  }

  return { ok: true, filter: hasAny ? filter : undefined };
}

type SpawnOptionsResult = { ok: true; options: SpawnOptions } | { ok: false };

/** `--model` / `--effort` for `new` and `resume`, checked before any request is made so a bad
 *  value never reaches the server. */
function parseSpawnOptions(values: {
  model?: string | undefined;
  effort?: string | undefined;
}): SpawnOptionsResult {
  const { model, effort } = values;
  if (model !== undefined && !isModelName(model)) return { ok: false };
  if (effort !== undefined && !isEffortLevel(effort)) return { ok: false };
  return {
    ok: true,
    options: {
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    },
  };
}

const SPAWN_FLAGS_USAGE = `[--model <model>] [--effort <${EFFORT_LEVELS.join('|')}>]`;

/** `parseArgs` throws synchronously — not a rejected promise a caller can inspect — when a
 *  string-typed option is the last token with no following value (e.g. a trailing
 *  `--since-days` with nothing after it). Wrapping every call here turns that into the same
 *  usage-error path as every other rejected argument, instead of an uncaught exception reaching
 *  `bin/garden.ts`'s unguarded `process.exit(await runCli(...))`. */
function tryParseArgs<T extends ParseArgsConfig>(
  config: T,
): { ok: true; result: ReturnType<typeof parseArgs<T>> } | { ok: false; message: string } {
  try {
    return { ok: true, result: parseArgs(config) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** `rest` is `garden <command>`'s remaining argv: positionals plus `--json`. `stopAllDeps` is
 *  not threaded through by any real caller — it exists so tests can dispatch `stop --all`
 *  without exercising the real tmux-kill-server / server-stop side effects. */
export async function runCli(
  command: CliCommand,
  rest: readonly string[],
  io: Io,
  client: CliClient = defaultClient,
  stopAllDeps: StopAllDeps = defaultStopAllDeps,
): Promise<0 | 1> {
  const parsedArgs = tryParseArgs({
    args: rest,
    options: {
      json: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      'since-days': { type: 'string' },
      'max-recap-chars': { type: 'string' },
      live: { type: 'boolean', default: false },
      status: { type: 'string' },
      swarm: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
    },
    allowPositionals: true,
  });
  if (!parsedArgs.ok) return usage(io, parsedArgs.message);
  const { values, positionals } = parsedArgs.result;
  const json = values.json === true;

  switch (command) {
    case 'new': {
      if (positionals[0] === undefined) return usage(io, 'garden new <dir>');
      const spawn = parseSpawnOptions(values);
      return spawn.ok
        ? runNew(io, positionals[0], json, client, spawn.options)
        : usage(io, `garden new <dir> ${SPAWN_FLAGS_USAGE}`);
    }
    case 'ls': {
      const parsed = parseLsFilter({
        'since-days': values['since-days'],
        'max-recap-chars': values['max-recap-chars'],
        live: values.live,
        status: values.status,
        swarm: values.swarm,
      });
      return parsed.ok ? runLs(io, json, client, parsed.filter) : usage(io, parsed.message);
    }
    case 'kill':
      return positionals[0] === undefined
        ? usage(io, 'garden kill <id>')
        : runKill(io, positionals[0], json, client);
    case 'resume': {
      if (positionals[0] === undefined) return usage(io, 'garden resume <id>');
      const spawn = parseSpawnOptions(values);
      return spawn.ok
        ? runResume(io, positionals[0], json, client, spawn.options)
        : usage(io, `garden resume <id> ${SPAWN_FLAGS_USAGE}`);
    }
    case 'adopt':
      return positionals[0] === undefined
        ? usage(io, 'garden adopt <id>')
        : runAdopt(io, positionals[0], json, client);
    case 'stop':
      return values.all === true
        ? runStopAll(io, values.yes === true, client, stopAllDeps)
        : runStop(io);
    case 'uninstall':
      return runUninstall(io, values.yes === true);
  }
}
