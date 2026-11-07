<script lang="ts">
  import { tick } from 'svelte';
  import { t, tf } from '../i18n/index.ts';
  import type { MessageKey } from '../i18n/messages.ts';
  import { sound } from '../audio/soundState.svelte.ts';
  import './dialog.css';
  import HowToPlay from '../howto/HowToPlay.svelte';
  import Icon from './Icon.svelte';
  import Slider from './Slider.svelte';
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
    /** `ruleset_public.capture.charge_cost` (DEC-38): with more than 0 the help tells the price of a capture. */
    captureCost?: number;
    /** Plains burn a charge in the first round instead of silencing one (DEC-45). */
    terrainBurn?: boolean;
    /** Economy v2 (DEC-41): the keys of the v1 economy are gone, those of lines and plans come. */
    v2?: boolean;
    /** The automatic supply flow (DEC-43): no lines, the supply level keys instead. */
    flow?: boolean;
    /** Road fortifications (DEC-43, item D): `B` fortifies a road of the selected city. */
    fort?: boolean;
    /** Economy v2 with stances (DEC-44): `Q` is back. */
    stances?: boolean;
  }

  let {
    open,
    onclose,
    captureCost = 0,
    terrainBurn = false,
    v2 = false,
    flow = false,
    fort = false,
    stances = false,
  }: Props = $props();

  let close: HTMLButtonElement | undefined = $state();
  /** The rules page replaces the keys inside the sheet; the match runs on under it (nothing pauses). */
  let page = $state(false);

  /** The button that was pressed leaves the page: the focus goes to a control that stays. */
  function show(next: boolean): void {
    page = next;
    void tick().then(() => close?.focus());
  }

  // A reopened help starts with the keys again.
  $effect(() => {
    if (!open) page = false;
  });

  $effect(() => {
    if (open) void tick().then(() => close?.focus());
  });

  /** The keys: a label (the key itself, not a translation) and the dictionary key of its effect. */
  const KEYS = [
    ['LMB', 'help.key.select'],
    ['Shift + LMB', 'help.key.planned'],
    ['1 / 2', 'help.key.mode'],
    ['X', 'help.key.cancel'],
    ['D', 'help.key.defense'],
    ['R', 'help.key.recruit'],
    ['U', 'help.key.road'],
    ['T', 'help.key.terrain'],
    ['S', 'help.key.split'],
    ['G', 'help.key.merge'],
    ['Q', 'help.key.stance'],
    ['Tab / F2', 'help.key.supply'],
    ['[ / ]', 'help.key.rearMin'],
    ['Space', 'help.key.alert'],
    ['H', 'help.key.fit'],
    ['M', 'help.key.mute'],
    ['?', 'help.key.help'],
    ['Esc', 'help.key.escape'],
  ] as const;

  /** Economy v2 (DEC-41): no Defense, road levels, stances, markers or transfers; lines and plans. */
  const KEYS_V2 = [
    ['LMB', 'help.key.select'],
    ['Shift + LMB', 'help.key.plannedV2'],
    ['Shift + wheel', 'help.key.planWheel'],
    ['F', 'help.key.release'],
    ['X', 'help.key.cancel'],
    ['R', 'help.key.recruit'],
    ['T', 'help.key.terrain'],
    ['S', 'help.key.split'],
    ['G', 'help.key.merge'],
    ['Tab / F2', 'help.key.supplyV2'],
    ['Space', 'help.key.alert'],
    ['H', 'help.key.fit'],
    ['M', 'help.key.mute'],
    ['?', 'help.key.help'],
    ['Esc', 'help.key.escape'],
  ] as const;

  /** The automatic supply flow (DEC-43): the layer shows where charges go, `-` and `=` move the level. */
  const KEYS_FLOW = [
    ['LMB', 'help.key.select'],
    ['Shift + LMB', 'help.key.plannedV2'],
    ['Shift + wheel', 'help.key.planWheel'],
    ['F', 'help.key.release'],
    ['X', 'help.key.cancel'],
    ['R', 'help.key.recruit'],
    ['T', 'help.key.terrain'],
    ['S', 'help.key.split'],
    ['G', 'help.key.merge'],
    ['Tab / F2', 'help.key.supplyFlow'],
    ['- / =', 'help.key.leafShift'],
    ['Space', 'help.key.alert'],
    ['H', 'help.key.fit'],
    ['M', 'help.key.mute'],
    ['?', 'help.key.help'],
    ['Esc', 'help.key.escape'],
  ] as const;

  type KeyRow = readonly [string, MessageKey];

  const economyKeys = $derived.by((): readonly KeyRow[] => {
    if (!flow) return v2 ? KEYS_V2 : KEYS;
    // `B` goes after `R`, the other key of the menu of a city.
    return fort
      ? KEYS_FLOW.flatMap((row): (readonly [string, MessageKey])[] =>
          row[0] === 'R' ? [row, ['B', 'help.key.fortify']] : [row],
        )
      : KEYS_FLOW;
  });

  // `Q` goes after `G`, as in the keys of economy v1.
  const keys = $derived(
    v2 && stances
      ? economyKeys.flatMap((row): KeyRow[] =>
          row[0] === 'G' ? [row, ['Q', 'help.key.stance']] : [row],
        )
      : economyKeys,
  );
</script>

