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
    await expect(page.getByText(/Player 1\s+0 : 0\s+Player 2/)).toBeVisible();
  });
}
