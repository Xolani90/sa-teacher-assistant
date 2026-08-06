import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development, requests to /api are proxied to the backend so the
// dashboard can be run on its own port (5173) without CORS configuration.
// Set VITE_API_BASE_URL in a .env file to point elsewhere (e.g. production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
  },
});
