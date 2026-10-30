import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DRAWN_MAP_VARIANCE, mapVariance } from './mapPixels.ts';
import { DOCK_CLICKS, MENU_SCENES, SCENES, STATUS_SCENES } from './scenes.ts';

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
    // `menus` lets a frozen scene take the keys of the player (orders go nowhere).
    await page.goto(`/?scene=${scene.id}${scene.keys === undefined ? '' : '&menus'}`);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', String(scene.tick));
    // The baked background loads on its own: the map is not ready before it.
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    // The keys of the scene (the «Supply» view), then the pointer away from the map.
    for (const key of scene.keys ?? []) await page.keyboard.press(key);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(scene.keys === undefined ? 0 : 300);
    await page.screenshot({ path: join(OUT, `${scene.id}.png`) });
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await page.locator('canvas').screenshot({ path: join(OUT, `${scene.id}-map.png`) });
  });
}

test('shot of the replay viewer', async ({ page }) => {
  await page.goto('/?replay=dev');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '0');
  await page.getByRole('button', { name: '×16' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByLabel('Position in the match').fill('300');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '300');
  await page.screenshot({ path: join(OUT, 'replay.png') });
});

// The states of the replay screen before a file is there (#593): `replay-preparing.png` (the server
// still builds the frames) and `replay-unavailable.png` (410).
// `replay-loading.png` and `replay-network.png` (with "Try again") came with #599.
for (const state of ['loading', 'preparing', 'unavailable', 'network']) {
  test(`shot of the replay screen (${state})`, async ({ page }) => {
    await page.goto(`/?replay=dev-${state}`);
    await expect(
      page.getByRole(state === 'loading' || state === 'preparing' ? 'status' : 'alert'),
    ).toBeVisible();
    await page.screenshot({ path: join(OUT, `replay-${state}.png`) });
  });
}

// The replay viewer seen as player 2 (the blue side follows the choice, #599), at the end of the
// match (the result chip), and at a phone width: `replay-as-player2.png`, `replay-end.png`,
// `replay-narrow.png`, each also in grey scale.
test('shot of the replay viewer as player 2, at the end and on a phone', async ({ page }) => {
  await page.goto('/?replay=dev-fights');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '0');
  await page.getByLabel('Position in the match').fill('385');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '385');
  await page
    .getByRole('group', { name: 'View as' })
    .getByRole('button', { name: 'Player 2' })
    .click();
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '385');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'replay-as-player2.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'replay-as-player2-gray.png') });
  await page.reload();
  await page.getByLabel('Position in the match').fill('464');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '464');
  await expect(page.getByRole('status')).toContainText('Player 2 won');
  await page.screenshot({ path: join(OUT, 'replay-end.png') });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'replay-narrow.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'replay-narrow-gray.png') });
});

// The fog of one side (#600) on `src/replay/siege-fog.frames.json` (the file has what each player
// saw): `replay-fog-p1.png` (player 1 at tick 460: the veil, a memory ghost, an enemy figure on a
// road), `replay-fog-p1-off.png` (the same side without its fog, key F), `replay-fog-both.png`
// (Both: no fog, the toggle unavailable) and `replay-fog-p2.png` (player 2 at tick 520), the
// player shots also in grey scale.
test('shot of the replay viewer with the fog of a side', async ({ page }) => {
  await page.goto('/?replay=dev-fog');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '0');
  const view = page.getByRole('group', { name: 'View as' });
  const shoot = async (name: string, tick: string, withGray: boolean): Promise<void> => {
    await page.getByLabel('Position in the match').fill(tick);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', tick);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    if (!withGray) return;
    // A string: the spec has no DOM types (as replay.spec.ts does it).
    const gray = async (on: boolean): Promise<void> => {
      await page.evaluate(`document.documentElement.style.filter = '${on ? 'grayscale(1)' : ''}'`);
    };
    await gray(true);
    await page.screenshot({ path: join(OUT, `${name}-gray.png`) });
    await gray(false);
  };
  await view.getByRole('button', { name: 'Rusher' }).click();
  await shoot('replay-fog-p1', '460', true);
  await view.getByRole('button', { name: /Fog/ }).click();
  await shoot('replay-fog-p1-off', '460', false);
  await view.getByRole('button', { name: 'Both' }).click();
  await shoot('replay-fog-both', '460', false);
  await view.getByRole('button', { name: 'Reactive' }).click();
  await expect(view.getByRole('button', { name: /Fog/ })).toHaveAttribute('aria-pressed', 'false');
  await view.getByRole('button', { name: /Fog/ }).click();
  await shoot('replay-fog-p2', '520', true);
});

