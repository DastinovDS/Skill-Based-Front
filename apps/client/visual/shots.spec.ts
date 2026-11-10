import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DRAWN_MAP_VARIANCE, columnLuminance, mapVariance } from './mapPixels.ts';
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

// The buildings in the replay (#905): `replay-buildings.png` the full view of both players,
// `replay-buildings-<side>.png` through the eyes of each side with the fog on (only what that side
// saw of the enemy's buildings), at tick 900 of the dev sample, and `-early` at tick 300.
test('shot of the replay viewer with buildings', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?replay=dev-buildings');
  const canvas = page.locator('.game-canvas');
  await expect(canvas).toHaveAttribute('data-tick', '0');
  const seek = async (tick: number): Promise<void> => {
    await page.getByLabel('Position in the match').fill(String(tick));
    await expect(canvas).toHaveAttribute('data-tick', String(tick));
    await page.waitForTimeout(400);
  };
  const view = page.getByRole('group', { name: 'View as' });
  await seek(300);
  await page.screenshot({ path: join(OUT, 'replay-buildings-early.png') });
  await seek(900);
  await page.screenshot({ path: join(OUT, 'replay-buildings.png') });
  for (const [nick, file] of [
    ['Ember', 'ember'],
    ['Bot (normal)', 'bot'],
  ] as const) {
    await view.getByRole('button', { name: nick, exact: true }).click();
    const fog = view.getByRole('button', { name: 'Fog' });
    if ((await fog.getAttribute('aria-pressed')) !== 'true') await fog.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `replay-buildings-${file}.png`) });
  }
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

// The recruit rally point (DEC-48, item K7, #896): on the scene `group_order` the menu of Ford
// offers "Rally point" with the walk price, the pick shows the faint muster ring on Forkway; Stonegate,
// which has its point, offers "Clear rally point".
test('shot of the rally point menu, its pick and its clearing', async ({ page }) => {
  await page.goto('/?scene=group_order&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.mouse.click(557, 707);
  await page.mouse.move(1000, 700);
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'menu-rally.png') });
  await page.keyboard.press('KeyP');
  await page.mouse.move(533, 519);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'rally-pick.png') });
  await page.keyboard.press('Escape');
  await page.mouse.click(120, 519);
  await page.mouse.move(1000, 700);
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'menu-rally-clear.png') });
});

// No retreat from a fight (DEC-40, #880): the group menu of an own group in a fight, under
// `combat.retreat = "none"` (the Cancel sector is off and says why) and under `"round"` (as before).
for (const retreat of ['none', 'round'] as const) {
  test(`shot of the group menu in a fight, retreat ${retreat}`, async ({ page }) => {
    await page.goto(`/?scene=fights&menus&retreat=${retreat}`);
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.mouse.click(233, 420);
    await page.waitForTimeout(300);
    await page.mouse.click(233, 420);
    await page.mouse.move(1000, 700);
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `menu-group-fight-${retreat}.png`) });
  });
}

// DEC-41, #649, the frozen scene `economy`: the menu of an own city with the factory priced in
// charges (Ford), the menu of a group whose plan gathers (Watchhouse: the release and the plan bar)
// and the plan bar with the requested bonus (a group in Watchpost). `v2-<name>.png` and grey.
const V2_SHOTS = ['city', 'group', 'plan'] as const;

