import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { SCENES } from './scenes.ts';

// `mise run shots [label]`: a PNG of every dev scene for the agent (or the owner) to look at, no
// comparison with a reference. Per scene: `<scene>.png` is the whole screen with the HUD,
// `<scene>-map.png` the map canvas alone (what scenes.spec.ts compares). The replay viewer is
// `replay.png`. The folder is `.shots/<label>/` of the repository (git ignores it) or
// `SHOTS_DIR/<label>`; the names never change, so "before" and "after" are two labels.
const OUT = join(
  process.env['SHOTS_DIR'] ?? join(import.meta.dirname, '..', '..', '..', '.shots'),
  process.env['SHOTS_LABEL'] ?? 'current',
);

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

for (const scene of SCENES) {
  test(`shot of scene ${scene.id}`, async ({ page }) => {
    await page.goto(`/?scene=${scene.id}`);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', String(scene.tick));
    // The baked background loads on its own: the map is not ready before it.
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.screenshot({ path: join(OUT, `${scene.id}.png`) });
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await page.locator('canvas').screenshot({ path: join(OUT, `${scene.id}-map.png`) });
  });
}

test('shot of the replay viewer', async ({ page }) => {
  await page.goto('/?replay=dev');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '0');
  await page.getByRole('button', { name: '×16' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByLabel('Position in the match').fill('300');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '300');
  await page.screenshot({ path: join(OUT, 'replay.png') });
});

// A replay with fights (#323): the arena with the round data of the file (shots, losses, the
// last round) in a fight of a node at ticks 385 (a round just fought) and 460 (a short fight).
// `replay-fights-<tick>.png`; the sample is `src/replay/siege-fights.frames.json`.
for (const tick of ['385', '460']) {
  test(`shot of the replay viewer with a fight at tick ${tick}`, async ({ page }) => {
    await page.goto('/?replay=dev-fights');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '0');
    await page.getByLabel('Position in the match').fill(tick);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', tick);
    await page.screenshot({ path: join(OUT, `replay-fights-${tick}.png`) });
  });
}

// The radial menus (#350): `/?scene=snapshot_fog&menus` lets a frozen scene open them (orders go
// nowhere), each menu opened the way the player does. `menu-<name>.png` is the whole screen,
// `menu-<name>-gray.png` the same in grey scale (the icons must read without the hue).
const MENUS = [
  { name: 'stance', open: 'Q key' },
  { name: 'city', open: 'click on the ring of the city' },
  { name: 'group', open: 'two clicks on the group' },
  { name: 'supply', open: 'Tab, then a click on the city' },
] as const;

for (const menu of MENUS) {
  test(`shot of the ${menu.name} menu (${menu.open})`, async ({ page }) => {
    await page.goto('/?scene=snapshot_fog&menus');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '300');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    switch (menu.name) {
      case 'stance':
        await page.keyboard.down('KeyQ');
        await page.waitForTimeout(80);
        await page.keyboard.up('KeyQ');
        break;
      case 'city':
        await page.mouse.click(335, 360);
        break;
      case 'group':
        await page.mouse.click(335, 430);
        await page.waitForTimeout(300);
        await page.mouse.click(335, 430);
        break;
      case 'supply':
        await page.keyboard.press('Tab');
        await page.mouse.click(335, 360);
        break;
    }
    // Away from the menu, so that no sector is lit by the pointer; the menu grows in 140 ms.
    await page.mouse.move(1000, 700);
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `menu-${menu.name}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `menu-${menu.name}-gray.png`) });
  });
}