// #617: the replay over a baked background (`&bg=crossroads` under the dev sample) after the view
// switched (each switch rebuilds the scene): `replay-switch-p2.png`, `replay-switch-both.png` and
// their grey twins. Fails when the map is blank (it turned black) or the page throws.
test('shot of the replay viewer over a background after the view switches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?replay=dev-fog&bg=crossroads');
  const canvas = page.locator('.game-canvas');
  await expect(canvas).toHaveAttribute('data-tick', '0');
  await expect(canvas).toHaveAttribute('data-background', 'loaded');
  const view = page.getByRole('group', { name: 'View as' });
  const shoot = async (name: string): Promise<void> => {
    await expect(canvas).not.toHaveAttribute('data-background', 'pending');
    await page.mouse.move(5, 5);
    await expect.poll(() => mapVariance(page)).toBeGreaterThan(DRAWN_MAP_VARIANCE);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    await page.evaluate(`document.documentElement.style.filter = 'grayscale(1)'`);
    await page.screenshot({ path: join(OUT, `${name}-gray.png`) });
    await page.evaluate(`document.documentElement.style.filter = ''`);
  };
  await page.getByLabel('Position in the match').fill('460');
  await expect(canvas).toHaveAttribute('data-tick', '460');
  await view.getByRole('button', { name: 'Reactive' }).click();
  await view.getByRole('button', { name: 'Rusher' }).click();
  await view.getByRole('button', { name: 'Reactive' }).click();
  await shoot('replay-switch-p2');
  await view.getByRole('button', { name: 'Both' }).click();
  await shoot('replay-switch-both');
  expect(errors).toEqual([]);
});

