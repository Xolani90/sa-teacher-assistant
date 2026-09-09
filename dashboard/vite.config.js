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
    // Vitest's 5s default is too tight for this suite. jsdom + userEvent
    // typing is slow, and because vitest runs test files in parallel, the
    // heavier interaction tests get starved of CPU on a modest machine:
    // GrowthPlanPanel's "shows an error and keeps the form open when
    // saving fails" completes in ~900ms when its file is run alone but
    // exceeded 5000ms during a full-suite run. That is contention, not a
    // hang or a real regression, so the timeout is raised rather than the
    // test weakened. Kept suite-wide instead of sprinkling per-test
    // timeouts so the next slow interaction test doesn't rediscover this.
    testTimeout: 20000,
  },
});
