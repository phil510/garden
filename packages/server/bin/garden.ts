import { isCliCommand, runCli } from '../src/cli/run.js';
import { main } from '../src/main.js';

const [command, ...rest] = process.argv.slice(2);

if (isCliCommand(command)) {
  process.exit(await runCli(command, rest, { stdout: process.stdout, stderr: process.stderr }));
} else {
  try {
    await main();
  } catch (error) {
    // Startup failures (tmux missing, port taken) are for the user to act on, not stack traces.
    process.stderr.write(`garden: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
