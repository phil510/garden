import { isCliCommand, runCli, usageLines } from '../src/cli/run.js';
import { runStart, SERVER_PROCESS_ENV } from '../src/cli/start.js';
import { main } from '../src/main.js';

const io = { stdout: process.stdout, stderr: process.stderr };

async function runServer(): Promise<void> {
  try {
    await main();
  } catch (error) {
    // Startup failures (tmux missing, port taken) are for the user to act on, not stack traces.
    process.stderr.write(`garden: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

const [command, ...rest] = process.argv.slice(2);

if (process.env[SERVER_PROCESS_ENV] === '1') {
  // `garden` re-invokes this same entry point detached, marked, to run the server in the background.
  await runServer();
} else if (isCliCommand(command)) {
  process.exit(await runCli(command, rest, io));
} else if (command === undefined) {
  process.exit(await runStart(io));
} else {
  process.stderr.write(`garden: unknown command "${command}"\n${usageLines()}`);
  process.exit(1);
}
