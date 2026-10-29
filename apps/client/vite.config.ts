import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { CSP } from './csp.ts';

// The game server (`uv run gow-server`): the page is same-origin with the API and the match socket
// in production (Caddy); the dev server and `vite preview` forward them. The Host header stays the
// page's, so the server's Origin check of the socket (the site's own origin) passes.
// `GOW_SERVER_URL` points it elsewhere (another port, a remote dev server).
const SERVER_URL = process.env['GOW_SERVER_URL'] ?? 'http://127.0.0.1:8000';
const API_PROXY = {
  '/api': SERVER_URL,
  '/ws': { target: SERVER_URL, ws: true },
};

export default defineConfig({
  plugins: [svelte()],
  build: {
    // Vite strips the licence banners of the bundled libraries; this writes the licence text of
    // every bundled dependency next to the page (CLI-07, #498). The legal page links to it.
    license: { fileName: 'third-party-licenses.txt' },
  },
  server: {
    proxy: API_PROXY,
    // The dev screen bundles map files from outside apps/client (src/map/bundledMaps.ts), the tests
    // read the protocol fixtures (jsdom tests go through the same check). Setting
    // `allow` replaces Vite's default (the client directory), so the client is listed too.
    fs: {
      allow: [
        '.',
        '../../maps',
        '../../packages/sim/tests/maps',
        '../../packages/protocol/fixtures',
        '../../packages/protocol/vectors',
        // The reject codes test compares its list with the simulation's `RejectCode`.
        '../../packages/sim/src/gow_sim',
      ],
    },
  },
  // The production build is checked under the target CSP: `pnpm build && pnpm preview`.
  preview: {
    proxy: API_PROXY,
    headers: { 'Content-Security-Policy': CSP },
  },
  // Vitest runs in Node: resolve the browser build of Svelte so that `mount` works in tests.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // style.test.ts reads the palette tokens of app.css as text.
    css: { include: [/app\.css/] },
  },
});
