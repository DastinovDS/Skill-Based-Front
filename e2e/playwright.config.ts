import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the whole product (QA-02, #84): two browsers play a match by invite against
// the real stack (Caddy with the built client + the game server) on the 60-second ruleset
// `test-short`. The stack is NOT started here: see e2e/README.md (`docker compose -f compose.yaml
// -f e2e/compose.e2e.yaml up --build -d --wait`), then `pnpm -C e2e test`.
export default defineConfig({
  testDir: 'tests',
  // A full match is 60 s of game time plus the replay; the checks inside have their own timeouts.
  // The CI runner has 2 cores and renders WebGL in software, and its speed swings a lot from run
  // to run (#864). Green e2e jobs measured on CI (#864): the slowest test is the invite match, up
  // to 2.3 min (138 s) since the match screen got cheap (#863; before it up to 3.0 min), the
  // reload test up to 1.6 min, the other tests under 40 s. So one test gets 240 s (1.7x the
  // slowest) and a plain assertion 20 s (the slowest start-page test, with three of them and a
  // page load, took 8.6 s). Steps that wait for a match to play out or a replay to open carry
  // their own longer timeouts in the specs. If a run needs more, find what got slow first.
  timeout: 240_000,
  expect: { timeout: 20_000 },
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
