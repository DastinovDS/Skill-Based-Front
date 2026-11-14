import { expect, test, type Page } from '@playwright/test';
import type { MapFile } from '../../apps/client/src/protocol.gen.ts';
import { nick } from '../support/match.ts';
import { Player } from '../support/player.ts';

// The tutorial (#806, docs/design/tutorial.md): the entry popup of a new guest, the intro of
// chapter I, the chapter played by its cards to the result (Seal), a reload in the middle returning
// to the chapter, and the chapter select. `TUTORIAL_SHOTS=<dir>` also writes the key screens there.
const SHOTS = process.env['TUTORIAL_SHOTS'];

async function shot(page: Page, name: string, settle = 900): Promise<void> {
  if (SHOTS === undefined) return;
  // Let the cards and marks finish their entrance (the burin, the leader).
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** The card on screen says `text`. */
async function card(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('.coach .plate')).toContainText(text, { timeout: 30_000 });
}

/** The group standing in `from` to `to`: select it, then click the place. */
async function march(player: Player, map: MapFile, from: string, to: string): Promise<void> {
  const id = (name: string): number => {
    const node = map.nodes.find((n) => n.name === name);
    if (node === undefined) throw new Error(name);
    return node.id;
  };
  await player.clickNode(map, id(from));
  await expect(player.page.locator('.hud')).toHaveAttribute('data-selection', /^group:/);
  await player.clickNode(map, id(to));
}

