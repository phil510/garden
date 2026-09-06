import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Must match the server's default port so `vite dev` proxies to a default-started server.
const SERVER_PORT = 4310;
const target = `http://127.0.0.1:${SERVER_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/health': target,
      '/hooks': target,
      '/sessions': target,
      '/repos': target,
      '/ui-state': target,
      '/fs': target,
      '/events': { target, ws: true },
      '/attach': { target, ws: true },
    },
  },
});
