import { randomBytes } from 'node:crypto';
import type { Browser } from '@playwright/test';
import { expect } from '@playwright/test';
import type { MapFile } from '../../apps/client/src/protocol.gen.ts';
import { Player } from './player.ts';

/** A nick that no other test (or an earlier run against the same stack) used: 3 to 16 characters. */
export function nick(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`.slice(0, 16);
}

/**
 * How long a match on a map made for it may take to come up, from Ready. The server waits for the
 * map at most `GOW_MAPGEN_WAIT_S` (60 s, pinned in e2e/compose.e2e.yaml), then plays a pool map
 * (AGENTS.md 5.4); on the CI runner a map takes 17 to 40 s and sometimes more than 60 s (#988).
 * The rest is the match screen coming up on a loaded runner.
 */
export const MADE_MAP_WAIT_MS = 120_000;

export interface InviteMatch {
  readonly host: Player;
  readonly guest: Player;
  readonly map: MapFile;
}

/**
 * Two guests in two isolated browser contexts: the host makes a private match, the other opens
 * the invite link, both press "Ready", and both pages show the running match.
 */
export async function startInviteMatch(
  browser: Browser,
  baseURL: string,
  /**
   * A pool map, through the API: every test but one, so a slow map does not race the clock of a
   * test (#988). None: the plinth's Get the link, a map made for the invite (#884, #919).
   */
  mapId?: string,
): Promise<InviteMatch> {
  const host = await Player.create(browser, baseURL, nick('host'));
  const guest = await Player.create(browser, baseURL, nick('guest'));

  await host.enter();
  const link = mapId === undefined ? await host.createInvite() : await host.createInviteOn(mapId);

  // The invite link opens on the nick form ("You were invited"), then the waiting room.
  await guest.enter(link);
  const code = new URL(link).searchParams.get('m') ?? '';
  await Promise.all([host.pressReady(), guest.pressReady()]);
  const wait = mapId === undefined ? MADE_MAP_WAIT_MS : undefined;
  await Promise.all([host.expectPlaying(wait), guest.expectPlaying(wait)]);
  // The map is made for the invite (#884, #919): its id is final once the match runs (a pool map
  // takes the place of one that could not be made).
  const played = await host.inviteMap(code);

  const response = await host.page.request.get(`/api/maps/${encodeURIComponent(played)}`);
  expect(response.ok()).toBe(true);
  return { host, guest, map: (await response.json()) as MapFile };
}
