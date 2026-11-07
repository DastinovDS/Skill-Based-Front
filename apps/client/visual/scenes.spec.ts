import { expect, test, type Page } from '@playwright/test';
import { HELMET_SCENES, SCENES } from './scenes.ts';

// The dev scenes (visual/scenes.ts, built in src/dev/scenarios.ts), each on its map, frozen at the
// tick of its snapshot. Reference PNGs: visual/scenes.spec.ts-snapshots/. Every scene has a reference
// with the triangle units; the main ones also one with the helmets (#784), the default look.

async function shoot(
  page: Page,
  scene: (typeof SCENES)[number],
  look: 'triangle' | 'helmet',
  name: string,
): Promise<void> {
  // The unit look is the viewer's choice, kept in the browser (`units/unitStyle.ts`).
  await page.addInitScript(`window.localStorage.setItem('sbf.units', '${look}');`);
  // `menus` lets a frozen scene take the keys of the player (orders go nowhere).
  await page.goto(`/?scene=${scene.id}${scene.keys === undefined ? '' : '&menus'}`);
  // The renderer marks the canvas host once a frame of the snapshot is drawn.
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', String(scene.tick));
  // The baked background loads on its own: the map is not ready before it.
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  // The keys of the scene (the «Supply» view), then the pointer away from the map.
  for (const key of scene.keys ?? []) await page.keyboard.press(key);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(scene.keys === undefined ? 0 : 300);
  // The HUD is not part of the map: hide it (it shows the changing FPS).
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  await expect(page.locator('canvas')).toHaveScreenshot(name, { maxDiffPixelRatio: 0.01 });
}

for (const scene of SCENES) {
  test(`scene ${scene.id} matches the reference`, async ({ page }) => {
    await shoot(page, scene, 'triangle', `${scene.id}.png`);
  });
}

for (const scene of SCENES.filter((s) => HELMET_SCENES.includes(s.id))) {
  test(`scene ${scene.id} with helmets matches the reference`, async ({ page }) => {
    await shoot(page, scene, 'helmet', `${scene.id}-helmet.png`);
  });
}