for (const name of V2_SHOTS) {
  test(`shot of the economy controls (${name})`, async ({ page }) => {
    await page.goto('/?scene=economy&menus');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    switch (name) {
      case 'city':
        await page.mouse.click(557, 708);
        break;
      case 'group':
        await page.mouse.click(557, 328);
        await page.waitForTimeout(300);
        await page.mouse.click(557, 328);
        break;
      case 'plan':
        await page.mouse.click(332, 518);
        break;
    }
    await page.mouse.move(1000, 700);
    if (name === 'city' || name === 'group') {
      await expect(page.locator('[role="menu"]')).toBeVisible();
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `v2-${name}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `v2-${name}-gray.png`) });
  });
}

// The road fortifications (#858), the frozen scene `forts`, Ford: its city menu with "Fortify road"
// and the icon Wall on the road (`fort-menu.png`), then the pick: a ghost wall on every road it can
// fortify, the pointer on the road to Forkway lights that one with its price (`fort-pick.png`).
test('shot of the fortify menu and the pick', async ({ page }) => {
  await page.goto('/?scene=forts&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.mouse.click(557, 708);
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'fort-menu.png') });
  await page.locator('[data-icon="fortify"]').click();
  await page.mouse.move(553, 650);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'fort-pick.png') });
});

// A group whose plan gathers its bonus (#811), the frozen scene `economy`, Watchhouse: selected (no
// banner at the foot of the screen any more) and under the pointer (the tooltip has the charges
// only). `plan-select.png` and `plan-hover.png`.
for (const name of ['select', 'hover'] as const) {
  test(`shot of the gathering plan (${name})`, async ({ page }) => {
    await page.goto('/?scene=economy&menus');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    if (name === 'select') {
      await page.mouse.click(557, 328);
      await page.mouse.move(1000, 700);
    } else {
      await page.mouse.move(557, 328);
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `plan-${name}.png`) });
  });
}

// The tip over a group has its whole frame once the Burin reveal is over (#869: the mask of the cut
// ended a tenth of the tag short of its left edge, so the left rule was never drawn), at a device
// pixel ratio of 1 and 2: `tip-unit-1x.png`, `tip-unit-2x.png` (the tag and a 4 px margin). The left
// rule must be about as bright as the right one in the middle of the sides.
for (const dpr of [1, 2] as const) {
  test.describe(`the tip at ${String(dpr)}x`, () => {
    test.use({ deviceScaleFactor: dpr });
    test(`shot of the unit tip with its whole frame (${String(dpr)}x)`, async ({ page }) => {
      await page.goto('/?scene=economy&menus');
      await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
      await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
      await page.mouse.move(556, 327);
      await page.mouse.move(557, 328);
      const plate = page.locator('[role="tooltip"] > .plate');
      await expect(plate).toBeVisible();
      await page.waitForTimeout(800);
      const box = await plate.boundingBox();
      if (box === null) throw new Error('no tip');
      const m = 4;
      const clip = {
        x: box.x - m,
        y: box.y - m,
        width: box.width + 2 * m,
        height: box.height + 2 * m,
      };
      await page.screenshot({ path: join(OUT, `tip-unit-${String(dpr)}x.png`), clip });
      const columns = await columnLuminance(page, clip);
      // The brightest column within a css px or two of each side of the tag.
      const peak = (from: number, to: number): number =>
        Math.max(...columns.slice(Math.floor(from * dpr), Math.ceil(to * dpr)));
      const left = peak(m - 1, m + 2);
      const right = peak(m + box.width - 2, m + box.width + 1);
      expect(right).toBeGreaterThan(60);
      expect(left).toBeGreaterThan(right * 0.7);
    });
  });
}

// The supply flow (DEC-43, #705, #728), the frozen scene `flow_supply` on the «Supply» layer (Tab): the
// pointer on the capital shows nothing of its own (the countdown ring, the downstream chain and the
// click-to-pin were removed, #728): `flow-hover-capital.png` and grey.
test('shot of the Supply layer with the pointer on a city (flow-hover-capital)', async ({
  page,
}) => {
  await page.goto('/?scene=flow_supply&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.keyboard.press('Tab');
  await page.mouse.move(118, 518);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'flow-hover-capital.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'flow-hover-capital-gray.png') });
});

// Stances of economy v2 (DEC-44, #772), the frozen scene `stances` under the rules of `mvp-4-stances`:
// `menu-stances.png` and its `-gray` twin, the `Q` menu with the rates and the note on the carried progress.
test('shot of the stance menu under economy v2 (Q key)', async ({ page }) => {
  await page.goto('/?scene=stances&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(80);
  await page.keyboard.up('KeyQ');
  await page.mouse.move(1000, 700);
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'menu-stances.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'menu-stances-gray.png') });
});

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

// The capture of a city, "Fitted" (#819, ui-style 49): `?flood=<ms>,<node>:<owner before>` holds a
// capture under way on a frozen scene at that age. `capture-<case>-<ms>.png` is the map alone: own
// (artery, Forkway taken from the enemy) frame by frame, the enemy's (calmer), two at once, one in
// the fog, one on a map with a geography (non-convex areas), "less motion", and grey scale. No references.
const CAPTURES = [
  ...[0, 150, 300, 500, 700, 900, 1200].map((ms) => ({
    name: 'own',
    scene: 'artery',
    tick: 2400,
    nodes: '4:1',
    ms,
  })),
  ...[300, 600].map((ms) => ({ name: 'enemy', scene: 'artery', tick: 2400, nodes: '5:0', ms })),
  { name: 'two', scene: 'artery', tick: 2400, nodes: '4:1,5:0', ms: 400 },
  { name: 'fog', scene: 'artery', tick: 2400, nodes: '20:0', ms: 400 },
  ...[250, 550].map((ms) => ({ name: 'geo', scene: 'forts_geo', tick: 1200, nodes: '7:1', ms })),
] as const;

for (const shot of CAPTURES) {
  test(`shot of a capture under way (${shot.name}, ${String(shot.ms)} ms)`, async ({ page }) => {
    await page.goto(`/?scene=${shot.scene}&flood=${String(shot.ms)},${shot.nodes}`);
    // The frame is as old as the flood: 10 ticks a second.
    const tick = String(shot.tick + shot.ms / 100);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', tick);
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await page.mouse.move(5, 5);
    // The city body flips over 120 ms of real time.
    await page.waitForTimeout(400);
    await page
      .locator('canvas')
      .screenshot({ path: join(OUT, `capture-${shot.name}-${String(shot.ms)}.png`) });
    if (shot.name === 'own' && shot.ms === 300) {
      await page.evaluate(`document.documentElement.style.filter = 'grayscale(1)'`);
      await page.locator('canvas').screenshot({ path: join(OUT, 'capture-own-300-gray.png') });
    }
  });
}

test('shot of a capture under way with less motion (own, 100 ms)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scene=artery&flood=100,4:1');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2401');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.locator('canvas').screenshot({ path: join(OUT, 'capture-reduced-100.png') });
});

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
          '.front .backdrop[data-map="ready"], .card, [role="alertdialog"], main.failure, main.loading, .crash, .specimen',
        )
        .first(),
    ).toBeVisible();
    // The self-hosted fonts (#841) swap in when loaded: take the frame in them, not the fallback.
    await page.evaluate('document.fonts.ready.then(() => true)');
    // The opening scene draws its frozen frame once the fonts are in (#826).
    if (id === 'welcome-intro') await expect(page.locator('[data-intro="frozen"]')).toHaveCount(1);
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
    await expect(page.locator('.front .backdrop[data-map="ready"]')).toBeVisible();
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-season-${season}.png`) });
  });
}

