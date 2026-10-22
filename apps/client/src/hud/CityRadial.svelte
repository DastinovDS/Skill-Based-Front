<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { CityChoice, OrderController } from '../match/orderController.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { cityChoices } from './cityChoices.ts';
  import { formatCentis } from './format.ts';
  import type { NodeInfo } from './hudData.ts';
  import Radial from './Radial.svelte';
  import { halfFor, spreadAngles, type RadialItem } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** What the city looks like on screen: the menu is centred on its circle and follows it. */
    anchors: MapAnchors;
    /** Units in the recruit queue of the city (DEC-25, from the snapshot); `null`: unknown. */
    queue: number | null;
    /** The selected city (barracks, warehouse and its build of any kind, DEC-26); `null`: none. */
    city?: NodeInfo | null;
  }

  let { orders, anchors, queue, city = null }: Props = $props();

  const menu = $derived(orders.cityMenu.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());

  // DEC-26: with the city development the menu also builds the barracks and the warehouse.
  // A sector shows only its glyph and its price (the name is the accessible name); the reason a
  // sector is off is on the map and in the panel, never a line of text here.
  const upgrades = $derived(orders.cityUpgrades);
  // A sector with nothing to do (no recruit without a barracks, the barracks is built, the
  // warehouse is at its top level) is not drawn; the others spread evenly around the ring.
  const choices = $derived(cityChoices(upgrades, city));
  const count = $derived(choices.length);
  const items = $derived.by<RadialItem[]>(() => {
    const angles = spreadAngles(count);
    const costs = orders.cityCosts;
    const queued = queue ?? 0;
    // Own CP now; `null` (not known yet): nothing is dimmed for it.
    const funds = orders.cpNow;
    const poor = (centis: number): boolean => funds !== null && funds < centis;
    // A build of the city (the barracks or the warehouse) holds the other back.
    const busy = city?.building != null;
    const price = (centis: number): string[] =>
      centis > 0 ? [tf('city.cost', { cost: cp(centis) })] : [];
    const sector = (choice: CityChoice): Omit<RadialItem, 'angle'> => {
      switch (choice) {
        case 'recruit':
          return {
            id: 'recruit',
            icon: 'recruit',
            label: t('city.recruit'),
            lines: price(costs.recruit),
            key: 'R',
            compact: true,
            disabled: poor(costs.recruit) || queued >= orders.recruitQueueMax,
          };
        case 'barracks':
          return {
            id: 'barracks',
            icon: 'barracks',
            label: t('city.barracks'),
            lines: price(costs.barracks),
            compact: true,
            // Only a city known to lack it builds it (a built one has no sector at all).
            disabled: city?.hasBarracks !== false || busy || poor(costs.barracks),
          };
        case 'warehouse':
          return {
            id: 'warehouse',
            icon: 'warehouse',
            label: t('city.warehouse'),
            lines: price(costs.warehouse),
            compact: true,
            disabled: busy || poor(costs.warehouse),
          };
      }
    };
    return choices.map((choice, i) => ({ ...sector(choice), angle: angles[i] ?? 0 }));
  });

  /** The ring is this wide, CSS px (a bit narrower than before: 64). */
  const RING_WIDTH = 54;

  /** The hole is as wide as the city circle, and the ring starts just outside it. */
  const ring = $derived.by(() => {
    const circle = menu.target === null ? null : anchors.node(menu.target);
    const inner = Math.max(24, Math.round((circle?.r ?? 20) + 10));
    return { inner, outer: inner + RING_WIDTH };
  });
</script>

<!-- A click on an own city (UI round 2): its actions around the circle. R does the same. -->
{#if menu.open && menu.target !== null}
  {@const target = menu.target}
  <Radial
    {items}
    label={tf('city.title', { node: target })}
    at={() => anchors.node(target)}
    {ring}
    half={halfFor(count)}
    clamp={false}
    hover={menu.hover}
    onhover={(id: string | null) => {
      orders.cityMenu.hover(id as CityChoice | null);
    }}
    onchoose={(id: string) => {
      orders.chooseCity(id as CityChoice);
    }}
    onclose={() => {
      orders.cityMenu.close();
    }}
    closeLabel={t('city.close')}
  />
{/if}