test('a new guest: the popup, chapter I to its result, a reload in the middle', async ({
  browser,
  baseURL,
}) => {
  const player = await Player.create(browser, baseURL ?? '', nick('tut'), { tutorialOffer: true });
  const { page } = player;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await player.enter();

  // The entry popup offers the tutorial; nothing is forced.
  const popup = page.getByRole('dialog', { name: 'New to the game?' });
  await expect(popup).toBeVisible();
  await shot(page, '01-popup');
  await popup.getByRole('button', { name: 'Start the tutorial' }).click();

  // The intro of chapter I (Sheet).
  await expect(page.getByRole('heading', { name: 'Units and movement' })).toBeVisible();
  await expect(page.getByText('Tutorial · Chapter I of V')).toBeVisible();
  await shot(page, '02-sheet');
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // The chapter: no start banner, the first card waits for the army to be selected.
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', /^\d+$/, {
    timeout: 60_000,
  });
  const response = await page.request.get('/api/maps/tut-move');
  const map = (await response.json()) as MapFile;
  await card(page, 'This is your army');
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  await expect(page.getByText('You are')).toHaveCount(0);
  // Chapter I shows no CP, no VP and no clock (section 4.9).
  await expect(page.locator('[data-coach="cp"]')).toHaveCount(0);
  await expect(page.locator('[data-coach="vp"]')).toHaveCount(0);
  await expect(page.locator('[data-coach="clock"]')).toHaveCount(0);
  await shot(page, '03-card-compass-paused');

  // I.1 -> I.2 (a selection) -> the march to Ashford -> I.3 (Continue).
  await player.clickNode(map, 0);
  await card(page, 'To march');
  await shot(page, '04-card-selected');
  // A click on a place the beat does not allow does nothing: the group stays selected.
  const reedwick = map.nodes.find((n) => n.name === 'Reedwick');
  if (reedwick === undefined) throw new Error('Reedwick');
  await player.clickNode(map, reedwick.id);
  await expect(page.locator('.hud')).toHaveAttribute('data-selection', /^group:/);
  const ashford = map.nodes.find((n) => n.name === 'Ashford');
  if (ashford === undefined) throw new Error('Ashford');
  await player.clickNode(map, ashford.id);
  await card(page, 'capacity');
  await shot(page, '05-card-continue');
  await page.getByRole('button', { name: 'Continue' }).click();
  await card(page, 'Every capture costs');
  await page.getByRole('button', { name: 'Continue' }).click();
  await card(page, 'Next, take Elmstead');
  await march(player, map, 'Ashford', 'Elmstead');
  await card(page, 'You see only the places next to your groups');
  await page.getByRole('button', { name: 'Continue' }).click();
  await card(page, 'Terrain sets your speed');
  // The marks in turn: one pass of 2 s a terrain, then all three stay with their labels.
  await page.waitForTimeout(6500);
  await shot(page, '06-card-turns');

  // A reload in the middle of the chapter returns to it, at its card.
  await page.reload();
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', /^\d+$/, {
    timeout: 60_000,
  });
  await card(page, 'Terrain sets your speed');
  await march(player, map, 'Elmstead', 'Fordham');

  // The goal: the result (Seal) over the last frame, two buttons.
  const seal = page.getByRole('dialog').filter({ hasText: 'Complete' });
  await expect(seal).toBeVisible({ timeout: 60_000 });
  await expect(seal).toContainText('A capture costs one charge.');
  await expect(seal.getByRole('button')).toHaveText(['All chapters', 'Replay chapter']);
  await shot(page, '07-seal');
  await seal.getByRole('button', { name: 'All chapters' }).click();

  // The chapter select: chapter I done, II next.
  await expect(
    page.getByRole('radio', { name: /Chapter I: Units and movement, Done/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: /Chapter II: Map and economy, Next/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await shot(page, '08-charter-after-I');
  // The server recorded the chapter itself, and a reload shows it from the account.
  await expect.poll(async () => (await progress(page))['done']).toEqual(['units']);
  expect(errors).toEqual([]);
  await player.close();
});

test('the chapter select in progress, the slides of IV.2 and leaving a chapter', async ({
  browser,
  baseURL,
}) => {
  const player = await Player.create(browser, baseURL ?? '', nick('tut4'));
  const { page } = player;
  await player.enter();
  await expect(page.getByRole('radio', { name: 'Invite a friend' })).toBeVisible();
  await showDone(page, ['units', 'economy', 'building']);
  await page.reload();
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(
    page.getByRole('radio', { name: /Chapter IV: Attack and fight, Next/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Chapter V: Defence, After IV/ })).toBeVisible();
  await shot(page, '09-charter-progress');
  await page.getByRole('radio', { name: /Chapter V: Defence/ }).click();
  await expect(page.getByText('Opens after Attack and fight.')).toBeVisible();
  await shot(page, '10-charter-locked');
  await page.getByRole('radio', { name: /Chapter IV/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Attack and fight' })).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await card(page, 'every charge your units hold is a shot');
  await page.getByRole('button', { name: 'Continue' }).click();
  await card(page, 'Count on two');
  await expect(page.locator('.coach .plate')).toContainText('1 of 3');
  await shot(page, '11-slides-1');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await card(page, 'Your 3 units hold 3 charges');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await card(page, 'no charge left');
  await expect(page.locator('.coach .plate')).toContainText('Click on your group in Fernhold');
  await shot(page, '12-slides-3');

  // Leaving a chapter loses nothing: the chapter select.
  await page.getByRole('button', { name: 'Exit', exact: true }).click();
  const leave = page.getByRole('alertdialog', { name: 'Leave the chapter?' });
  await expect(leave).toContainText('It will start over.');
  await shot(page, '13-leave');
  await leave.getByRole('button', { name: 'Leave the chapter' }).click();
  await expect(page.getByRole('radio', { name: /Chapter IV: Attack and fight, Next/ })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await player.close();
});

/**
 * Shows the account with `done` chapters finished. Chapters are the server's to record and a test
 * cannot reach one without playing it, so the `GET /api/me/tutorial` answer is patched in the
 * browser (the server does not check the lock of the chapter select); the next reload applies it.
 */
async function showDone(page: Page, done: string[]): Promise<void> {
  await page.route('**/api/me/tutorial', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const real = await route.fetch();
    const body = (await real.json()) as Record<string, unknown>;
    return route.fulfill({ response: real, json: { ...body, done } });
  });
}

/** The tutorial progress of the account (`GET /api/me/tutorial`, snake_case). */
async function progress(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const guest = JSON.parse(window.localStorage.getItem('sbf.guest') ?? '{}') as { token: string };
    const response = await fetch('/api/me/tutorial', {
      headers: { Authorization: `Bearer ${guest.token}` },
    });
    return (await response.json()) as Record<string, unknown>;
  });
}

/** Writes the flags of the account's progress, the others as they are (`PUT /api/me/tutorial`). */
async function putProgress(page: Page, patch: Record<string, unknown>): Promise<void> {
  const current = await progress(page);
  await page.evaluate(
    async ({ current, patch }) => {
      const guest = JSON.parse(window.localStorage.getItem('sbf.guest') ?? '{}') as {
        token: string;
      };
      const { done: _done, ...flags } = current;
      const response = await fetch('/api/me/tutorial', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${guest.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...flags, ...patch }),
      });
      if (!response.ok) throw new Error(`PUT /api/me/tutorial ${String(response.status)}`);
    },
    { current, patch },
  );
}

