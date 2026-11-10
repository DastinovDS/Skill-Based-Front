<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import type { GroupChoice } from './hudData.ts';

  interface Props {
    orders: OrderController;
    /** The own groups of the snapshot on screen (`HudData.groups`). */
    groups: readonly GroupChoice[];
  }

  let { orders, groups }: Props = $props();

  // DEC-48, item K8 (A3 "card"): the groups selected together, in the order of the selection (the
  // order decides the remainder of a planned bonus, item F2), one helmet each with its units.
  const picked = $derived.by(() => {
    const ui = orders.ui.current;
    if (ui.terrainMode) return [];
    return ui.picks
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is GroupChoice => g !== undefined);
  });
</script>

<!-- The selection card at the bottom left (A3): only while two or more groups are selected. -->
{#if picked.length >= 2}
  <section class="card" aria-label={t('picks.title')}>
    <p class="count">{tf('picks.count', { count: picked.length })}</p>
    <ol>
      {#each picked as group, i (group.id)}
        <li
          aria-label={tf('picks.group', {
            place: i + 1,
            units: group.units,
            charged: group.charged,
          })}
        >
          <HelmetIcon
            side="own"
            engraved
            size={30}
            share={group.units > 0 ? group.charged / group.units : 0}
          />
          <span class="units" aria-hidden="true">{group.units}</span>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  /* Bottom left, like the banners of the map modes (which hide it): an Engraved plate in a double rule. */
  .card {
    position: absolute;
    top: auto;
    bottom: 12px;
    left: 12px;
    z-index: 4;
    width: max-content;
    max-width: calc(100% - 24px);
    padding: 6px 10px 5px;
    box-sizing: border-box;
    border: 1px solid rgb(236 228 209 / 60%);
    background: rgb(14 12 9 / 94%);
    box-shadow:
      inset 0 0 0 3px rgb(14 12 9 / 94%),
      inset 0 0 0 4px rgb(236 228 209 / 25%);
    color: var(--ink);
    pointer-events: none;
  }

  /* The count is for the screen reader: the helmets say it to the eye. */
  .count {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  ol {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 32px;
  }

  .units {
    margin-top: 1px;
    font: 600 14px/1.1 var(--font-num, var(--font-text));
    font-variant-numeric: tabular-nums;
  }
</style>
