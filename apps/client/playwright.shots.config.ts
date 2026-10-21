import { createServer } from 'node:net';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

// `mise run shots`: the screenshot spec (visual/shots.spec.ts) on the settings of the reference
// test, against a dev server of its own on a free port (Playwright starts it and stops it by its
// process, so a dev server of somebody else on 5173 or 5199 is left alone).
// The config is loaded again in every worker: the first load picks the port and the workers
// (which inherit the environment) take it from `SHOTS_PORT`.
const port = Number(process.env['SHOTS_PORT']) || (await freePort());
process.env['SHOTS_PORT'] = String(port);

function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no free port'));
        else resolve(address.port);
      });
    });
  });
}

export default defineConfig({
  ...base,
  testMatch: 'shots.spec.ts',
  testIgnore: [],
  reporter: 'list',
  use: { ...base.use, baseURL: `http://localhost:${String(port)}` },
  webServer: {
    command: `pnpm exec vite --port ${String(port)} --strictPort`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: false,
  },
});
