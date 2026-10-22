<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { GroupChoice, OrderController } from '../match/orderController.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import type { GroupInfo } from './hudData.ts';
  import { formatCentis } from './format.ts';
  import Radial from './Radial.svelte';
  import { GROUP_RING, spreadAngles, type RadialItem } from './radial.ts';

  interface Props {
    orders: OrderController;
    anchors: MapAnchors;
    /** The selected group (the menu belongs to it). */
    group: GroupInfo | null;
    /** How many own groups could merge now (the selected one and those standing with it). */
    mergeable: number;
  }

  let { orders, anchors, group, mergeable }: Props = $props();

  const menu = $derived(orders.groupMenu.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());
  // The rule of "Defense" in the caption under the ring (DEC-30): its numbers are the ruleset's.
  const defenseSeconds = $derived(Math.round(orders.defenseTicksPerBonus / orders.tickHz));

  const angles = spreadAngles(4);
  const items = $derived<RadialItem[]>([
    {
      id: 'split',
      angle: angles[0] ?? 270,
      label: t('group.split'),
      key: 'S',
      disabled: group === null || group.node === null || group.units < 2,
    },
    {
      id: 'defense',
      angle: angles[1] ?? 0,
      label: t('group.defense'),
      // The price, and the bonus the group has gathered (DEC-30; the server's numbers).
      lines: [
        tf('group.cost', { cost: cp(orders.modeCost('defense')) }),
        ...(group?.defense == null
          ? []
          : [tf('defense.bonus', { bonus: group.defense.bonus, cap: group.defense.cap })]),
      ],
      key: 'D',
      current: group?.mode === 'defense',
    },
    {
      id: 'cancel',
      angle: angles[2] ?? 90,
      label: t('group.cancel'),
      key: 'X',
      disabled: group === null || (group.destination === null && group.mode !== 'defense'),
    },
    {
      id: 'merge',
      angle: angles[3] ?? 180,
      label: t('group.merge'),
      key: 'G',
      disabled: mergeable < 2,
    },
  ]);
</script>

<!-- A click on an own group (UI round 2): a small menu on its icon. S, D, X and G do the same. -->
{#if menu.open && menu.target !== null}
  {@const target = menu.target}
  <Radial
    {items}
    label={t('group.title')}
    at={() => anchors.group(target)}
    ring={GROUP_RING}
    clamp={false}
    hover={menu.hover}
    onhover={(id: string | null) => {
      orders.groupMenu.hover(id as GroupChoice | null);
    }}
    onchoose={(id: string) => {
      orders.chooseGroup(id as GroupChoice);
    }}
    onclose={() => {
      orders.groupMenu.close();
    }}
    closeLabel={t('group.close')}
    captions={[
      { text: tf('defense.radialRule', { seconds: defenseSeconds }), dim: true },
      { text: t('defense.radialBurn'), dim: true },
    ]}
  />
{/if}
