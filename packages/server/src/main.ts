import { loadConfig } from './config.js';
import { createServer } from './http/server.js';

/** The composition root: the one place that reads config and wires the parts together. */
export async function main(): Promise<void> {
  const config = loadConfig();
  const app = createServer();

  await app.listen({ port: config.port, host: config.host });
  console.log(`garden server listening on http://${config.host}:${config.port}`);
}
