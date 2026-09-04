import { homedir } from 'node:os';
import { writeTmuxConf } from './appdir.js';
import { ensureConfigFile, loadConfig } from './config.js';
import { createServer } from './http/server.js';

/** The composition root: the one place that reads config and wires the parts together. */
export async function main(): Promise<void> {
  const home = homedir();
  const config = loadConfig(process.env, ensureConfigFile(home), home);
  const tmuxConfPath = writeTmuxConf(home);
  console.log(`garden app directory ${config.appDir}, tmux conf ${tmuxConfPath}`);
  const app = createServer();
  await app.listen({ port: config.port, host: config.host });
  console.log(`garden server listening on http://${config.host}:${config.port}`);
}
