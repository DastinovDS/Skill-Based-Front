import { expect, test } from '@playwright/test';
import { nick } from '../support/match.ts';
import { Player } from '../support/player.ts';

test('a match against a bot starts and ends with a forfeit', async ({ browser, baseURL }) => {
  const player = await Player.create(browser, baseURL ?? '', nick('solo'));
  await player.enter();
  await player.page.getByRole('button', { name: 'Play a bot' }).click();
  await player.page.getByRole('radio', { name: 'Easy' }).click();
  await player.page.getByRole('button', { name: 'Start' }).click();
  await player.expectPlaying();

  await player.forfeit();
  await expect(player.page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  await expect(player.page.getByRole('button', { name: 'Watch the replay' })).toBeVisible();
  await player.close();
});

test('a bot match on a generated map names the map on the result screen', async ({
  browser,
  baseURL,
}) => {
  const player = await Player.create(browser, baseURL ?? '', nick('gen'));
  await player.enter();
  await player.page.getByRole('button', { name: 'Play a bot' }).click();
  await expect(player.page.getByText('Generated, unrated')).toBeVisible();
  await player.page.getByRole('radio', { name: /^gen1-17/ }).click();
  await player.page.getByRole('button', { name: 'Start' }).click();
  await player.expectPlaying();

  await player.forfeit();
  await expect(player.page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  await expect(player.page.getByText('Match result · gen1-17')).toBeVisible();
  await player.close();
});

test('the public lobby offers no generated map', async ({ browser, baseURL }) => {
  const player = await Player.create(browser, baseURL ?? '', nick('pub'));
  await player.enter();
  await player.page.getByRole('button', { name: 'Open matches' }).click();
  await player.page.getByRole('button', { name: 'Create an open match' }).first().click();
  await expect(player.page.getByRole('radio', { name: /^ridge/ })).toBeVisible();
  await expect(player.page.getByText('Generated, unrated')).toHaveCount(0);
  await player.close();
});

test('the production build renders, the legal pages open', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // A blank page was once the failure of the production image (QA-01): the form must be there.
  await page.goto('/');
  await expect(page.getByLabel('Your nick')).toBeVisible();

  // The game ships English only: no language selector.
  await expect(page.getByLabel('Language')).toHaveCount(0);

  // The footer links open a new tab, so that following one never ends a running match.
  const [legal] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('link', { name: 'Impressum' }).click(),
  ]);
  await expect(legal).toHaveURL(/\/impressum$/);
  await expect(legal.getByRole('heading', { name: 'Legal notice (Impressum)' })).toBeVisible();
  await legal.getByRole('link', { name: 'Privacy policy' }).first().click();
  await expect(legal).toHaveURL(/\/privacy$/);
  await expect(legal.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  await legal.getByRole('link', { name: 'Back to the game' }).click();
  await expect(legal.getByLabel('Your nick')).toBeVisible();

  expect(errors).toEqual([]);
});

test.describe('a Russian browser with a saved Russian choice', () => {
  test.use({ locale: 'ru-RU' });

  test('still gets the English interface and no language selector', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // A choice saved while the game still had a Russian interface.
    await page.addInitScript(() => {
      window.localStorage.setItem('sbf.locale', 'ru');
    });
    await page.goto('/');
    await expect(page.getByLabel('Your nick')).toBeVisible();
    await expect(page.getByLabel('Language')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(errors).toEqual([]);
  });
});
