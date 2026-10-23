import { randomBytes } from 'node:crypto';
import type { Browser } from '@playwright/test';
import { expect } from '@playwright/test';
import type { MapFile } from '../../apps/client/src/protocol.gen.ts';
import { Player } from './player.ts';

/** The map the invite tests play on: any of the maps of the pool works, this one is mid-sized. */
export const MAP_ID = 'web';

/** A nick that no other test (or an earlier run against the same stack) used: 3 to 16 characters. */
export function nick(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`.slice(0, 16);
}

export interface InviteMatch {
  readonly host: Player;
  readonly guest: Player;
  readonly map: MapFile;
}

/**
 * Two guests in two isolated browser contexts: the host makes a private match, the other opens
 * the invite link, both press "Ready", and both pages show the running match.
 */
export async function startInviteMatch(browser: Browser, baseURL: string): Promise<InviteMatch> {
  const host = await Player.create(browser, baseURL, nick('host'));
  const guest = await Player.create(browser, baseURL, nick('guest'));

  await host.enter();
  const link = await host.createInvite(MAP_ID);

  // The invite link opens on the nick form ("You were invited"), then the waiting room.
  await guest.enter(link);
  await Promise.all([host.pressReady(), guest.pressReady()]);
  await Promise.all([host.expectPlaying(), guest.expectPlaying()]);

  const response = await host.page.request.get(`/api/maps/${MAP_ID}`);
  expect(response.ok()).toBe(true);
  return { host, guest, map: (await response.json()) as MapFile };
}
