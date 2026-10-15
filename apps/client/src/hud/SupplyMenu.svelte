<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import Radial from './Radial.svelte';
  import {
    PRIORITY_SIGN,
    SUPPLY_HALF,
    SUPPLY_RING,
    SUPPLY_SECTORS,
    type RadialItem,
    type SupplyChoice,
  } from './radial.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const menu = $derived(orders.supplyMenu.current);

  function sign(choice: SupplyChoice): string {
    return choice === 'transfer' ? '⇢' : PRIORITY_SIGN[choice];
  }

  function name(choice: SupplyChoice): string {
    return choice === 'transfer' ? t('supplyMenu.transfer') : t(`priority.${choice}`);
  }

  const items = $derived<RadialItem[]>(
    SUPPLY_SECTORS.map((sector) => {
      const current = sector.choice === menu.priority;
      const note = current
        ? t('supplyMenu.current')
        : sector.choice === 'transfer' && menu.warehouse !== null
          ? tf('supplyMenu.stock', { charges: menu.warehouse })
          : null;
      return {
        id: sector.choice,
        angle: sector.angle,
        sign: sign(sector.choice),
        label: name(sector.choice),
        lines: note === null ? [] : [note],
        key: sector.key,
        // The transfer is an action, not a level: only a priority can be "the current one".
        ...(sector.choice === 'transfer' ? {} : { current }),
      };
    }),
  );
  const captions = $derived([
    { text: t('supplyMenu.caption') },
    { text: t('supplyMenu.hint'), dim: true },
  ]);
</script>

<!-- The supply menu of an own city in the «Supply» map mode (DEC-18): opens where the click was. -->
{#if menu.open}
  <Radial
    {items}
    label={tf('supplyMenu.title', { node: menu.node })}
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
