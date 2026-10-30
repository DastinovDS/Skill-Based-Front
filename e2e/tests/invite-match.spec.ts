import { expect, test } from '@playwright/test';
import { startInviteMatch } from '../support/match.ts';
import type { Player } from '../support/player.ts';
import type { MapFile } from '../../apps/client/src/protocol.gen.ts';

const VERDICT = /^(Victory|Defeat|Draw)$/;

interface OrderPlan {
  readonly first: number;
  readonly second: number;
  readonly target: number;
}

/** The cities connected to `id` by a road, in the order of the roads. */
function neighbours(map: MapFile, id: number): number[] {
  return map.edges.flatMap((edge) => (edge.a === id ? [edge.b] : edge.b === id ? [edge.a] : []));
}

/**
 * Capacity of a node by its kind: the table `capacity.by_kind` of `rulesets/test-short.toml` (the
 * e2e ruleset). A group goes only through nodes that hold all of it (DEC-20, STACK_LIMIT).
 */
const CAPACITY: Readonly<Record<string, number>> = {
  capital: 10,
  city_large: 8,
  city_medium: 6,
  city_small: 4,
  province: 3,
};

/**
 * A pair of orders for `side` that do not touch each other (see `giveOrders`). A node of the plan
 * is one the server accepts the order for on any map of the pool: the first group (the capital's)
 * goes to a neighbour that holds it, the second one starts in an own city that has a garrison (a
 * province has none, DEC-23) and ends in a node that holds it.
 */
function orderPlan(map: MapFile, side: 0 | 1, capital: MapFile['nodes'][number]): OrderPlan {
  const plain = (id: number): boolean => {
    const node = map.nodes[id];
    return node?.start_owner === side && node.capital_of === null;
  };
  const holds = (id: number, units: number): boolean =>
    (CAPACITY[map.nodes[id]?.kind ?? ''] ?? 0) >= units;
  for (const first of neighbours(map, capital.id).filter(
    (id) => plain(id) && holds(id, capital.start_units),
  )) {
    for (const second of map.nodes
      .filter((node) => plain(node.id) && node.id !== first && node.start_units > 0)
      .map((node) => node.id)) {
      const units = map.nodes[second]?.start_units ?? 0;
      const target = neighbours(map, second).find(
        (id) => plain(id) && id !== first && holds(id, units),
      );
      if (target !== undefined) return { first, second, target };
    }
  }
  throw new Error('no pair of orders on this map');
}

/** Orders of one player: a move, a planned move and a stance change, each accepted by the server. */
async function giveOrders(player: Player, map: MapFile): Promise<void> {
  const side = await player.side();
  const capital = map.nodes.find((node) => node.capital_of === side);
  if (capital === undefined) throw new Error('no capital');
  // Two orders that do not meet: the first group leaves the capital for `first`, the second one
  // goes from `second` to `target`. Own units in a city are one icon on it, and a click on the
  // icon of a city is a click on the city, so the second order may aim at any city; it still must
  // not aim at the capital or at `first`, where the first group is (or soon will be).
  const { first, second, target } = orderPlan(map, side, capital);

  // 1. A normal move out of the capital.
  await player.moveGroup(map, capital.id, first);
  await expect.poll(() => player.accepted('move')).toBe(1);

  // 2. A planned move (Shift+click): dearer, shown to the enemy as an intent.
  await player.moveGroup(map, second, target, true);
  await expect.poll(() => player.accepted('move')).toBe(2);

  // 3. The CP stance from the radial menu (Q, a tap keeps it open): costs nothing, the panel shows
  // the new one.
  await player.page.keyboard.press('q');
  await player.page.getByRole('menuitemradio', { name: /War/ }).click();
  await expect.poll(() => player.accepted('set_stance')).toBe(1);
  await expect(player.page.getByRole('button', { name: /Stance: War/ })).toBeVisible();
}

