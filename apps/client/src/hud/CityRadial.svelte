<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { CityChoice, OrderController } from '../match/orderController.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { formatCentis } from './format.ts';
  import Radial from './Radial.svelte';
  import { halfFor, spreadAngles, type RadialItem } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** What the city looks like on screen: the menu is centred on its circle and follows it. */
    anchors: MapAnchors;
    /** The city builds a road (it cannot start another): the number of seconds left; else `null`. */
    building: number | null;
  }

  let { orders, anchors, building }: Props = $props();

  const menu = $derived(orders.cityMenu.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());

  const angles = spreadAngles(2);
  const items = $derived<RadialItem[]>([
    {
      id: 'recruit',
      angle: angles[0] ?? 180,
      sign: '+',
      label: t('city.recruit'),
      lines: [tf('city.cost', { cost: cp(orders.recruitCost) })],
      key: 'R',
    },
    {
      id: 'roads',
      angle: angles[1] ?? 0,
      sign: '≡',
      label: t('city.roads'),
      lines: building === null ? [] : [tf('city.building', { seconds: building })],
      key: 'U',
      disabled: building !== null,
    },
  ]);

  /** The hole is as wide as the city circle, and the ring starts just outside it. */
  const ring = $derived.by(() => {
    const circle = menu.target === null ? null : anchors.node(menu.target);
    const inner = Math.max(24, Math.round((circle?.r ?? 20) + 10));
    return { inner, outer: inner + 76 };
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
    half={halfFor(2) - 8}
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
