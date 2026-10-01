import { expect, test } from '@playwright/test';

// The replay viewer (CLI-10) on the bundled sample (`?replay=dev`, a 409-tick match): it plays,
// speeds up and seeks. No reference screenshot: this checks the controls drive the real renderer.
test('replay viewer plays, speeds up and seeks', async ({ page }) => {
  await page.goto('/?replay=dev');
  const canvas = page.locator('.game-canvas');
  await expect(canvas).toHaveAttribute('data-tick', '0');

  await page.getByRole('button', { name: '×16' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-tick'))).toBeGreaterThan(40);

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByLabel('Position in the match').fill('300');
  await expect(canvas).toHaveAttribute('data-tick', '300');
  await page.screenshot({ path: process.env.REPLAY_SHOT ?? 'test-results/replay.png' });
});
