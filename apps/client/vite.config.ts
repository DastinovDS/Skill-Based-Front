import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { CSP } from './csp.ts';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // The dev screen bundles map files from outside apps/client (src/map/bundledMaps.ts). Setting
    // `allow` replaces Vite's default (the client directory), so the client is listed too.
    fs: { allow: ['.', '../../maps', '../../packages/sim/tests/maps'] },
  },
  // The production build is checked under the target CSP: `pnpm build && pnpm preview`.
  preview: {
    headers: { 'Content-Security-Policy': CSP },
  },
  // Vitest runs in Node: resolve the browser build of Svelte so that `mount` works in tests.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
