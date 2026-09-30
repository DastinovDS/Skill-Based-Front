import { defineConfig, devices } from '@playwright/test';

// Screenshot tests of the dev scenes (CLI-04, #60): `pnpm -C apps/client test:visual`.
// References live next to the spec, one set per platform (the font and the rasteriser differ).
// Refresh them after an intended change with `pnpm -C apps/client test:visual:update`.
export default defineConfig({
  testDir: 'visual',
  // Software WebGL on a CI runner draws a few frames per second: give the stability check time.
  timeout: 60_000,
  expect: { timeout: 30_000 },
  // Out of the way of eslint and prettier (and of git).
  outputDir: 'node_modules/.playwright',
  reporter: process.env['CI'] === undefined ? 'list' : 'github',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: {
      // WebGL without a GPU (CI machines): software rendering through SwiftShader.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'pnpm exec vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: process.env['CI'] === undefined,
  },
});
