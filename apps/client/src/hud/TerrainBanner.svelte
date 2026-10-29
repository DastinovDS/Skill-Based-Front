<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const ui = $derived(orders.ui.current);
  const table = $derived(orders.visionTable);
  /** The three grounds in the order of the table; the pattern of each is a CSS class of the same name. */
  const GROUNDS = ['plains', 'forest', 'mountains'] as const;
  /** Bars filled for a level: the server's word, shown as a count (never a colour alone). */
  const BARS = { exact: 3, range: 2, presence: 1 } as const;
</script>

<!-- The terrain map mode on `T` (#429): says it is on, and the vision table of the rules as its legend. -->
{#if ui.terrainMode}
  <section class="banner" aria-live="polite">
    <strong>{t('terrain.banner')}</strong>
    <span>{t('terrain.hint')}</span>
    <table>
      <caption>{t('terrain.legend')}</caption>
      <thead>
        <tr>
          <td></td>
          {#each GROUNDS as target (target)}
            <th scope="col"><i class="swatch {target}"></i>{t(`terrain.${target}`)}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each GROUNDS as source (source)}
          <tr>
            <th scope="row"><i class="swatch {source}"></i>{t(`terrain.${source}`)}</th>
            {#each GROUNDS as target (target)}
              {@const level = table[source][target]}
              <td>
                <span class="bars" aria-hidden="true">
                  {#each [1, 2, 3] as bar (bar)}
                    <b class="bar h{bar}" class:on={bar <= BARS[level]}></b>
                  {/each}
                </span>
                {t(`terrain.sight.${level}`)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .banner {
    position: absolute;
    /* The HUD is a flex column: without an explicit `top` the banner would stretch from its static position. */
    top: auto;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    max-width: min(560px, calc(100% - 24px));
    padding: 6px 12px 8px;
    box-sizing: border-box;
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    text-align: center;
    pointer-events: none;
  }

  table {
    border-collapse: collapse;
    font-size: 12px;
  }

  caption {
    padding-bottom: 3px;
    color: var(--text-dim, var(--text));
    font-size: 11px;
  }

  th,
  td {
    padding: 2px 8px;
    text-align: left;
    font-weight: 500;
    white-space: nowrap;
  }

  /* The ground swatches: the same marks as the map (dots, firs, hatching), flat colours of the map. */
  .swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-right: 6px;
    vertical-align: -3px;
    border-radius: 3px;
    background-color: var(--ground);
    background-image: var(--mark);
    background-size: var(--tile) var(--tile);
  }
  .plains {
    --ground: #7c9456;
    --tile: 5px;
    --mark: radial-gradient(circle at 50% 50%, rgb(13 17 23 / 55%) 0.9px, transparent 1.2px);
  }
  .forest {
    --ground: #1f5a47;
    --tile: 7px;
    --mark:
      linear-gradient(135deg, transparent 45%, rgb(13 17 23 / 60%) 50%, transparent 55%),
      linear-gradient(45deg, transparent 45%, rgb(13 17 23 / 60%) 50%, transparent 55%);
  }
  .mountains {
    --ground: #6b6d75;
    --tile: 5px;
    --mark: repeating-linear-gradient(45deg, transparent 0 2px, rgb(13 17 23 / 55%) 2px 3px);
  }

  /* Three bars, filled from the left: one presence, two range, three exact. */
  .bars {
    display: inline-flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 10px;
    margin-right: 5px;
    vertical-align: -1px;
  }
  .bar {
    display: block;
    width: 3px;
    box-sizing: border-box;
    border: 0.8px solid var(--paper);
    opacity: 0.6;
  }
  .bar.on {
    background: var(--paper);
    opacity: 1;
  }
  .h1 {
    height: 4px;
  }
  .h2 {
    height: 7px;
  }
  .h3 {
    height: 10px;
  }
</style>
