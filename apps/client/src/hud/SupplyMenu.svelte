<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { formatCentis } from './format.ts';
  import type { NodeNamer } from './nodeName.ts';
  import Radial from './Radial.svelte';
  import {
    frontOf,
    SUPPLY_HALF,
    SUPPLY_RING,
    SUPPLY_SECTORS,
    type RadialItem,
    type SupplyChoice,
  } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { orders, names }: Props = $props();

  const menu = $derived(orders.supplyMenu.current);

  // Marker sectors (DEC-28, item 2): put marker n on the city, or take it off where it stands. A
  // city holds one marker, so the sector of the other marker is off while one stands here.
  const items = $derived.by<RadialItem[]>(() => {
    const count = orders.frontMarkers;
    // A marker is free in DEC-28 (`orders.cost.front = 0`); a ruleset that prices it shows the price.
    const price =
      orders.frontCost > 0
        ? [tf('city.cost', { cost: formatCentis(orders.frontCost, getLocale()) })]
        : [];
    const sectors = SUPPLY_SECTORS.filter((sector) => {
      const marker = frontOf(sector.choice);
      return marker === null || marker < count;
    });
    return sectors.map((sector): RadialItem => {
      const marker = frontOf(sector.choice);
      if (marker === null) {
        const note =
          menu.warehouse !== null ? tf('supplyMenu.stock', { charges: menu.warehouse }) : null;
        return {
          id: sector.choice,
          angle: sector.angle,
          icon: sector.icon,
          label: t('supplyMenu.transfer'),
          lines: note === null ? [] : [note],
          key: sector.key,
        };
      }
      const here = menu.fronts[marker] === menu.node;
      const taken = menu.fronts.some((at, i) => i !== marker && at === menu.node);
      return {
        id: sector.choice,
        angle: sector.angle,
        icon: sector.icon,
        label: tf(here ? 'supplyMenu.frontOff' : 'supplyMenu.front', { n: marker + 1 }),
        lines: taken ? [t('supplyMenu.taken')] : price,
        key: sector.key,
        current: here,
        disabled: taken,
      };
    });
  });
  const captions = $derived([
    { text: t('supplyMenu.caption') },
    { text: t('supplyMenu.hint'), dim: true },
  ]);
</script>

<!-- The supply menu of an own city in the «Supply» map mode (DEC-18): opens where the click was. -->
{#if menu.open}
  <Radial
    {items}
    label={tf('supplyMenu.title', { node: names(menu.node) })}
    at="pointer"
    hover={menu.hover}
    onhover={(id: string | null) => {
      orders.supplyMenu.hover(id as SupplyChoice | null);
    }}
    onchoose={(id: string) => {
      orders.chooseSupply(id as SupplyChoice);
    }}
    onclose={() => {
      orders.closeSupplyMenu();
    }}
    closeLabel={t('supplyMenu.close')}
    modal
    {captions}
    ring={SUPPLY_RING}
    half={SUPPLY_HALF}
  >
    {#snippet centre()}
      <span class="cancel">{t('radial.cancel')}</span>
    {/snippet}
  </Radial>
{/if}

<style>
  .cancel {
    color: var(--text-dim);
    font-size: 10px;
  }
</style>