// The split menu (S) on the selected own group (#593): `split.png` and `split-gray.png`.
test('shot of the split menu', async ({ page }) => {
  await page.goto('/?scene=snapshot_fog&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '300');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.mouse.click(335, 430);
  await page.waitForTimeout(300);
  await page.mouse.move(1000, 700);
  await page.keyboard.press('KeyS');
  await expect(page.getByRole('slider')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'split.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'split-gray.png') });
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

// The list of the groups of a city (#350): the scene `snapshot_clash` has three own groups in one
// city; a click on their icon opens one sector per group. `stack.png` and `stack-gray.png`.
test('shot of the list of the groups of a city (click on the icon of the stack)', async ({
  page,
}) => {
  await page.goto('/?scene=snapshot_clash&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  // Three own groups stand in the city in the middle: one click on their icon.
  await page.mouse.click(535, 418);
  // Away from the menu, so that no sector is lit and no tooltip covers it.
  await page.mouse.move(1000, 700);
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'stack.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'stack-gray.png') });
});

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
    // The hourglass glyph is a texture loaded on its own (E4, #627): give it a moment.
    await page.waitForTimeout(300);
    await page.locator('canvas').screenshot({ path: join(OUT, `eta-${shot.name}.png`) });
  });
}

// The still frame of the comet under "less motion" (H10, #627), in colour and in grey scale.
test('shot of the travel time of an order, less motion (artery-bend)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scene=artery&eta=6,8,310,7');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  await page.waitForTimeout(300);
  await page.locator('canvas').screenshot({ path: join(OUT, 'eta-artery-bend-still.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.locator('canvas').screenshot({ path: join(OUT, 'eta-artery-bend-still-gray.png') });
});

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

// A click on an enemy city (#535): it is not selected and not lit. The frozen scene `snapshot`, the click on
// the enemy city n3, the pointer moved away. `enemy-click.png`, the map alone; compare it with an own city
// without a group (n2, `own-click.png`), which is selected and lit.
for (const [name, at] of [
  ['enemy-click', { x: 812, y: 425 }],
  ['own-click', { x: 640, y: 597 }],
] as const) {
  test(`shot of a click on a city (${name})`, async ({ page }) => {
    await page.goto('/?scene=snapshot');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '120');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.mouse.click(at.x, at.y);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await page.locator('canvas').screenshot({ path: join(OUT, `${name}.png`) });
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
      page
        .locator(
          '.front svg.scene, .card, [role="alertdialog"], main.failure, main.loading, .crash',
        )
        .first(),
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

// The in-match status bars (#602, `/?scene=overflow&status=<state>`, src/dev/statusScenes.ts):
// `status-<id>.png` and the same in grey scale. `overflow` has two alerts at the top, so the shot
// shows that the bar does not stand on the alert stack.
for (const id of STATUS_SCENES) {
  test(`shot of the status bar ${id}`, async ({ page }) => {
    await page.goto(`/?scene=overflow&status=${id}`);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '120');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.mouse.move(5, 5);
    await page.screenshot({ path: join(OUT, `status-${id}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `status-${id}-gray.png`) });
  });
}

// The same bar on a phone (390 px): the buttons wrap under the words (`status-failed-390x700.png`).
test('shot of the status bar failed at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/?scene=overflow&status=failed');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '120');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: join(OUT, 'status-failed-390x700.png') });
});

// The password screen after a submit (#601): `screen-password-saved.png` (the confirmation) and
// `screen-password-mismatch.png` (the amber line), each with the grey-scale twin.
for (const outcome of ['saved', 'mismatch'] as const) {
  test(`shot of the password screen (${outcome})`, async ({ page }) => {
    await page.goto('/?menu=password-change');
    await expect(page.locator('.front .panel')).toBeVisible();
    await page.getByLabel('Current password').fill('old-password-123');
    await page.getByLabel('New password').fill('new-password-456');
    await page
      .getByLabel('Repeat the password')
      .fill(outcome === 'saved' ? 'new-password-456' : 'x');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole(outcome === 'saved' ? 'status' : 'alert').last()).toBeVisible();
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-password-${outcome}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `screen-password-${outcome}-gray.png`) });
  });
}

// The legal pages (#601): `legal-impressum.png` and `legal-privacy.png`, the same in grey scale.
for (const page of ['impressum', 'privacy'] as const) {
  test(`shot of the legal page ${page}`, async ({ page: tab }) => {
    await tab.goto(`/${page}`);
    await expect(tab.getByRole('heading', { level: 1 })).toBeVisible();
    await tab.mouse.move(1000, 700);
    await tab.screenshot({ path: join(OUT, `legal-${page}.png`) });
    await tab.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await tab.screenshot({ path: join(OUT, `legal-${page}-gray.png`) });
  });
}

// The menu picture by season (#474: the terrain takes the tint of the season of the date; the dev
// scenes pin one with `&season=`) and the still frame of "less motion" (one frame per state, no loop).
for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
  test(`shot of the menu picture in ${season}`, async ({ page }) => {
    await page.goto(`/?menu=menu-guest&season=${season}`);
    await expect(page.locator('.front svg.scene')).toBeVisible();
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-season-${season}.png`) });
  });
}

for (const id of ['queue-search', 'queue-found', 'queue-confirmed'] as const) {
  test(`shot of the screen ${id} with reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?menu=${id}`);
    await expect(page.locator('.front svg.scene')).toBeVisible();
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-${id}-reduced.png`) });
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

// The «Supply» view with the pipes (#429) in grey scale, at full size and at 60% of the map scale: the level (the bore),
// the flow (the fill, the dashes, the valve cap) and the cut-off city (hatching, dashed ring) must read without the hue.
// `supply-gray.png` and `supply-gray-60.png`, the map alone.
for (const [name, size] of [
  ['supply-gray', { width: 1280, height: 800 }],
  ['supply-gray-60', { width: 768, height: 480 }],
] as const) {
  test(`shot of the supply view in grey scale (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?scene=supply&menus');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.keyboard.press('Tab');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    await page.addStyleTag({
      content: '.hud { display: none !important; } canvas { filter: grayscale(1); }',
    });
    await page.locator('canvas').screenshot({ path: join(OUT, `${name}.png`) });
  });
}

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

// The planned orders (ODb "Low relief", #519) in grey scale at 60% of the map scale: the double outline and the ring in a ring at the
// tail of the opponent's ribbons, the open dashed ring on their targets, the dot at the tail and the dashed pill of the own ones must
// read without the hue. `intents-gray-60.png`, the map alone (the scene `orders`).
test('shot of the planned orders in grey scale at 60% scale', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 480 });
  await page.goto('/?scene=orders');
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

