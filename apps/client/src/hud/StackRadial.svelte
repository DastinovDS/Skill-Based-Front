<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import type { NodeNamer } from './nodeName.ts';
  import Radial from './Radial.svelte';
  import { halfFor, spreadAngles, type RadialItem } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** What the city looks like on screen: the list is centred on its circle and follows it. */
    anchors: MapAnchors;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { orders, anchors, names }: Props = $props();

  const menu = $derived(orders.stackMenu.current);
  // The groups of the city, read again with every snapshot (the HUD data is the dependency).
  const groups = $derived(menu.open ? orders.stackGroups() : []);

  const items = $derived.by<RadialItem[]>(() => {
    const angles = spreadAngles(groups.length);
    return groups.map((group, i) => ({
      id: group.id,
      angle: angles[i] ?? 0,
      icon: 'stackGroup',
      label: tf('stack.units', { units: group.units }),
      lines: [
        tf('stack.charged', { charged: group.charged }),
        ...(group.mode === 'defense' ? [t('group.defense')] : []),
        ...(group.planned ? [t('stack.planned')] : []),
      ],
      // Digits choose a group from the keyboard (the first nine).
      ...(i < 9 ? { key: String(i + 1) } : {}),
    }));
  });

  /** The hole is as wide as the city circle; many groups make the ring wider so the lines fit. */
  const ring = $derived.by(() => {
    const circle = menu.target === null ? null : anchors.node(menu.target);
    const inner = Math.max(24, Math.round((circle?.r ?? 20) + 10));
    return { inner, outer: inner + 76 + Math.max(0, groups.length - 4) * 14 };
  });
</script>

<!-- A click on the icon of several own groups in a city: a sector for each, a click selects it. -->
{#if menu.open && menu.target !== null && items.length > 0}
  {@const target = menu.target}
  <Radial
    {items}
    label={tf('stack.title', { node: names(target) })}
    at={() => anchors.node(target)}
    {ring}
    half={halfFor(items.length)}
    clamp={false}
    hover={menu.hover}
    onhover={(id: string | null) => {
      orders.stackMenu.hover(id);
    }}
    onchoose={(id: string) => {
      orders.chooseStackGroup(id);
    }}
    onclose={() => {
      orders.stackMenu.close();
    }}
    closeLabel={t('stack.close')}
  />
{/if}