test('two guests play a private match by invite to the end and watch the replay', async ({
  browser,
  baseURL,
}) => {
  const { host, guest, map } = await startInviteMatch(browser, baseURL ?? '');
  // The sides are the server's decision: each player orders their own half.
  expect(new Set([await host.side(), await guest.side()])).toEqual(new Set([0, 1]));

  await Promise.all([giveOrders(host, map), giveOrders(guest, map)]);

  // test-short: 600 ticks, one minute. Timer end: victory points decide (or a draw).
  const verdicts: string[] = [];
  for (const player of [host, guest]) {
    const heading = player.page.getByRole('heading', { name: VERDICT });
    await expect(heading).toBeVisible({ timeout: 120_000 });
    verdicts.push(((await heading.textContent()) ?? '').trim());
    await expect(player.page.getByText(/^Time is up\./)).toBeVisible();
    await expect(
      player.page.getByRole('group', { name: /^Victory points: \d+ for .+, \d+ for .+$/ }),
    ).toBeVisible();
  }
  // Both screens agree: one victory and one defeat, or a draw on both.
  expect(['Defeat,Victory', 'Draw,Draw']).toContain(verdicts.slice().sort().join(','));

  // The "Watch the replay" button of the result screen (#170): the match exists as a replay.
  for (const player of [host, guest]) {
    await player.page.getByRole('button', { name: 'Watch the replay' }).click();
    const canvas = player.page.locator('.game-canvas');
    await expect(canvas).toHaveAttribute('data-tick', '0', { timeout: 60_000 });
  }

  // Playback: speed up, play, pause, seek.
  const page = host.page;
  const canvas = page.locator('.game-canvas');
  await page.getByRole('button', { name: '×16' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => host.tick()).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByLabel('Position in the match').fill('300');
  await expect(canvas).toHaveAttribute('data-tick', '300');

  // "Back" returns to the result screen the replay was opened from (#259), not to the menu.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: VERDICT })).toBeVisible();
  await page.getByRole('button', { name: 'To the menu' }).click();
  await expect(page.getByRole('button', { name: host.nick })).toBeVisible();

  await host.close();
  await guest.close();
});

test('pause, a dropped connection and a forfeit in a private match', async ({
  browser,
  baseURL,
}) => {
  const { host, guest } = await startInviteMatch(browser, baseURL ?? '');

  // Pause (private matches only): both see it, the clock stops, "Resume" brings it back.
  await host.page.getByRole('button', { name: 'Pause' }).click();
  await expect(host.page.getByText(/^You paused the match\./)).toBeVisible();
  await expect(guest.page.getByText(/^The opponent paused the match\./)).toBeVisible();
  // The server stops the clock: no snapshot after `paused` (the page itself keeps playing out
  // the few snapshots it had buffered, so the frames, not the canvas, are the evidence).
  const pausedAt = guest.received.findLastIndex((f) => f.type === 'paused');
  await guest.page.waitForTimeout(1500);
  expect(guest.received.slice(pausedAt).filter((f) => f.type === 'snapshot')).toEqual([]);
  await host.page.getByRole('button', { name: 'Resume' }).click();
  await expect(guest.page.getByText(/paused the match/)).toBeHidden();
  await expect
    .poll(() => guest.received.slice(pausedAt).filter((f) => f.type === 'snapshot').length)
    .toBeGreaterThan(5);

  // The connection of the guest drops: the client reconnects by itself, with the same token, and
  // the match goes on for both (a second `welcome`, the tick moves on).
  expect(guest.welcomes()).toBe(1);
  const before = await guest.tick();
  await guest.dropConnection();
  await expect.poll(() => guest.welcomes(), { timeout: 20_000 }).toBe(2);
  await expect.poll(async () => guest.tick(), { timeout: 20_000 }).toBeGreaterThan(before + 10);
  await expect(guest.page.getByText('Connection lost. Reconnecting...')).toBeHidden();

  // The guest gives up: a defeat for them, a victory for the host.
  await guest.forfeit();
  await expect(guest.page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'Victory' })).toBeVisible();
  await expect(host.page.getByText(/ gave up\.$/)).toBeVisible();
  await expect(guest.page.getByText('You gave up.')).toBeVisible();

  await host.close();
  await guest.close();
});

test('a page reload in a running match returns to the same match (#189)', async ({
  browser,
  baseURL,
}) => {
  const { host, guest } = await startInviteMatch(browser, baseURL ?? '');
  const side = await host.side();
  expect(host.welcomes()).toBe(1);

  // The match is paused for the whole test (#484): on a loaded machine every step takes many
  // seconds, and the 60-second `test-short` match would end under the test before the forfeit
  // below. A paused clock makes the speed of the runner irrelevant (the pause limit and the
  // reconnect window of the e2e stack are long: e2e/compose.e2e.yaml).
  await host.page.getByRole('button', { name: 'Pause' }).click();
  await expect(host.page.getByText(/^You paused the match\./)).toBeVisible();
  await expect(guest.page.getByText(/^The opponent paused the match\./)).toBeVisible();

  // F5 in the middle of the match: the page asks the server where the match is and reconnects
  // with the same token (a second `welcome`), instead of landing on the menu.
  await host.page.reload();
  await expect.poll(() => host.welcomes(), { timeout: 30_000 }).toBe(2);
  expect(host.received.filter((f) => f.type === 'welcome').map((f) => f['player'])).toEqual([
    side,
    side,
  ]);
  // The same match, not the menu: the pause the host started is still on.
  await expect(host.page.getByText(/^You paused the match\./)).toBeVisible();
  await expect(host.page.getByRole('button', { name: host.nick })).toBeHidden();

  // Nobody lost by disconnect and the match goes on for both: the guest's forfeit is queued by the
  // server (commands wait for the next tick) and applies as soon as the host ends the pause.
  await guest.forfeit();
  await host.page.getByRole('button', { name: 'Resume' }).click();
  await expect(host.page.getByRole('heading', { name: 'Victory' })).toBeVisible();
  await expect(host.page.getByText(/ gave up\.$/)).toBeVisible();
  await expect(guest.page.getByRole('heading', { name: 'Defeat' })).toBeVisible();

  await host.close();
  await guest.close();
});
