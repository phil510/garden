import { writeAll } from '../src/cli/io.js';
import { decideEntrypointAction, runCli, usageLines } from '../src/cli/run.js';
import { runStart, SERVER_PROCESS_ENV } from '../src/cli/start.js';
import { main } from '../src/main.js';

const io = { stdout: process.stdout, stderr: process.stderr };

async function runServer(): Promise<void> {
  try {
    await main();
  } catch (error) {
    // Startup failures (tmux missing, port taken) are for the user to act on, not stack traces.
    await writeAll(
      process.stderr,
      `garden: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

const [command, ...rest] = process.argv.slice(2);
const action = decideEntrypointAction(command, process.env[SERVER_PROCESS_ENV] === '1');

switch (action.kind) {
  case 'server':
    // `garden` re-invokes this same entry point detached, marked, to run the server in the background.
    await runServer();
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
