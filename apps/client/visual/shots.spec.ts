import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DOCK_CLICKS, MENU_SCENES, SCENES } from './scenes.ts';

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

// The travel time of an order (#432, #448): `?eta=<from>,<to>,<ticks>[,<via>...]` pins the label and
// the route to a frozen scene (a fixture has no server to answer `reach`). `eta-<name>.png` is the
// map alone: a road between two cities, and routes of two roads through a city (the label in the
// middle of the route, the route lit up).
const ETAS = [
  { name: 'artery-near', scene: 'artery', tick: 2400, eta: '3,4,120' },
  { name: 'artery-far', scene: 'artery', tick: 2400, eta: '3,5,250,4' },
  { name: 'artery-bend', scene: 'artery', tick: 2400, eta: '6,8,310,7' },
  { name: 'snapshot', scene: 'snapshot', tick: 120, eta: '0,1,95' },
] as const;

for (const shot of ETAS) {
  test(`shot of the travel time of an order (${shot.name})`, async ({ page }) => {
    await page.goto(`/?scene=${shot.scene}&eta=${shot.eta}`);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', String(shot.tick));
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await page.locator('canvas').screenshot({ path: join(OUT, `eta-${shot.name}.png`) });
  });
}

// The road mode (key U, #469): the dashed band on the roads a click would raise, on the normal map
// and in the «Supply» view (Tab). `road-mode-normal.png` and `road-mode-supply.png`, the map alone;
// `?menus` lets the frozen scene take the mode (orders go nowhere).
for (const view of ['normal', 'supply'] as const) {
  test(`shot of the road mode (${view})`, async ({ page }) => {
    await page.goto('/?scene=snapshot&menus');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '120');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    if (view === 'supply') await page.keyboard.press('Tab');
    await page.keyboard.press('KeyU');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await page.locator('canvas').screenshot({ path: join(OUT, `road-mode-${view}.png`) });
  });
}

// The screens before a match (#471, `/?menu=<id>`, src/dev/menuScenes.ts): `screen-<id>.png` and the
// same in grey scale `screen-<id>-gray.png` (a state must read without the hue). The account menu is
// the chip in the corner pressed; `-1024x640` is the smallest window we support, `-800x500` the
// window of a big UI scale (the rail flows over the picture there).
for (const id of MENU_SCENES) {
  test(`shot of the screen ${id}`, async ({ page }) => {
    await page.goto(`/?menu=${id}`);
    await expect(
      page.locator('.front svg.scene, .card, [role="alertdialog"]').first(),
    ).toBeVisible();
    const press = DOCK_CLICKS[id];
    if (press !== undefined) {
      await page.locator('.panel').getByRole('button', { name: press }).first().click();
    }
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-${id}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `screen-${id}-gray.png`) });
  });
}

test('shot of the account menu', async ({ page }) => {
  await page.goto('/?menu=menu-guest');
  await page.locator('button.who').click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.move(600, 700);
  await page.screenshot({ path: join(OUT, 'screen-account-menu.png') });
});

for (const size of [
  { width: 1024, height: 640 },
  { width: 800, height: 500 },
  { width: 1920, height: 1080 },
]) {
  for (const id of [
    'menu-calibration',
    'queue-found',
    'lobby-list',
    'bot-choose',
    'invite-joined',
  ] as const) {
    test(`shot of the screen ${id} at ${String(size.width)}x${String(size.height)}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto(`/?menu=${id}`);
      await expect(page.locator('.front svg.scene')).toBeVisible();
      await page.screenshot({
        path: join(OUT, `screen-${id}-${String(size.width)}x${String(size.height)}.png`),
      });
    });
  }
}

// The progress cells of an own city (#439): `?scene=progress` has queues and builds in every state; a click on
// the capital selects it (a frozen scene only selects), and its queue shows the free slot as a dashed cell.
// `progress-selected.png`, the map alone.
test('shot of the progress cells with a selected city', async ({ page }) => {
  await page.goto('/?scene=progress');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.mouse.click(118, 520);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  await page.locator('canvas').screenshot({ path: join(OUT, 'progress-selected.png') });
});

// The same scene in grey scale at 60% of the map scale (#439): every state of the cells must read without the hue and
// by its pattern at a small size. `progress-gray-60.png`, the map alone.
test('shot of the progress cells in grey scale at 60% scale', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 480 });
  await page.goto('/?scene=progress');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.waitForTimeout(500);
  await page.addStyleTag({
    content: '.hud { display: none !important; } canvas { filter: grayscale(1); }',
  });
  await page.locator('canvas').screenshot({ path: join(OUT, 'progress-gray-60.png') });
});

// The enemy figures of the roads (EF2 "Pointer", #354) in grey scale at 60% of the map scale: the direction (the head),
// the level (the plate, the dashes) and the half memory with its dashed tick must read without the hue.
// `figures-gray-60.png`, the map alone.
test('shot of the enemy figures in grey scale at 60% scale', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 480 });
  await page.goto('/?scene=figures');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.waitForTimeout(500);
  await page.addStyleTag({
    content: '.hud { display: none !important; } canvas { filter: grayscale(1); }',
  });
  await page.locator('canvas').screenshot({ path: join(OUT, 'figures-gray-60.png') });
});

// The opponent's planned order (IN3 "Crosshair", #353) in grey scale at 60% of the map scale: the thin dashed arrow, the ring in a ring
// at its tail and the crosshair (two rings, four ticks) on the target must read without the hue. `intents-gray-60.png`, the map alone.
test('shot of the opponent intent in grey scale at 60% scale', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 480 });
  await page.goto('/?scene=artery');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.waitForTimeout(500);
  await page.addStyleTag({
    content: '.hud { display: none !important; } canvas { filter: grayscale(1); }',
  });
  await page.locator('canvas').screenshot({ path: join(OUT, 'intents-gray-60.png') });
});

// The hint "split the group" before an order hits the stack limit (#468): `?split=2&menus` makes the frozen scene (`menus`: orders go nowhere but the pointer previews them) answer the
// `reach` of the selected group with the node 2 under `split` (the server's answer, DEC-20). Select the group, rest the
// pointer on that node. `split-hint.png` is the whole screen, `split-hint-gray.png` the same in grey scale.
test('shot of the split hint on a target the group is too big for', async ({ page }) => {
  await page.goto('/?scene=snapshot&split=2&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '120');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.mouse.click(465, 415);
  await page.waitForTimeout(400);
  await page.mouse.move(640, 598);
  await page.mouse.move(641, 599);
  await expect(page.locator('[role="tooltip"]')).toBeVisible();
  await page.screenshot({ path: join(OUT, 'split-hint.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'split-hint-gray.png') });
});
