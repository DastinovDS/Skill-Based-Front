import { expect, test } from '@playwright/test';
import { DRAWN_MAP_VARIANCE, mapVariance } from './mapPixels.ts';

// The replay viewer (CLI-10) on the bundled sample (`?replay=dev`, a 409-tick match): it plays,
// speeds up and seeks. No reference screenshot: this checks the controls drive the real renderer.
test('replay viewer plays, speeds up and seeks', async ({ page }) => {
  await page.goto('/?replay=dev');
  const canvas = page.locator('.game-canvas');
  await expect(canvas).toHaveAttribute('data-tick', '0');

  // ×4, not ×16: the match must outlast the test's own steps. On a slow runner (software WebGL
  // draws a few frames a second) ×16 reaches the end (tick 409) before the Pause click, and the
  // slider seek then lands on a replay that is not paused (#476).
  await page.getByRole('button', { name: '×4' }).click();
  await expect(page.getByRole('button', { name: '×4' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-tick'))).toBeGreaterThan(40);

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByLabel('Position in the match').fill('300');
  await expect(canvas).toHaveAttribute('data-tick', '300');
  await page.screenshot({ path: process.env.REPLAY_SHOT ?? 'test-results/replay.png' });
});

// #185: the legal links sit in their own strip under the controls, not over the score. Checked at
// the small window (the controls take the whole width there) and at a wide one.
for (const size of [
  { width: 800, height: 600 },
  { width: 1600, height: 900 },
]) {
  test(`legal footer does not cover the replay controls at ${String(size.width)}x${String(size.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/?replay=dev');
    await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '0');
    const footer = await page.getByRole('navigation', { name: /legal/i }).boundingBox();
    const controls = await page.getByRole('region', { name: 'Replay controls' }).boundingBox();
    if (footer === null || controls === null) throw new Error('footer or controls not laid out');
    expect(footer.y).toBeGreaterThanOrEqual(controls.y + controls.height);
    await expect(page.getByRole('img', { name: 'Player 1 0, Player 2 0' })).toBeVisible();
  });
}

// The controls of the viewer (its keys went in #631, only Esc is left) and the "View as" selector (#599).
test('replay viewer answers its buttons and switches the blue side', async ({ page }) => {
  await page.goto('/?replay=dev');
  const canvas = page.locator('.game-canvas');
  await expect(canvas).toHaveAttribute('data-tick', '0');

  await page.getByRole('button', { name: '×4' }).click();
  await expect(page.getByRole('button', { name: '×4' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Position in the match').fill('50');
  await expect(canvas).toHaveAttribute('data-tick', '50');
  await page.getByLabel('Position in the match').fill('0');
  await expect(canvas).toHaveAttribute('data-tick', '0');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // The playback ran a few ticks between Play and Pause (how many depends on the machine, #638):
  // back to the start, so the side switch below is checked on a known frame. A paused viewer
  // stays there.
  await page.getByLabel('Position in the match').fill('0');
  await expect(canvas).toHaveAttribute('data-tick', '0');
  // The keys of the old viewer do nothing now.
  await page.keyboard.press('Digit1');
  await expect(page.getByRole('button', { name: '×4' })).toHaveAttribute('aria-pressed', 'true');

  const both = page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'Both' });
  await expect(both).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('group', { name: 'View as' })
    .getByRole('button', { name: 'Player 2' })
    .click();
  await expect(
    page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'Player 2' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // The map was drawn again for the other side, on the same frame and without a reload.
  await expect(canvas).toHaveAttribute('data-tick', '0');
  await expect(page.getByRole('img', { name: 'Player 2 0, Player 1 0' })).toBeVisible();
});

// At a phone width the bars are two tidy rows each and nothing scrolls sideways (#599).
test('replay viewer fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?replay=dev');
  await expect(page.locator('.game-canvas')).toHaveAttribute('data-tick', '0');
  const controls = await page.getByRole('region', { name: 'Replay controls' }).boundingBox();
  if (controls === null) throw new Error('controls not laid out');
  expect(controls.height).toBeLessThanOrEqual(130);
  const overflow = Number(
    await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    ),
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// #617: "View as" rebuilds the scene of the same map; the old scene unloaded the baked background
// the new one had just been handed, the renderer threw every frame and the map turned black. The
// samples are on `siege` (no background), so `&bg=crossroads` draws one under the dev sample.
// WebKit shows the black canvas; headless Chromium keeps the last picture, so the uncaught render
// error is what fails there.
test('replay viewer keeps the map drawn while the view and the fog switch', async ({ page }) => {
  // Each check takes a screenshot of the canvas: software WebGL on a CI runner is slow at it.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?replay=dev-fog&bg=crossroads');
  const canvas = page.locator('.game-canvas');
  await expect(canvas).toHaveAttribute('data-tick', '0');
  await expect(canvas).toHaveAttribute('data-background', 'loaded');
  const view = page.getByRole('group', { name: 'View as' });
  const drawn = async (): Promise<void> => {
    await expect(canvas).not.toHaveAttribute('data-background', 'pending');
    await expect.poll(() => mapVariance(page)).toBeGreaterThan(DRAWN_MAP_VARIANCE);
  };
  await drawn();
  for (const name of ['Reactive', 'Both', 'Rusher']) {
    await view.getByRole('button', { name }).click();
    await drawn();
  }
  await page.keyboard.press('KeyF');
  await drawn();
  // While playing too.
  await page.keyboard.press('Space');
  await view.getByRole('button', { name: 'Rusher' }).click();
  await drawn();
  await page.keyboard.press('Space');
  expect(errors).toEqual([]);
});