for (const id of ['queue-search', 'queue-found', 'queue-confirmed'] as const) {
  test(`shot of the screen ${id} with reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?menu=${id}`);
    await expect(page.locator('.front .backdrop[data-map="ready"]')).toBeVisible();
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-${id}-reduced.png`) });
  });
}

// The loop of captures behind the menus (#866), the picture frozen at seconds of its clock
// (`/?menu=<id>&bt=<s>`): `screen-capture-<id>-<s>.png`. The main menu's first capture (Raven Rise
// taken from Amber Common) sets out at 1 s: the gate and the glance (3.6), the last shot (5.4), the
// walk in (5.6), the flood (6.0, 6.4), the flag (7.2); its loop turns at 48 s (47.6 to 48.4: no jump
// at the seam). The entry's first capture (Long Meadow from Millbrook) floods from 5.7 s.
for (const [id, at] of [
  ...['3.6', '5.4', '5.6', '6.0', '6.4', '7.2', '47.6', '47.8', '48.0', '48.2', '48.4'].map(
    (s) => ['menu-guest', s] as const,
  ),
  ...['3.6', '6.0', '6.4'].map((s) => ['welcome', s] as const),
]) {
  test(`shot of the capture loop of ${id} at ${at} s`, async ({ page }) => {
    await page.goto(`/?menu=${id}&bt=${at}`);
    await expect(page.locator('.front .backdrop[data-map="ready"]')).toBeVisible();
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-capture-${id}-${at}.png`) });
  });
}

