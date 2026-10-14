<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import Radial from './Radial.svelte';
  import { ROAD_HALF, ROAD_SECTORS, type RadialItem, type RoadType } from './radial.ts';
  import { gainText } from './tipText.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const menu = $derived(orders.roadType.current);

  const items = $derived<RadialItem[]>(
    ROAD_SECTORS.flatMap((sector) => {
      const gain = sector.type === 'fast' ? menu.fast : menu.freight;
      if (gain === null) return [];
      return [
        {
          id: sector.type,
          angle: sector.angle,
          // The type is told by its sign as well as by its name: >> fast, ≡ freight.
          sign: sector.type === 'fast' ? '»' : '≡',
          label: t(`road.${sector.type}`),
          lines: [gainText(gain)],
          key: sector.key,
        },
      ];
    }),
  );
  const captions = $derived([
    { text: tf('roadType.caption', { level: menu.level, charges: menu.charges ?? '?' }) },
    { text: t('roadType.hint'), dim: true },
  ]);
</script>

<!-- The first upgrade of a road chooses its type (DEC-22); opens where the click was. -->
{#if menu.open}
  <Radial
    {items}
    label={tf('roadType.title', { edge: menu.edge })}
    at="pointer"
    hover={menu.hover}
    onhover={(id: string | null) => {
      orders.roadType.hover(id as RoadType | null);
    }}
    onchoose={(id: string) => {
      orders.chooseRoadType(id as RoadType);
    }}
    onclose={() => {
      orders.closeRoadType();
    }}
    closeLabel={t('roadType.close')}
    modal
    {captions}
    half={ROAD_HALF}
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
