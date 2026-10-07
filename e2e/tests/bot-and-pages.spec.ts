import { expect, test } from '@playwright/test';
import { nick } from '../support/match.ts';
import { Player } from '../support/player.ts';

test('a match against a bot starts and ends with a forfeit', async ({ browser, baseURL }) => {
  const player = await Player.create(browser, baseURL ?? '', nick('solo'));
  await player.enter();
  await player.page.getByRole('button', { name: 'Play against a bot' }).click();
  await player.page.getByLabel('Bot level').selectOption('easy');
  await player.page.getByRole('button', { name: 'Start' }).click();
  await player.expectPlaying();

  await player.page.getByRole('button', { name: 'Forfeit' }).click();
  await player.page.getByRole('button', { name: 'Yes, forfeit' }).click();
  await expect(player.page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  await expect(player.page.getByRole('button', { name: 'Watch the replay' })).toBeVisible();
  await player.close();
});

test('the production build renders, the language switches, the legal pages open', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // A blank page was once the failure of the production image (QA-01): the form must be there.
  await page.goto('/');
  await expect(page.getByLabel('Your nick')).toBeVisible();

  await page.getByLabel('Language').selectOption('ru');
  await expect(page.getByText('Выбери ник и играй прямо в браузере.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Выбери ник и играй прямо в браузере.')).toBeVisible();
  await page.getByLabel('Язык').selectOption('en');

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
