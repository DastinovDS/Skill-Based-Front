import { expect, test } from '@playwright/test';

// The three recorded snapshots of packages/protocol/fixtures/server/, each on its map, frozen at
// the tick of the snapshot (see src/dev/scenarios.ts). Reference PNGs: visual/scenes.spec.ts-snapshots/.
const SCENES = [
  { id: 'snapshot', tick: 120 },
  { id: 'snapshot_fog', tick: 300 },
  { id: 'snapshot_clash', tick: 400 },
  { id: 'overflow', tick: 120 },
] as const;

for (const scene of SCENES) {
  test(`scene ${scene.id} matches the reference`, async ({ page }) => {
    await page.goto(`/?scene=${scene.id}`);
    // The renderer marks the canvas host once a frame of the snapshot is drawn.
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', String(scene.tick));
    // The HUD is not part of the map: hide it (it shows the changing FPS).
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await expect(page.locator('canvas')).toHaveScreenshot(`${scene.id}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
}
