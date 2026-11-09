import { defineConfig } from '@playwright/test';
import shots from './playwright.shots.config.ts';

// `mise run perf [label]` (#854): the cost of a match screen under software WebGL
// (visual/perf.spec.ts), on the dev server of the screenshot tool (a free port of its own). One
// worker, so the scenes do not compete for the CPU.
export default defineConfig({
  ...shots,
  testMatch: 'perf.spec.ts',
  workers: 1,
  fullyParallel: false,
});
