import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command, GroupView, SnapshotMsg } from '../protocol.gen.ts';
import { HudChrome } from './chrome.svelte.ts';
import { DEV_RULES, DEV_RULES_FLOW, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import PlanBanner from './PlanBanner.svelte';
import SplitMenu from './SplitMenu.svelte';
import TopBar from './TopBar.svelte';

// The HUD side of the 2026-11-05 playtest batch (#762): the factory counter, the CP shortage, the
// plan banner (no bonus setting since #797) and the split that sends its part on.
const RULES = DEV_RULES_FLOW;
const base = devSnapshot(DEFAULT_MAP, RULES, 30);
const own = base.view.nodes.filter((n) => n.owner === 0 && n.warehouse_cap !== null);
const home = own[0]?.id ?? 0;
const enemy = base.view.nodes.find((n) => n.owner === 1)?.id ?? 1;
const GROUP = 'g-big';

function group(units: number, charged: number): GroupView {
  return {
    id: GROUP,
    units,
    charged,
    mode: 'attack',
    location: { kind: 'node', node: home },
    order: null,
    defense_bonus: null,
    defense_cap: null,
  };
}

function snapshot(
  cp: number,
  units = 6,
  charged = 2,
  factories: readonly number[] = [],
): SnapshotMsg {
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me, cp },
      groups: [group(units, charged)],
      nodes: base.view.nodes.map((n) => (factories.includes(n.id) ? { ...n, factory: true } : n)),
    },
  };
}

describe('the playtest batch in the HUD (#762)', () => {
  let mounted: Record<string, unknown>[] = [];

  beforeEach(() => {
    setLocale('en');
  });

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  function setup(snap: SnapshotMsg, rules = RULES) {
    const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules, map: DEFAULT_MAP });
    hud.onSnapshot(snap);
    const sent: Command[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
      queryReach: () => undefined,
    });
    return { hud, orders, sent };
  }

  function show(component: unknown, props: Record<string, unknown>): HTMLElement {
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(component as Parameters<typeof mount>[0], { target, props }));
    flushSync();
    return target;
  }

  it('shows own factories of the max next to the CP, under economy v2 only', () => {
    const { hud, orders } = setup(
      snapshot(
        1000,
        6,
        2,
        own.slice(0, 2).map((n) => n.id),
      ),
    );
    const bar = show(TopBar, { data: hud.current, orders, chrome: new HudChrome() });
    const counter = bar.querySelector('.factories');
    expect(counter?.getAttribute('aria-label')).toBe(
      `Factories: 2 of ${String(RULES.factory?.max)}`,
    );
    expect(counter?.classList.contains('full')).toBe(false);
    expect(counter?.querySelector('svg')).not.toBeNull();
    const v1 = setup({ ...devSnapshot(DEFAULT_MAP, DEV_RULES, 30) }, DEV_RULES);
    const bar1 = show(TopBar, { data: v1.hud.current, orders: v1.orders, chrome: new HudChrome() });
    expect(bar1.querySelector('.factories')).toBeNull();
  });

  it('marks the factory counter at the max with its words and a dashed frame', () => {
    const max = RULES.factory?.max ?? 3;
    const { hud, orders } = setup(
      snapshot(
        1000,
        6,
        2,
        own.slice(0, max).map((n) => n.id),
      ),
    );
    const bar = show(TopBar, { data: hud.current, orders, chrome: new HudChrome() });
    const counter = bar.querySelector('.factories');
    expect(counter?.classList.contains('full')).toBe(true);
    expect(counter?.getAttribute('aria-label')).toBe(
      `Factories: ${String(max)} of ${String(max)}, at the most`,
    );
  });

  it('marks the CP badge red with the alert icon while the hovered move costs more than the CP', () => {
    const { hud, orders } = setup(snapshot(RULES.cost.move - 1));
    const bar = show(TopBar, { data: hud.current, orders, chrome: new HudChrome() });
    expect(bar.querySelector('.cp.short')).toBeNull();
    orders.click({ kind: 'group', id: GROUP }, false);
    orders.hover({ kind: 'node', id: enemy });
    orders.overlay();
    flushSync();
    const cp = bar.querySelector('.cp.short');
    expect(cp).not.toBeNull();
    // Not by colour alone: the alert icon and a ring of its own, and the words for a screen reader.
    expect(cp?.querySelector('.short-icon svg')).not.toBeNull();
    expect(cp?.querySelector('.short-ring')).not.toBeNull();
    expect(cp?.getAttribute('aria-label')).toContain('not enough for this move');
  });

  it('has no bonus setting: no stepper, no [ ] key, only Shift + wheel over the target (#797)', () => {
    const { hud, orders } = setup(snapshot(1000, 6, 3));
    orders.click({ kind: 'group', id: GROUP }, false);
    const root = show(PlanBanner, { orders, group: hud.current?.group ?? null });
    const pill = root.querySelector('.pill');
    expect(root.querySelector('output')).toBeNull();
    expect(root.querySelectorAll('button')).toHaveLength(0);
    expect(pill?.textContent).not.toContain('[ ]');
    expect(pill?.textContent).toContain(
      'Shift + wheel over the target sets the bonus, +1 at first',
    );
    // The bonus sign is the chevron of the badges, not a diamond.
    expect(pill?.querySelector('svg.chevron')).not.toBeNull();
    // A planned order is being made: the pill stands out and says so.
    expect(pill?.classList.contains('planning')).toBe(false);
    orders.key({ type: 'keydown', code: 'ShiftLeft', shiftKey: true });
    flushSync();
    expect(pill?.classList.contains('planning')).toBe(true);
    expect(pill?.textContent).toContain('Planned order: turn the wheel over the target');
  });

  it('opens the split menu at the size that fits, says where the part goes, and splits on confirm', () => {
    const { hud, orders, sent } = setup(snapshot(1000, 6, 2));
    orders.click({ kind: 'group', id: GROUP }, false);
    orders.overlay();
    orders.onReach({
      type: 'reach',
      group: GROUP,
      tick: 30,
      nodes: [],
      split: [{ node: enemy, units: 4 }],
    });
    orders.click({ kind: 'node', id: enemy }, false);
    const root = show(SplitMenu, { orders, names: hud.nodeName });
    expect(root.querySelector('.dest')?.textContent.trim()).toBe(
      `To ${hud.nodeName(enemy)}: at most 4 fit the way`,
    );
    expect(root.querySelector('.goes .count')?.textContent).toBe('4');
    const confirm = root.querySelector<HTMLButtonElement>('.confirm');
    expect(confirm?.textContent).toContain('Split and send');
    confirm?.click();
    flushSync();
    expect(sent).toEqual([{ type: 'split', group: GROUP, n: 4 }]);
  });
});