{#if open}
  <div class="backdrop">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <header>
        <h2 id="help-title">{page ? t('help.howTo') : t('help.title')}</h2>
        <button
          type="button"
          class="close"
          bind:this={close}
          aria-label={t('help.close')}
          onclick={onclose}
        >
          <Icon name="x" />
        </button>
      </header>
      {#if page}
        <div class="howto">
          <HowToPlay />
          <p class="link">
            <button
              type="button"
              class="dlg-btn"
              onclick={() => {
                show(false);
              }}
            >
              {t('help.howToBack')}
            </button>
          </p>
        </div>
      {:else}
        <div class="columns">
          <section aria-labelledby="help-legend">
            <h3 id="help-legend">{t('help.legend')}</h3>
            <ul class="legend">
              <li>
                <span class="cell"><HelmetIcon side="own" size={28} /></span>
                {t('help.legend.mineHelmet')}
              </li>
              <li>
                <span class="cell"><HelmetIcon side="enemy" size={28} /></span>
                {t('help.legend.enemyHelmet')}
              </li>
              <li>
                <span class="cell"><HelmetIcon side="own" size={28} share={0.5} /></span>
                {t('help.legend.chargeHelmet')}
              </li>
              <li>
                <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                  <path d="M2 12h20" class="thin" />
                  <path d="M18 7l6 5-6 5" class="thin" />
                </svg>
                {t('help.legend.order')}
              </li>
              <li>
                <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                  <path d="M2 8h16l6 4-6 4H2z" class="ribbon" />
                </svg>
                {t('help.legend.planned')}
              </li>
              <li>
                <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                  <circle cx="14" cy="12" r="8" class="alertring" />
                </svg>
                {t('help.legend.alert')}
              </li>
              <li>
                <span class="cell chips">
                  <HelmetIcon side="own" size={14} />
                  <HelmetIcon side="own" size={14} share={0} />
                </span>
                {t('help.legend.chips')}
              </li>
              <li>
                <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                  <path d="M8 11l6-5 6 5M8 18l6-5 6 5" class="badge-out" />
                  <path d="M8 11l6-5 6 5M8 18l6-5 6 5" class="badge-up" />
                </svg>
                {t('help.legend.badgeUp')}
              </li>
              <li>
                <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                  <path d="M8 9l6 5 6-5" class="badge-out" />
                  <path d="M8 9l6 5 6-5" class="badge-down" />
                </svg>
                {t(terrainBurn ? 'help.legend.badgeDownBurn' : 'help.legend.badgeDown')}
              </li>
              <li>
                <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                  <path d="M2 18q12-18 18-8" class="dashed" />
                  <path d="M16 13l4.5-4.5 4.5 4.5" class="badge-out" />
                  <path d="M16 13l4.5-4.5 4.5 4.5" class="badge-up" />
                </svg>
                {t('help.legend.bonusShot')}
              </li>
            </ul>
            <p class="link">
              <button
                type="button"
                class="dlg-btn"
                onclick={() => {
                  show(true);
                }}
              >
                <Icon name="info" size={18} />{t('help.howTo')}
              </button>
            </p>
          </section>
          <section aria-labelledby="help-keys">
            <h3 id="help-keys">{t('help.keys')}</h3>
            <dl class="keys">
              {#each keys as [label, text] (text)}
                <dt><kbd>{label}</kbd></dt>
                <dd>{t(text)}</dd>
              {/each}
            </dl>
            <p class="note">{t('help.camera')}</p>
            {#if captureCost > 0}
              <p class="note">{tf('help.capture', { n: captureCost })}</p>
            {/if}
            {#if v2}
              <p class="note">{t(flow ? 'help.economyFlow' : 'help.economyV2')}</p>
            {/if}
            <div class="volume">
              <span>{t('help.volume')}</span>
              <Slider
                value={sound.volume}
                min={0}
                max={100}
                step={5}
                label={t('help.volume')}
                oninput={(n: number) => {
                  sound.setVolume(n);
                }}
              />
              <span class="percent">{sound.volume}%</span>
            </div>
          </section>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .volume {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 14px;
  }

  .volume :global(.slider) {
    flex: 1;
    min-width: 0;
  }

  .cell.chips {
    gap: 0;
  }

  .cell {
    display: inline-flex;
    justify-content: center;
    width: 28px;
    flex: none;
  }

  .percent {
    min-width: 3ch;
    text-align: right;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 18;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--scrim);
    pointer-events: auto;
  }

  .sheet {
    box-sizing: border-box;
    width: min(760px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 18px 24px 22px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  h3 {
    margin-bottom: 8px;
    font-size: 14px;
    color: var(--text-dim);
  }

  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    color: inherit;
    cursor: pointer;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .close:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 20px;
    margin-top: 12px;
  }

  .legend {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  svg {
    flex: none;
    overflow: visible;
  }

  .thin {
    fill: none;
    stroke: var(--you);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .ribbon {
    fill: var(--you);
    fill-opacity: 0.35;
    stroke: var(--you);
    stroke-width: 1.6;
  }

  .alertring {
    fill: none;
    stroke: var(--warn);
    stroke-width: 2;
    stroke-dasharray: 4 3;
  }

  /* A dead chip and the arrow of a bonus shot: dashed, so the shape tells without the hue. */
  .dashed {
    fill: none;
    stroke: var(--you);
    stroke-width: 1.8;
    stroke-dasharray: 3 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A charge that does not shoot: the amber crossed circle. */
  /* The chevron badges (#791, ui-style 32): a dark outline under the colour, as on the map. */
  .badge-out,
  .badge-up,
  .badge-down {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .badge-out {
    stroke: var(--bg);
    stroke-width: 5.2;
  }

  .badge-up {
    stroke: var(--badge-up);
    stroke-width: 2.6;
  }

  .badge-down {
    stroke: var(--badge-down);
    stroke-width: 2.6;
  }

  .link {
    margin-top: 12px;
  }

  .howto {
    margin-top: 12px;
  }

  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 14px;
  }

  dt {
    text-align: right;
    white-space: nowrap;
  }

  dd {
    margin: 0;
  }

  kbd {
    padding: 1px 6px;
    border: 1px solid #3d444d;
    border-bottom-width: 2px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
  }

  .note {
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
