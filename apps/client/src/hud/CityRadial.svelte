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
  const upgrades = $derived(orders.cityUpgrades);
  const count = $derived(upgrades.enabled ? 5 : 3);
  const items = $derived.by<RadialItem[]>(() => {
    const angles = spreadAngles(count);
    const queued = queue ?? 0;
    const refund = orders.recruitRefund;
    const noBarracks = upgrades.enabled && city?.hasBarracks === false;
    // Any build of the city (a road, the barracks or the warehouse) holds the others back.
    const busy = city?.building ?? null;
    const busyLine =
      busy === null
        ? building === null
          ? []
          : [tf('city.building', { seconds: building })]
        : [tf('city.builds', { what: t(`build.${busy.kind}`), seconds: busy.secondsLeft })];
    const list: RadialItem[] = [
      {
        id: 'recruit',
        angle: angles[0] ?? 180,
        sign: '+',
        label: t('city.recruit'),
        lines: noBarracks
          ? [t('city.no_barracks')]
          : [
              tf('city.cost', { cost: cp(orders.recruitCost) }),
              tf('city.queue', { n: queued, max: orders.recruitQueueMax }),
            ],
        key: 'R',
        disabled: noBarracks,
      },
      {
        id: 'cancel_recruit',
        angle: angles[1] ?? 60,
        sign: '−',
        label: t('city.cancel_recruit'),
        lines: [tf('city.refund', { full: cp(refund.full), half: cp(refund.started) })],
        disabled: queued === 0,
      },
      {
        id: 'roads',
        angle: angles[2] ?? 0,
        sign: '≡',
        label: t('city.roads'),
        lines: busyLine,
        key: 'U',
        disabled: busy !== null || building !== null,
      },
    ];
    if (upgrades.enabled) {
      const costs = orders.cityCosts;
      const level = city?.warehouseLevel ?? 0;
      list.push(
        {
          id: 'barracks',
          angle: angles[3] ?? 0,
          sign: '⌂',
          label: t('city.barracks'),
          lines: [tf('city.cost', { cost: cp(costs.barracks) })],
          disabled: city?.hasBarracks !== false || busy !== null,
        },
        {
          id: 'warehouse',
          angle: angles[4] ?? 0,
          sign: '▤',
          label: t('city.warehouse'),
          lines: [
            tf('city.warehouse_level', {
              level,
              max: upgrades.warehouse_max_level,
              cap: city?.warehouseCap ?? 0,
            }),
            tf('city.cost', { cost: cp(costs.warehouse) }),
          ],
          disabled: level >= upgrades.warehouse_max_level || busy !== null,
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