test('the rules from the chapter select, and the first match with its hints across a reload', async ({
  browser,
  baseURL,
}) => {
  const player = await Player.create(browser, baseURL ?? '', nick('tutfm'));
  const { page } = player;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await player.enter();
  await page.getByRole('button', { name: 'How to play' }).click();

  // The rules reference: short sections, the numbers of the main ruleset from the server.
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CP and supply' })).toBeVisible();
  await expect(page.getByText(/In Balance, CP come [\d.]+ every [\d.]+ s/)).toBeVisible();
  await shot(page, '14-rules');
  await page.getByRole('button', { name: 'Back to chapters' }).click();

  // The first match from the chapter select: an easy bot, the hints on.
  await page.getByRole('button', { name: 'First match' }).click();
  await player.expectPlaying();
  const hint = page.locator('.hints .plate');
  await expect(hint).toContainText('Bigger maps run faster', { timeout: 30_000 });
  await expect(hint).toContainText('Turn off hints');
  // The card is placed and cut in (the burin) before it is shot.
  await expect(page.locator('.hints .plate.placed')).toBeVisible();
  await hint.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await shot(page, '15-hint-H1');
  await hint.getByRole('button', { name: 'Close the hint' }).click();
  await expect(hint).toHaveCount(0);
  await expect.poll(async () => (await progress(page))['hints']).toEqual(['H1']);
  expect(typeof (await progress(page))['first_match_id']).toBe('string');

  // A reload returns to the first match with its hints: with H1 forgotten, it shows again.
  await putProgress(page, { hints: [] });
  await page.reload();
  await player.expectPlaying();
  await expect(hint).toContainText('Bigger maps run faster', { timeout: 30_000 });
  await hint.getByRole('button', { name: 'Turn off hints' }).click();
  await expect(hint).toHaveCount(0);
  await expect.poll(async () => (await progress(page))['hints_off']).toBe(true);

  // Its end marks the tutorial finished.
  await player.forfeit();
  await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  await expect.poll(async () => (await progress(page))['first_match']).toBe(true);
  expect((await progress(page))['first_match_id']).toBeNull();
  expect(errors).toEqual([]);
  await player.close();
});

test('the cards that answer an order show nothing while the army walks (P2: A1.3, A2.3, IV.4)', async ({
  browser,
  baseURL,
}) => {
  const player = await Player.create(browser, baseURL ?? '', nick('tutp2'));
  const { page } = player;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await player.enter();
  await expect(page.getByRole('radio', { name: 'Invite a friend' })).toBeVisible();
  await showDone(page, ['units', 'economy', 'building', 'attack', 'defence']);
  await page.reload();

  const mapOf = async (name: string): Promise<MapFile> =>
    (await (await page.request.get(`/api/maps/${name}`)).json()) as MapFile;
  const leave = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Exit', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Leave the chapter?' })
      .getByRole('button', { name: 'Leave the chapter' })
      .click();
    await expect(page.getByRole('radio', { name: /Chapter I:/ })).toBeVisible({ timeout: 30_000 });
  };
  const node = (map: MapFile, name: string): number => {
    const found = map.nodes.find((n) => n.name === name);
    if (found === undefined) throw new Error(name);
    return found.id;
  };
  const plate = page.locator('.coach .plate');

  // A1.3: the group order is given, the card "Fernhold waits" is not shown while they walk.
  await page.getByRole('button', { name: 'How to play' }).click();
  await page.getByRole('radio', { name: /Group orders/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const group = await mapOf('tut-group');
  await card(page, 'Sent one at a time');
  await player.clickNode(group, node(group, 'Fernhold'));
  await card(page, 'One group order');
  await player.clickNode(group, node(group, 'Lowfield'), ['Shift']);
  await player.clickNode(group, node(group, 'Ashwood'));
  await page.waitForTimeout(1500);
  await expect(plate.filter({ hasText: 'Fernhold waits' })).toHaveCount(0);
  await shot(page, '14-a1-walking', 0);
  // A1.4 comments on the fight: it still shows.
  await card(page, 'they far outnumber');
  await leave();

  // A2.3: the rally point and the recruits are given, the card "walking" is not shown.
  await page.getByRole('button', { name: 'How to play' }).click();
  await page.getByRole('radio', { name: /Rally points/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const rally = await mapOf('tut-rally');
  await card(page, 'rally point');
  await player.clickNode(rally, node(rally, 'Highhold'));
  await page.keyboard.press('KeyP');
  await player.clickNode(rally, node(rally, 'Fernhold'));
  await card(page, 'Recruit two');
  await player.clickNode(rally, node(rally, 'Highhold'));
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(4500);
  await expect(plate.filter({ hasText: 'is walking to Fernhold' })).toHaveCount(0);
  await shot(page, '15-a2-walking', 0);
  await leave();

  // IV.4: the planned order is given, the card "gathers its bonus" is not shown.
  await page.getByRole('button', { name: 'How to play' }).click();
  await page.getByRole('radio', { name: /Chapter IV/ }).click();
  await page.getByRole('button', { name: /^(Replay|Play again)$/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const attack = await mapOf('tut-attack');
  await card(page, 'every charge your units hold is a shot');
  await page.getByRole('button', { name: 'Continue' }).click();
  await card(page, 'Count on two');
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await player.clickNode(attack, node(attack, 'Fernhold'));
  await card(page, 'planned order');
  await player.clickNode(attack, node(attack, 'Ashwood'), ['KeyE']);
  await page.waitForTimeout(1200);
  await expect(plate.filter({ hasText: 'gathers its bonus' })).toHaveCount(0);
  await shot(page, '16-iv-walking', 0);
  expect(errors).toEqual([]);
  await player.close();
});
