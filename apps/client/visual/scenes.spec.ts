import { expect, test } from '@playwright/test';
import { SCENES } from './scenes.ts';

// The dev scenes (visual/scenes.ts, built in src/dev/scenarios.ts), each on its map, frozen at the
// tick of its snapshot. Reference PNGs: visual/scenes.spec.ts-snapshots/.

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
