import { writeAll } from '../src/cli/io.js';
import { decideEntrypointAction, parseEntrypointArgv, runCli, usageLines } from '../src/cli/run.js';
import { runStart, SERVER_PROCESS_ENV } from '../src/cli/start.js';
import { main } from '../src/main.js';

// Getters, so `process.stdout` is only created for commands that use it. `garden events`
// owns fd 1 through its lifeline, and a second handle on it would break that.
const io = {
  get stdout() {
    return process.stdout;
  },
  get stderr() {
    return process.stderr;
  },
};

async function runServer(detached: boolean): Promise<void> {
  try {
    await main(detached);
  } catch (error) {
    // Startup failures (tmux missing, port taken) are for the user to act on, not stack traces.
    await writeAll(
      process.stderr,
      `garden: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

const args = parseEntrypointArgv(process.argv.slice(2));
if (!args.ok) {
  await writeAll(process.stderr, `garden: ${args.message}\n`);
  process.exit(1);
}
const { command, rest, isDetached, harness } = args;
// Instance routing uses the selected harness. Event ownership uses the caller's inherited one.
const callerEnv = harness === undefined ? process.env : { ...process.env };
if (harness !== undefined) process.env.GARDEN_HARNESS = harness;
// A bare selector requests startup even from a pane that inherited the server marker.
const action = decideEntrypointAction(
  command,
  harness === undefined && process.env[SERVER_PROCESS_ENV] === '1',
);

switch (action.kind) {
  case 'server':
    // Both `garden`'s detached re-invocation and `pnpm dev`/`pnpm dev:sandbox` land here;
    // `isDetached` tells `runServer` which of the two it's running as.
    await runServer(isDetached);
    break;
  case 'cli':
    process.exit(await runCli(action.command, rest, io, undefined, undefined, callerEnv));
    break;
  case 'start':
    process.exit(await runStart(io));
    break;
  case 'unknown':
    await writeAll(process.stderr, `garden: unknown command "${action.command}"\n${usageLines()}`);
    process.exit(1);
    break;
}
