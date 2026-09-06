import { parseArgs } from 'node:util';
import type { CliClient, Io } from './commands.js';
import { defaultClient, runKill, runLs, runNew, runResume } from './commands.js';

const CLI_COMMANDS = ['new', 'ls', 'kill', 'resume'] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export function isCliCommand(command: string | undefined): command is CliCommand {
  return command !== undefined && (CLI_COMMANDS as readonly string[]).includes(command);
}

function usage(io: Io, line: string): 1 {
  io.stderr.write(`garden: usage: ${line}\n`);
  return 1;
}

/** `rest` is `garden <command>`'s remaining argv: positionals plus `--json`. */
export async function runCli(
  command: CliCommand,
  rest: readonly string[],
  io: Io,
  client: CliClient = defaultClient,
): Promise<0 | 1> {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { json: { type: 'boolean', default: false } },
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
  }
}
