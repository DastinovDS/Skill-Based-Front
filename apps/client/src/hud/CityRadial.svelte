<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { CityChoice, OrderController } from '../match/orderController.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { formatCentis } from './format.ts';
  import type { NodeInfo } from './hudData.ts';
  import Radial from './Radial.svelte';
  import { halfFor, spreadAngles, type RadialItem } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** What the city looks like on screen: the menu is centred on its circle and follows it. */
    anchors: MapAnchors;
    /** The city builds a road (it cannot start another): the number of seconds left; else `null`. */
    building: number | null;
    /** Units in the recruit queue of the city (DEC-25, from the snapshot); `null`: unknown. */
    queue: number | null;
    /** The selected city (barracks, warehouse and its build of any kind, DEC-26); `null`: none. */
    city?: NodeInfo | null;
  }

  let { orders, anchors, building, queue, city = null }: Props = $props();

  const menu = $derived(orders.cityMenu.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());

  // DEC-26: with the city development the menu also builds the barracks and the warehouse.
  // A sector shows only its glyph and its price (the name is the accessible name); the reason a
  // sector is off is on the map and in the panel, never a line of text here.
  const upgrades = $derived(orders.cityUpgrades);
  const count = $derived(upgrades.enabled ? 4 : 2);
  const items = $derived.by<RadialItem[]>(() => {
    const angles = spreadAngles(count);
    const costs = orders.cityCosts;
    const queued = queue ?? 0;
    // Own CP now; `null` (not known yet): nothing is dimmed for it.
    const funds = orders.cpNow;
    const poor = (centis: number): boolean => funds !== null && funds < centis;
    const noBarracks = upgrades.enabled && city?.hasBarracks === false;
    // Any build of the city (a road, the barracks or the warehouse) holds the others back.
    const busy = city?.building != null || building !== null;
    const level = city?.warehouseLevel ?? 0;
    const price = (centis: number): string[] =>
      centis > 0 ? [tf('city.cost', { cost: cp(centis) })] : [];
    const list: RadialItem[] = [
      {
        id: 'recruit',
        angle: angles[0] ?? 270,
        sign: '+',
        label: t('city.recruit'),
        lines: price(costs.recruit),
        key: 'R',
        compact: true,
        disabled: noBarracks || poor(costs.recruit) || queued >= orders.recruitQueueMax,
      },
      {
        id: 'roads',
        angle: angles[1] ?? 90,
        sign: '≡',
        label: t('city.roads'),
        lines: price(costs.road),
        key: 'U',
        compact: true,
        disabled: busy || poor(costs.road),
      },
    ];
    if (upgrades.enabled) {
      list.push(
        {
          id: 'barracks',
          angle: angles[2] ?? 0,
          sign: '⌂',
          label: t('city.barracks'),
          lines: price(costs.barracks),
          compact: true,
          disabled: city?.hasBarracks !== false || busy || poor(costs.barracks),
        },
        {
          id: 'warehouse',
          angle: angles[3] ?? 0,
          sign: '▤',
          label: t('city.warehouse'),
          lines: price(costs.warehouse),
          compact: true,
          disabled: level >= upgrades.warehouse_max_level || busy || poor(costs.warehouse),
        },
      );
    }
    return list;
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

<!-- A click on an own city (UI round 2): its actions around the circle. R and U do the same. -->
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