// The opening scene of the entry screen (#826, intro B Grain), frozen at moments of its timeline
// (`/?menu=welcome-intro&t=<s>`): `screen-intro-<s>.png`, the fights at the edges (#839), letters
// forming, the rule, the rise.
for (const at of ['0.9', '1.6', '2.4', '3.2', '4.2', '5.4', '6.6', '7.2']) {
  test(`shot of the opening scene at ${at} s`, async ({ page }) => {
    await page.goto(`/?menu=welcome-intro&t=${at}`);
    await expect(page.locator('[data-intro="frozen"]')).toHaveCount(1);
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-intro-${at}.png`) });
  });
}

// The scene played live (`/?menu=welcome&intro`): it runs, a key skips it to the still screen with
// the nick field focused, a reload in the same session does not play it again, reduced motion never.
test('the opening scene plays, skips by a key and plays once a session', async ({ page }) => {
  await page.goto('/?menu=welcome&intro');
  await expect(page.locator('[data-intro="playing"]')).toHaveCount(1);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(OUT, 'screen-intro-live.png') });
  await page.keyboard.press('Shift');
  await expect(page.locator('.welcome.intro')).toHaveCount(0);
  await expect(page.getByLabel('Your nick')).toBeFocused();
  await expect(page.locator('h1')).toHaveText('Fines Imperii');
  await page.reload();
  await expect(page.locator('.front .backdrop[data-map="ready"]')).toBeVisible();
  await expect(page.locator('.welcome.intro')).toHaveCount(0);
});

test('the opening scene plays to its end, and never under reduced motion', async ({ page }) => {
  await page.goto('/?menu=welcome&intro');
  await expect(page.locator('[data-intro="playing"]')).toHaveCount(1);
  await expect(page.locator('.welcome.intro')).toHaveCount(0, { timeout: 12000 });
  await page.mouse.move(1000, 700);
  await page.screenshot({ path: join(OUT, 'screen-intro-end.png') });
  const other = await page.context().browser()?.newPage({ reducedMotion: 'reduce' });
  if (other === undefined) return;
  await other.goto(page.url());
  await expect(other.locator('.front .backdrop[data-map="ready"]')).toBeVisible();
  await expect(other.locator('.welcome.intro')).toHaveCount(0);
  await other.close();
});

// The log-in and the new-account sheets of the entry screen (#845): `screen-welcome-login.png`,
// `screen-welcome-register.png`, each with the grey-scale twin.
for (const [name, link] of [
  ['login', 'Log in'],
  ['register', 'Create account'],
] as const) {
  test(`shot of the entry sheet ${name}`, async ({ page }) => {
    await page.goto('/?menu=welcome');
    await page.evaluate('document.fonts.ready.then(() => true)');
    await page.getByRole('button', { name: link, exact: true }).click();
    await expect(page.locator('form.sheet')).toBeVisible();
    await page.mouse.move(1000, 700);
    await page.screenshot({ path: join(OUT, `screen-welcome-${name}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `screen-welcome-${name}-gray.png`) });
  });
}

