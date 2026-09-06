import { main } from '../src/main.js';

try {
  await main();
} catch (error) {
  // Startup failures (tmux missing, port taken) are for the user to act on, not stack traces.
  process.stderr.write(`garden: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
