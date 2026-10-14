<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { Stance } from '../protocol.gen.ts';
  import { formatCentis } from './format.ts';
  import Radial from './Radial.svelte';
  import { SECTORS, type RadialItem } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** The current stance (`null` before the first snapshot). */
    stance: Stance | null;
  }

  let { orders, stance }: Props = $props();

  const menu = $derived(orders.radial.current);
  const rates = $derived(orders.stanceRates);
  const cp = (centis: number): string => formatCentis(centis, getLocale());

  const items = $derived<RadialItem[]>(
    SECTORS.map((sector) => {
      const rate = rates.find((r) => r.stance === sector.stance);
      return {
        id: sector.stance,
        angle: sector.angle,
        label: t(`stance.${sector.stance}`),
        lines:
          rate === undefined
            ? []
            : [
                tf('radial.cpPerMin', { value: cp(rate.cpPerMinCenti) }),
                tf('radial.chargesPerMin', { value: rate.chargesPerMin }),
              ],
        key: sector.key,
        current: stance === sector.stance,
      };
    }),
  );
</script>

<!-- The stance menu is static at the middle of the screen: the cursor picks a sector (Q). -->
{#if menu.open}
  <Radial
    {items}
    label={t('radial.title')}
    at="centre"
    hover={menu.hover}
    onhover={(id: string | null) => {
      orders.radial.hover(id as Stance | null);
    }}
    onchoose={(id: string) => {
      orders.chooseStance(id as Stance);
    }}
    onclose={() => {
      orders.closeRadial();
    }}
    closeLabel={t('radial.close')}
    modal={menu.sticky}
    interactive={menu.sticky}
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