// The account menu (`screen-account-menu.png`), then the log-out dialog of a guest without a
// password on the blurred stone (#845, `screen-account-logout.png` and grey).
test('shot of the account menu and the log-out dialog', async ({ page }) => {
  await page.goto('/?menu=menu-guest');
  await page.evaluate('document.fonts.ready.then(() => true)');
  await page.locator('button.who').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.move(600, 700);
  await page.screenshot({ path: join(OUT, 'screen-account-menu.png') });
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.mouse.move(1000, 700);
  await page.screenshot({ path: join(OUT, 'screen-account-logout.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'screen-account-logout-gray.png') });
});

// The nick change of the profile (#871): the dialog with a taken nick (`screen-profile-nick.png`),
// and the settings at the 125 % interface scale (`screen-settings-125.png`, chosen on the page).
test('shot of the nick dialog and of the interface scale', async ({ page }) => {
  await page.goto('/?menu=profile-nick');
  await page.evaluate('document.fonts.ready.then(() => true)');
  await page.getByRole('button', { name: 'Change the nick' }).click();
  const field = page.getByRole('textbox', { name: 'New nick' });
  await expect(field).toBeFocused();
  await field.fill('Vega');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.mouse.move(1000, 700);
  await page.screenshot({ path: join(OUT, 'screen-profile-nick.png') });

  await page.goto('/?menu=settings');
  await page.evaluate('document.fonts.ready.then(() => true)');
  await page.getByRole('radio', { name: '125%' }).click();
  await expect(page.getByRole('radio', { name: '125%' })).toHaveAttribute('aria-checked', 'true');
  await page.mouse.move(1000, 700);
  await page.screenshot({ path: join(OUT, 'screen-settings-125.png') });
  // Back to 100 % for the next shots of this browser context.
  await page.getByRole('radio', { name: '100%' }).click();
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
      await expect(page.locator('.front .backdrop[data-map="ready"]')).toBeVisible();
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

// The «Supply» view with the canals (#858) in grey scale, at full size and at 60% of the map scale: the canals, the
// level rings, the starving signs and the pocket (hatching) must read without the hue.
// `supply-gray.png` and `supply-gray-60.png`, the map alone.
for (const [name, size] of [
  ['supply-gray', { width: 1280, height: 800 }],
  ['supply-gray-60', { width: 768, height: 480 }],
] as const) {
  test(`shot of the supply view in grey scale (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?scene=flow_supply&menus');
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
  // The tag comes in by the Burin reveal (about 550 ms, #860): shoot it whole.
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'split-hint.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'split-hint-gray.png') });
});

// The cue of `X` with nothing selected (#764), pinned by `?undo` to a frozen scene (it has no server
// to accept an undo), `undo-<name>.png` and grey: `move` (the order of a group on a road: the arrow
// runs back into the group), `recruit` (a city), `empty` (nothing to undo: the sign at the pointer).
const UNDO_SHOTS = [
  { name: 'move', param: 'group,9f2c4a7e1b3d5f60,2' },
  { name: 'recruit', param: 'node,0' },
  { name: 'empty', param: 'empty' },
] as const;

for (const shot of UNDO_SHOTS) {
  test(`shot of the undo cue: ${shot.name}`, async ({ page }) => {
    await page.goto(`/?scene=snapshot&undo=${shot.param}`);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '120');
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.mouse.move(640, 400);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `undo-${shot.name}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `undo-${shot.name}-gray.png`) });
  });
}

// The UX batch of the 2026-11-05 playtest (#762), `ux-<name>.png` and grey:
// - `hover-city`, `hover-group`: the pointer on the area of an own city, on an own group (scene `snapshot`);
// - `hover-target`: a group selected, the pointer on the area of an enemy city (the target is lit);
// - `split-tip`, `split-menu`: `?split=2,1` answers the `reach` with node 2 and the size 1 that fits; the
//   tip says a click splits, the click opens the split menu at that size ("Split and send");
// - `plan-shift`: scene `economy` (economy v2), a group selected, Shift held over a target: the plan bar stands out;
//   `?reach=7,140,6` answers the `reach` with Bluff by Wood Hollow, so the ghost of the planned order and
//   the bonus counter over Bluff show (#793), and one wheel notch raises the bonus;
// - `cp-hover`, `cp-cut`: `?cp=50` (less than a move) and `?reject=NOT_ENOUGH_CP`: the CP badge is marked
//   over a target, the click leaves the cut-off arrow.
const UX_SHOTS = [
  'hover-city',
  'hover-group',
  'hover-target',
  'split-tip',
  'split-menu',
  'plan-shift',
  'cp-hover',
  'cp-cut',
] as const;

for (const name of UX_SHOTS) {
  test(`shot of the playtest batch (${name})`, async ({ page }) => {
    const economy = name === 'plan-shift' || name.startsWith('cp-');
    const query = economy
      ? `scene=economy&menus${name.startsWith('cp-') ? '&cp=50&reject=NOT_ENOUGH_CP' : '&reach=7,140,6'}`
      : `scene=snapshot&menus${name.startsWith('split-') ? '&split=2,1' : ''}`;
    await page.goto(`/?${query}`);
    await expect(page.locator('.game-canvas')).toHaveAttribute(
      'data-tick',
      economy ? '2400' : '120',
    );
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    switch (name) {
      case 'hover-city':
        await page.mouse.move(380, 430);
        await page.mouse.move(381, 431);
        break;
      case 'hover-group':
        await page.mouse.move(640, 245);
        await page.mouse.move(641, 246);
        break;
      case 'hover-target':
        await page.mouse.click(640, 245);
        await page.waitForTimeout(300);
        await page.mouse.move(880, 430);
        await page.mouse.move(881, 431);
        break;
      case 'split-tip':
      case 'split-menu':
        await page.mouse.click(640, 245);
        await page.waitForTimeout(400);
        await page.mouse.move(640, 598);
        await page.mouse.move(641, 599);
        await expect(page.locator('[role="tooltip"]')).toBeVisible();
        // The tag comes in by the Burin reveal (about 550 ms, #860): shoot it whole.
        await page.waitForTimeout(700);
        if (name === 'split-menu') {
          await page.mouse.click(641, 599);
          await page.mouse.move(1000, 700);
        }
        break;
      case 'plan-shift':
        await page.mouse.click(332, 518);
        await page.waitForTimeout(300);
        await page.keyboard.down('Shift');
        await page.mouse.move(485, 160);
        await page.mouse.move(486, 161);
        await page.mouse.wheel(0, -100);
        break;
      case 'cp-hover':
      case 'cp-cut':
        await page.mouse.click(332, 518);
        await page.waitForTimeout(300);
        await page.mouse.move(485, 160);
        await page.mouse.move(486, 161);
        if (name === 'cp-cut') {
          await page.mouse.click(486, 161);
          await page.mouse.move(1000, 700);
        }
        break;
    }
    await page.waitForTimeout(name === 'cp-cut' ? 600 : 400);
    await page.screenshot({ path: join(OUT, `ux-${name}.png`) });
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await page.screenshot({ path: join(OUT, `ux-${name}-gray.png`) });
    if (name === 'plan-shift') await page.keyboard.up('Shift');
  });
}

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
  // The tag comes in by the Burin reveal (about 550 ms, #860): shoot it whole.
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'capture-tip.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'capture-tip-gray.png') });
});

