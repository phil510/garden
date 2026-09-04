import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Must match the server's default port so `vite dev` proxies to a default-started server.
const SERVER_PORT = 4310;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Extend as the server gains routes; the dev server owns the client only.
      '/health': `http://127.0.0.1:${SERVER_PORT}`,
    },
  },
});
