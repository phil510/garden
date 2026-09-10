import { parseArgs } from 'node:util';
import type { CliClient, Io } from './commands.js';
import { defaultClient, runKill, runLs, runNew, runResume } from './commands.js';
import { defaultStopAllDeps, runStop, runStopAll, type StopAllDeps } from './stop.js';
import { runUninstall } from './uninstall.js';

const CLI_COMMANDS = ['new', 'ls', 'kill', 'resume', 'stop', 'uninstall'] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export function isCliCommand(command: string | undefined): command is CliCommand {
  return command !== undefined && (CLI_COMMANDS as readonly string[]).includes(command);
}

export function usageLines(): string {
  return 'usage: garden [new <dir> | ls | kill <id> | resume <id> | stop [--all] | uninstall]\n';
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

function usage(io: Io, line: string): 1 {
  io.stderr.write(`garden: usage: ${line}\n`);
  return 1;
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
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      json: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const json = values.json === true;

  switch (command) {
    case 'new':
      return positionals[0] === undefined
        ? usage(io, 'garden new <dir>')
        : runNew(io, positionals[0], json, client);
    case 'ls':
      return runLs(io, json, client);
    case 'kill':
      return positionals[0] === undefined
        ? usage(io, 'garden kill <id>')
        : runKill(io, positionals[0], json, client);
    case 'resume':
      return positionals[0] === undefined
        ? usage(io, 'garden resume <id>')
        : runResume(io, positionals[0], json, client);
    case 'stop':
      return values.all === true
        ? runStopAll(io, values.yes === true, client, stopAllDeps)
        : runStop(io);
    case 'uninstall':
      return runUninstall(io, values.yes === true);
  }
}