// The match dialogs (#597). `help.png` (key ?) and `exit.png` (the Exit button), each with a `-gray` twin, and
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

// A tall window: the whole help sheet, its bottom (the sound volume) included, without scrolling.
test('shot of the whole help sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openScene(page, 'snapshot_fog');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: join(OUT, 'help-tall.png') });
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

test('shot of the supply banner in grey scale', async ({ page }) => {
  await page.goto('/?scene=flow_supply&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.keyboard.press('Tab');
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.screenshot({ path: join(OUT, 'supply-hud-gray.png') });
});

// The selection and the hover outline beside a badge (#797): Watchpost's group (plains, chevrons
// down) selected, the pointer on Stonegate's group (mountains, chevrons up); the badges are drawn
// over both outlines. `badge-outline-zoom.png` is the strip of both, magnified by the device scale.
test('shot of the outlines over a group with a badge', async ({ page }) => {
  await page.goto('/?scene=badges&menus');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.mouse.click(330, 520);
  await page.waitForTimeout(300);
  await page.mouse.move(116, 516);
  await page.mouse.move(117, 517);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'badge-outline.png') });
  await page.screenshot({
    path: join(OUT, 'badge-outline-zoom.png'),
    clip: { x: 60, y: 460, width: 340, height: 120 },
  });
});

