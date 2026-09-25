import { writeAll } from '../src/cli/io.js';
import { decideEntrypointAction, parseEntrypointArgv, runCli, usageLines } from '../src/cli/run.js';
import { runStart, SERVER_PROCESS_ENV } from '../src/cli/start.js';
import { main } from '../src/main.js';

const io = { stdout: process.stdout, stderr: process.stderr };

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

const { command, rest, isDetached } = parseEntrypointArgv(process.argv.slice(2));
const action = decideEntrypointAction(command, process.env[SERVER_PROCESS_ENV] === '1');

switch (action.kind) {
  case 'server':
    // Both `garden`'s detached re-invocation and `pnpm dev`/`pnpm dev:sandbox` land here;
    // `isDetached` tells `runServer` which of the two it's running as.
    await runServer(isDetached);
    break;
  case 'cli':
    process.exit(await runCli(action.command, rest, io));
    break;
  case 'start':
    process.exit(await runStart(io));
    break;
  case 'unknown':
    await writeAll(process.stderr, `garden: unknown command "${action.command}"\n${usageLines()}`);
    process.exit(1);
    break;
}
