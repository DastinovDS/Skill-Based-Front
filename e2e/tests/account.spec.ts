import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { nick } from '../support/match.ts';
import { Player } from '../support/player.ts';

test('an account: register, then a login on a second device logs the first one out (#374)', async ({
  browser,
  baseURL,
}) => {
  const name = nick('acc');
  const password = `e2e-${randomBytes(6).toString('hex')}`;
  const first = await Player.create(browser, baseURL ?? '', name);
  await first.page.goto('/');
  await first.page.getByRole('button', { name: 'Create an account' }).click();
  await first.page.getByLabel('Your nick').fill(name);
  await first.page.getByLabel('New password').fill(password);
  await first.page.getByLabel('Repeat the password').fill(password);
  await first.page.getByRole('button', { name: 'Create the account and play' }).click();
  await expect(first.page.getByRole('button', { name })).toBeVisible();

  // Log out here, log in again with the nick in another spelling (same account).
  // The account chip in the corner opens the account menu (#471).
  await first.page.getByRole('button', { name }).click();
  await first.page.getByRole('menuitem', { name: 'Log out' }).click();
  await first.page.getByRole('button', { name: 'Log in to an account' }).click();
  await first.page.getByLabel('Your nick').fill(name.toUpperCase());
  await first.page.getByLabel('Password', { exact: true }).fill(password);
  await first.page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(first.page.getByRole('button', { name })).toBeVisible();

  const second = await Player.create(browser, baseURL ?? '', name);
  await second.page.goto('/');
  await second.page.getByRole('button', { name: 'Log in to an account' }).click();
  await second.page.getByLabel('Your nick').fill(name);
  await second.page.getByLabel('Password', { exact: true }).fill('not the password');
  await second.page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(second.page.getByText('Wrong nick or password.')).toBeVisible();
  await second.page.getByLabel('Password', { exact: true }).fill(password);
  await second.page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(second.page.getByRole('button', { name })).toBeVisible();

  // The first device still holds the old token: the server no longer knows it.
  await first.page.reload();
  await expect(first.page.getByText(/The session is over/)).toBeVisible();
  await expect(first.page.getByLabel('Your nick')).toBeVisible();
  await first.close();
  await second.close();
});