// The map treatment under zoom (#842, #829 round 2): the Border band and the Ruled veil keep their
// screen pitch in zoom buckets of a power of two, the lines in between fading in towards the next
// bucket, and no stroke thinner than one device pixel. `zoom-<n>.png`: the scene `forts_geo`, the
// map alone, zoomed by the wheel in even steps (about 1.25x a step, from far out to close in), so
// neighbouring frames can be compared for a jump.
test('shot of the map treatment at a run of zooms', async ({ page }) => {
  await page.goto('/?scene=forts_geo');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '1200');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55);
  // Far out first (the camera's minimum), then in by about 1.25x a step.
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  for (let step = 0; step < 12; step++) {
    const name = `zoom-${String(step).padStart(2, '0')}.png`;
    await page.locator('canvas').screenshot({ path: join(OUT, name) });
    await page.mouse.wheel(0, -112);
    await page.waitForTimeout(700);
  }
});

// The Engraved pieces close up (#847): the scene `economy` (economy v2) zoomed in on Watchpost and
// Forkway: the helmets, the city bodies and rings, the warehouse lozenges, the towers on the ring and
// the Crown arc of the factory Forkway is paying for (`pieces-close.png`; `pieces-gray.png` in grey
// scale; `pieces-far.png` zoomed out: the towers keep their screen size).
test('shot of the Engraved pieces close up', async ({ page }) => {
  await page.goto('/?scene=economy');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '2400');
  await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  await page.mouse.move(430, 520);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -112);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(800);
  await page.locator('canvas').screenshot({ path: join(OUT, 'pieces-close.png') });
  await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await page.locator('canvas').screenshot({ path: join(OUT, 'pieces-gray.png') });
  await page.addStyleTag({ content: 'html { filter: none; }' });
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(800);
  await page.locator('canvas').screenshot({ path: join(OUT, 'pieces-far.png') });
});

// Parry and Walk in (#856): the scenes `walk_fight` (a fight in a city: its attacker at the gate, the
// plains burning a charge of the defender, then a bonus shot hitting) and `walk_capture` (the same round
// ended the fight with the capture: the winner walks from the gate into the city once its shot has
// landed), frozen at a run of render ticks (`?at=`). `parry-<tick>.png` and `walk-<tick>.png`, the map
// alone; `parry-pair-<tick>.png`: the scene `walk_pair` (the round a pair that met: a bonus shot
// against a real one).
const MOMENTS = [
  ...[400.5, 401.5, 402.5, 403.5, 404.5, 406].map((at) => ({
    scene: 'walk_fight',
    name: 'parry',
    at,
  })),
  ...[402, 406.5, 408, 409.5, 411, 413].map((at) => ({ scene: 'walk_capture', name: 'walk', at })),
  ...[401, 402, 403, 404.5, 406, 408].map((at) => ({ scene: 'walk_pair', name: 'parry-pair', at })),
] as const;
for (const shot of MOMENTS) {
  test(`shot of ${shot.name} at tick ${String(shot.at)}`, async ({ page }) => {
    await page.goto(`/?scene=${shot.scene}&at=${String(shot.at)}`);
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', String(shot.at));
    await expect(page.locator('.game-canvas')).not.toHaveAttribute('data-background', 'pending');
    await page.addStyleTag({ content: '.hud { display: none !important; }' });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await page
      .locator('canvas')
      .screenshot({ path: join(OUT, `${shot.name}-${String(shot.at)}.png`) });
  });
}
