<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { GroupChoice, OrderController } from '../match/orderController.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import type { GroupInfo } from './hudData.ts';
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

  // Under the group order there is no release (DEC-48, items A7, K6): three sectors, not four.
  const angles = $derived(spreadAngles(orders.canRelease ? 4 : 3));
  const held = $derived(group !== null && orders.isHeldInFight(group) && !orders.canCancel(group));
  // The sector that lets a gathering plan go (DEC-41, item 10).
  const release = $derived<RadialItem>({
    id: 'release',
    icon: 'release',
    angle: angles[1] ?? 0,
    label: t('group.release'),
    lines:
      group?.gathering == null
        ? []
        : [tf('plan.gathered', { bonus: group.gathering.bonus, plan: group.gathering.plan })],
    key: 'F',
    disabled: group?.gathering == null,
  });
  // Cut and ring (ui-style 54g): icons, the gathered bonus and the keys; the name is in the hub.
  const items = $derived.by<RadialItem[]>(() =>
    sectors.map((item) => ({ ...item, compact: true })),
  );
  const sectors = $derived<RadialItem[]>([
    {
      id: 'split',
      icon: 'split',
      angle: angles[0] ?? 270,
      label: t('group.split'),
      key: 'S',
      disabled: group === null || group.node === null || group.units < 2,
    },
    ...(orders.canRelease ? [release] : []),
    {
      id: 'cancel',
      icon: 'cancel',
      angle: angles[orders.canRelease ? 2 : 1] ?? 90,
      label: t('group.cancel'),
      key: 'X',
      // Under `combat.retreat = "none"` a group in a fight cannot leave (DEC-40): say why.
      lines: held ? [t('group.stays')] : [],
      disabled: group === null || !orders.canCancel(group),
    },
    {
      id: 'merge',
      icon: 'merge',
      angle: angles[orders.canRelease ? 3 : 2] ?? 180,
      label: t('group.merge'),
      key: 'G',
      disabled: mergeable < 2,
    },
  ]);
</script>

<!-- A click on an own group (UI round 2): a small menu on its icon. S, F, X and G do the same. -->
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
  />
{/if}
