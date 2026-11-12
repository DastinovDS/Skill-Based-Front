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
  import type { KeyAction } from '../app/keyBindings.ts';
  import { keyBindings } from '../app/keyBindingsState.svelte.ts';

  interface Props {
    open: boolean;
    onclose: () => void;
    /** `ruleset_public.capture.charge_cost` (DEC-38): with more than 0 the help tells the price of a capture. */
    captureCost?: number;
    /**
     * `ruleset_public.group_order` is set (DEC-48): the rows of the selection of several groups and
     * of the group order, no row of the release (items A7, K6).
     */
    groupOrder?: boolean;
    /** `ruleset_public.recruit.rally_point` (DEC-48, item H): the row of `P`. */
    rallyPoint?: boolean;
  }

  let { open, onclose, captureCost = 0, groupOrder = false, rallyPoint = false }: Props = $props();

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

  /**
   * The keys: a label (the key itself, not a translation) and the dictionary key of its effect.
   * The planned order is on `E` (DEC-48, item K2); Shift selects several groups under the group order (item K1).
   * The rebindable keys show their current binding (#966); Shift, the mouse, `?` and Esc are fixed.
   */
  type KeyRow = readonly [string, MessageKey];
  const key = (action: KeyAction): string => keyBindings.label(action);
  const names = $derived(keyBindings.names());
  const keys = $derived<readonly KeyRow[]>([
    ['LMB', groupOrder ? 'help.key.groupOrder' : 'help.key.select'],
    ...(groupOrder
      ? ([
          ['Shift + LMB', 'help.key.selectSeveral'],
          ['Shift + drag', 'help.key.selectBox'],
        ] as const)
      : []),
    [`${key('planned')} + LMB`, 'help.key.planned'],
    [`${key('planned')} + wheel`, 'help.key.planWheel'],
    ...(groupOrder ? [] : ([[key('release'), 'help.key.release']] as const)),
    [key('cancel'), 'help.key.cancel'],
    [key('recruit'), 'help.key.recruit'],
    ...(rallyPoint ? ([[key('rally'), 'help.key.rally']] as const) : []),
    [key('fortify'), 'help.key.fortify'],
    [key('terrain'), 'help.key.terrain'],
    [key('split'), 'help.key.split'],
    [key('merge'), 'help.key.merge'],
    [key('stance'), 'help.key.stance'],
    [key('alert'), 'help.key.alert'],
    [key('fit'), 'help.key.fit'],
    [key('mute'), 'help.key.mute'],
    [key('mark'), 'help.key.mark'],
    ['?', 'help.key.help'],
    ['Esc', 'help.key.escape'],
  ]);
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
                <span class="cell"><HelmetIcon side="own" size={28} engraved /></span>
                {t('help.legend.mineHelmet')}
              </li>
              <li>
                <span class="cell"><HelmetIcon side="enemy" size={28} engraved /></span>
                {t('help.legend.enemyHelmet')}
              </li>
              <li>
                <span class="cell"><HelmetIcon side="own" size={28} share={0.5} engraved /></span>
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
                  <HelmetIcon side="own" size={14} engraved />
                  <HelmetIcon side="own" size={14} share={0} engraved />
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
                {t('help.legend.badgeDown')}
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
                <dd>{tf(text, names)}</dd>
              {/each}
            </dl>
            <p class="note">{t('help.camera')}</p>
            {#if captureCost > 0}
              <p class="note">{tf('help.capture', { n: captureCost })}</p>
            {/if}
            <p class="note">{t('help.economyFlow')}</p>
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
