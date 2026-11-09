import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// `mise run perf [label]` (#854): what a match screen costs under software WebGL (SwiftShader, as on
// the CI runners), on a few dev scenes: how long the main thread is blocked while the scene comes
// up (long tasks) and how long a frame takes once it is up. A measurement to compare two commits
// on one machine, never a pass/fail check (timing on a shared machine is noise): run it on both,
// a few times, and compare the medians. The numbers go to the console and to
// `.shots/<label>/perf.json`.
const OUT = join(
  process.env['SHOTS_DIR'] ?? join(import.meta.dirname, '..', '..', '..', '.shots'),
  process.env['SHOTS_LABEL'] ?? 'current',
);

/** Fog on a convex map, fog and curved borders on a geography map, fights running. */
const SCENES = [
  { id: 'snapshot_fog', tick: 300 },
  { id: 'forts_geo', tick: 1200 },
  { id: 'fights', tick: 400 },
] as const;

/** How long the frames are counted, ms. */
const FRAMES_MS = 4000;

interface Result {
  readonly scene: string;
  /** From the start of the navigation to the scene drawn with its background, ms (dev server). */
  readonly readyMs: number;
  /** The long tasks (over 50 ms) until one second after that: their sum and the longest, ms. */
  readonly loadBlockedMs: number;
  readonly loadLongestMs: number;
  /** Frames after the scene settled: the mean and the 95th percentile of the frame time, ms. */
  readonly frameMs: number;
  readonly frameP95Ms: number;
}

const results: Result[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: [number, number][] };
    w.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push([entry.startTime, entry.duration]);
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // No long task timing in this browser: the load numbers stay 0.
    }
  });
});

for (const scene of SCENES) {
  test(`cost of scene ${scene.id}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/?scene=${scene.id}`);
    const canvas = page.locator('.game-canvas');
    await expect(canvas).toHaveAttribute('data-tick', String(scene.tick), { timeout: 120_000 });
    await expect(canvas).not.toHaveAttribute('data-background', 'pending', { timeout: 120_000 });
    const readyMs = await page.evaluate(() => performance.now());
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1000);
    const load = await page.evaluate((until) => {
      const tasks = (window as unknown as { __longTasks: [number, number][] }).__longTasks;
      const within = tasks.filter(([start]) => start < until);
      return {
        blocked: within.reduce((sum, [, duration]) => sum + duration, 0),
        longest: within.reduce((max, [, duration]) => Math.max(max, duration), 0),
      };
    }, readyMs + 1000);
    const frames = await page.evaluate(
      (ms) =>
        new Promise<number[]>((resolve) => {
          const times: number[] = [];
          const step = (now: number): void => {
            times.push(now);
            if (now - (times[0] ?? now) < ms) requestAnimationFrame(step);
            else resolve(times.slice(1).map((t, i) => t - (times[i] ?? t)));
          };
          requestAnimationFrame(step);
        }),
      FRAMES_MS,
    );
    const sorted = [...frames].sort((a, b) => a - b);
    const mean = frames.reduce((sum, t) => sum + t, 0) / Math.max(1, frames.length);
    const round = (v: number): number => Math.round(v * 10) / 10;
    results.push({
      scene: scene.id,
      readyMs: Math.round(readyMs),
      loadBlockedMs: Math.round(load.blocked),
      loadLongestMs: Math.round(load.longest),
      frameMs: round(mean),
      frameP95Ms: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    });
  });
}

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'perf.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log('\nscene            ready  blocked  longest  frame  frame p95   (ms)');
  for (const r of results) {
    const cells = [r.readyMs, r.loadBlockedMs, r.loadLongestMs, r.frameMs, r.frameP95Ms];
    console.log(`${r.scene.padEnd(14)} ${cells.map((c) => String(c).padStart(7)).join('  ')}`);
  }
});
