import { randomBytes } from 'node:crypto';
import type { Browser } from '@playwright/test';
import { expect } from '@playwright/test';
import type { MapFile } from '../../apps/client/src/protocol.gen.ts';
import { Player } from './player.ts';

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
  const link = await host.createInvite();

  // The invite link opens on the nick form ("You were invited"), then the waiting room.
  await guest.enter(link);
  const code = new URL(link).searchParams.get('m') ?? '';
  await Promise.all([host.pressReady(), guest.pressReady()]);
  await Promise.all([host.expectPlaying(), guest.expectPlaying()]);
  // The map is made for the invite (#884, #919): its id is final once the match runs (a pool map
  // takes the place of one that could not be made).
  const mapId = await host.inviteMap(code);

  const response = await host.page.request.get(`/api/maps/${encodeURIComponent(mapId)}`);
  expect(response.ok()).toBe(true);
  return { host, guest, map: (await response.json()) as MapFile };
}
