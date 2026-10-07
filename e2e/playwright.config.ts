import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the whole product (QA-02, #84): two browsers play a match by invite against
// the real stack (Caddy with the built client + the game server) on the 60-second ruleset
// `test-short`. The stack is NOT started here: see e2e/README.md (`docker compose -f compose.yaml
// -f e2e/compose.e2e.yaml up --build -d --wait`), then `pnpm -C e2e test`.
export default defineConfig({
  testDir: 'tests',
  // A full match is 60 s of game time plus the replay; the checks inside have their own timeouts.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // One test = one match with its own two guests: tests do not share anything and may run in
  // parallel, but the CI runner is small and renders WebGL in software: one worker there.
  fullyParallel: true,
  workers: process.env['CI'] === undefined ? 3 : 1,
  // A flaky pass would hide the instability the issue asks to rule out (20 runs in a row).
  retries: 0,
  outputDir: 'test-results',
  reporter: process.env['CI'] === undefined ? 'list' : [['github'], ['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost',
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // WebGL without a GPU (CI machines): software rendering through SwiftShader.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium' }],
});
