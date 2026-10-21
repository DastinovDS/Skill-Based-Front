<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { FightCard, RoundSide } from '../match/fightLog.ts';
  import FightGlyph from './FightGlyph.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** The fights going on with the rounds seen of each; the server's numbers, nothing computed. */
    fights: readonly FightCard[];
  }

  let { fights }: Props = $props();

  /** Cards on screen at once; the rest is told as a count. */
  const MAX_CARDS = 3;

  const shown = $derived(fights.slice(0, MAX_CARDS));
  const hidden = $derived(Math.max(0, fights.length - MAX_CARDS));

  function place(card: FightCard): string {
    return card.node === null
      ? tf('fight.place.edge', { edge: card.edge ?? 0 })
      : tf('fight.place.node', { node: card.node });
  }

  /** A cell read aloud: the shapes below are for the eyes. */
  function cell(side: RoundSide): string {
    return tf('fight.cell', {
      shots: side.shots,
      virtual: side.virtual,
      spent: side.spent,
      losses: side.losses,
    });
  }

  /** The sides of a pair of cells, the player's first. */
  const sidesOf = (own: RoundSide, enemy: RoundSide) =>
    [
      { who: 'own', side: own },
      { who: 'enemy', side: enemy },
    ] as const;

  /** The virtual (bonus) shots come first in a round, the real ones after (DEC-24, item B4). */
  const pips = (side: RoundSide): boolean[] =>
    Array.from({ length: side.shots }, (_, i) => i < side.virtual);
</script>

<!-- The fight board (DEC-24, DEC-29; #295): per fight going on, every round seen: the shots of both
     sides (a disc: real, a diamond: bonus), the charges spent (bolt) and the units killed (triangle). -->
{#if shown.length > 0}
  <section class="board" aria-label={t('fight.board')}>
    {#each shown as card (card.id)}
      <article class="card" aria-label={place(card)} data-fight={card.id}>
        <header>
          <Icon name="war" size={14} />
          <span class="place">{place(card)}</span>
        </header>
        <div class="sides" aria-hidden="true">
          <span class="side own">{t('fight.own')}</span>
          <span class="side enemy">{t('fight.enemy')}</span>
        </div>
        <ul class="rows">
          {#each card.rows as row (row.tick)}
            <li class="row">
              {#each sidesOf(row.own, row.enemy) as { who, side } (who)}
                <span class="cell {who}" aria-label={cell(side)} role="img">
                  <span class="pips" aria-hidden="true">
                    {#each pips(side) as virtual, i (i)}
                      <FightGlyph kind={virtual ? 'bonus' : 'shot'} />
                    {/each}
                  </span>
                  <span class="num" aria-hidden="true">
                    {#if side.spent > 0}<FightGlyph kind="spent" />{side.spent}{/if}
                  </span>
                  <span class="num" aria-hidden="true">
                    {#if side.losses > 0}<FightGlyph kind="unit" />{side.losses}{/if}
                  </span>
                </span>
              {/each}
            </li>
          {/each}
          {#if !card.complete}
            <li class="gap" title={t('fight.earlier')} aria-label={t('fight.earlier')}>…</li>
          {/if}
        </ul>
        {#if card.totals !== null}
          <div class="totals" title={t('fight.totals')} aria-label={t('fight.totals')}>
            {#each [{ who: 'own', total: card.totals.own }, { who: 'enemy', total: card.totals.enemy }] as { who, total } (who)}
              <span class="cell {who}">
                <span class="pips" aria-hidden="true">
                  <FightGlyph kind="shot" /><span class="count">{total.shots}</span>
                </span>
                <span class="num" aria-hidden="true">
                  <FightGlyph kind="unit" /><span class="count">{total.losses}</span>
                </span>
              </span>
            {/each}
          </div>
        {/if}
      </article>
    {/each}
    {#if hidden > 0}
      <p class="more">{tf('fight.more', { n: hidden })}</p>
    {/if}
    <p class="legend" aria-hidden="true">
      <span><FightGlyph kind="shot" />{t('fight.legend.shot')}</span>
      <span><FightGlyph kind="bonus" />{t('fight.legend.bonus')}</span>
      <span><FightGlyph kind="spent" />{t('fight.legend.spent')}</span>
      <span><FightGlyph kind="unit" />{t('fight.legend.lost')}</span>
    </p>
  </section>
{/if}

<style>
  .board {
    position: absolute;
    bottom: 12px;
    left: 12px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(224px, calc(100% - 24px));
    pointer-events: none;
  }

  .card {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--paper);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    pointer-events: auto;
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    font-size: 13px;
    font-weight: 600;
  }

  .sides,
  .row,
  .totals {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .side {
    padding-bottom: 2px;
    color: var(--text-dim);
    font-size: 11px;
    border-bottom: 2px solid currentColor;
  }

  /* Own: one line under the name, the enemy's: a double one (ui-style 5, item 3). */
  .side.own {
    color: var(--you);
  }

  .side.enemy {
    color: var(--enemy);
    border-bottom-style: double;
    border-bottom-width: 4px;
    text-align: right;
  }

  .rows {
    max-height: 108px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  .row {
    padding: 2px 0;
    border-bottom: 1px solid var(--border);
    animation: round-in 320ms ease-out;
  }

  .cell {
    display: grid;
    grid-template-columns: 1fr 30px 30px;
    align-items: center;
    gap: 2px;
    min-height: 16px;
  }

  .cell.own {
    color: var(--you);
  }

  .cell.enemy {
    color: var(--enemy);
  }

  .pips {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
  }

  .num {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .gap {
    color: var(--text-dim);
    text-align: center;
  }

  .totals {
    margin-top: 4px;
    padding-top: 3px;
    border-top: 2px solid var(--border);
    font-weight: 600;
  }

  .count {
    margin-left: 2px;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .more,
  .legend {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--surface);
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  @keyframes round-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row {
      animation: none;
    }
  }
</style>