// The price of a capture (DEC-38, #580): `?capture=2&menus` turns on `capture.charge_cost = 1` and adds a `capture_failed`
// event at node 2 (its toast at the top right). Select the group, rest the pointer on node 2, a target the player does not
// own: the rule tip. `capture-tip.png` is the whole screen, `capture-tip-gray.png` the same in grey scale.
test('shot of the capture rule tip and the capture_failed toast', async ({ page }) => {
  await page.goto('/?scene=snapshot&capture=2&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '120');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.mouse.click(465, 415);
  await page.waitForTimeout(400);
  await page.mouse.move(640, 598);
  await page.mouse.move(641, 599);
  await expect(page.locator('[role="tooltip"]')).toBeVisible();
  await page.screenshot({ path: join(OUT, 'capture-tip.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'capture-tip-gray.png') });
});

// The match dialogs (#597). `help.png` (key ?), `exit.png` (the Exit button) and
// `transfer.png` (the Supply view, a city, "Transfer", an own destination city), each with a `-gray` twin, and
// `supply-hud-gray.png` (the Supply view banner in grey scale).
async function openScene(page: import('@playwright/test').Page, scene: string): Promise<void> {
  await page.goto(`/?scene=${scene}&menus`);
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.waitForTimeout(300);
}

async function shootBoth(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, `${name}-gray.png`) });
}

test('shot of the help sheet', async ({ page }) => {
  await openScene(page, 'snapshot_fog');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toBeVisible();
  await shootBoth(page, 'help');
});

// The whole page of the rules at once: a tall window, so the panel needs no scrolling.
test('shot of the whole How to play screen (CLI-13)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2300 });
  await page.goto('/?menu=howto');
  await expect(page.locator('.hw')).toBeVisible();
  await page.mouse.move(1000, 2200);
  await page.screenshot({ path: join(OUT, 'screen-howto-tall.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'screen-howto-tall-gray.png') });
});

test('shot of the How to play page inside the help sheet (CLI-13)', async ({ page }) => {
  await openScene(page, 'snapshot_fog');
  await page.keyboard.press('?');
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.locator('.hw')).toBeVisible();
  await shootBoth(page, 'help-howto');
});

test('shot of the forfeit dialog in the match', async ({ page }) => {
  await openScene(page, 'snapshot_fog');
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shootBoth(page, 'exit');
});

test('shot of the transfer dialog', async ({ page }) => {
  await page.goto('/?scene=supply&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.mouse.click(118, 520);
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(200);
  await page.mouse.click(533, 519);
  await expect(page.getByRole('dialog')).toBeVisible();
  await shootBoth(page, 'transfer');
});

test('shot of the supply banner in grey scale', async ({ page }) => {
  await page.goto('/?scene=supply&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.keyboard.press('Tab');
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'supply-hud-gray.png') });
});
