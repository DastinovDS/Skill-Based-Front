<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { Stance } from '../protocol.gen.ts';
  import { formatCentis } from './format.ts';
  import CutIcon from '../theme/CutIcon.svelte';
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
  const num = (value: number): string => value.toLocaleString(getLocale());

  // Cut and ring (ui-style 54g): the icon, the rates as signs (CP with the CP mark, the capital's
  // charges with one lozenge, per minute) and the key; the name is in the hub and the accessible
  // name. The explanatory captions of #792 are gone with the rule of as little text as possible.
  const items = $derived<RadialItem[]>(
    SECTORS.map((sector) => {
      const rate = rates.find((r) => r.stance === sector.stance);
      const label = t(`stance.${sector.stance}`);
      return {
        id: sector.stance,
        angle: sector.angle,
        icon: sector.icon,
        label,
        compact: true,
        ...(rate === undefined
          ? { aria: label }
          : {
              price: {
                cp: cp(rate.cpPerMinCenti),
                chargeRate: num(rate.chargesPerMin),
                perMinute: true,
              },
              aria: tf(orders.factoriesFollow ? 'radial.rateLabelAll' : 'radial.rateLabel', {
                stance: label,
                cp: cp(rate.cpPerMinCenti),
                charges: num(rate.chargesPerMin),
              }),
            }),
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
      <span class="cancel" title={t('radial.cancel')}><CutIcon name="cancel" size={14} /></span>
    {/snippet}
  </Radial>
{/if}

<style>
  .cancel {
    display: inline-flex;
    color: var(--ink-dim);
  }
</style>
