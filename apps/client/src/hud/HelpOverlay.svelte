<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../i18n/index.ts';
  import Icon from './Icon.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let close: HTMLButtonElement | undefined = $state();

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
    ['?', 'help.key.help'],
    ['Esc', 'help.key.escape'],
  ] as const;
</script>

{#if open}
  <div class="backdrop">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <header>
        <h2 id="help-title">{t('help.title')}</h2>
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
      <div class="columns">
        <section aria-labelledby="help-legend">
          <h3 id="help-legend">{t('help.legend')}</h3>
          <ul class="legend">
            <li>
              <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                <path d="M3 3h22L14 21z" class="you" />
              </svg>
              {t('help.legend.mine')}
            </li>
            <li>
              <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                <path d="M3 3h22L14 21z" class="enemy" />
                <path d="M8.5 6.5h11L14 15.5z" class="inner" />
              </svg>
              {t('help.legend.enemy')}
            </li>
            <li>
              <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                <path d="M3 3h22L14 21z" class="you" />
                <path d="M8.5 6.5h11L14 15.5z" class="fill" />
              </svg>
              {t('help.legend.charge')}
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
              <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                <path d="M2 4h10l-5 9z" class="you" />
                <path d="M16 4h10l-5 9z" class="thin" />
                <path d="M2 15h10l-5 8z" class="dashed" />
              </svg>
              {t('help.legend.chips')}
            </li>
            <li>
              <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                <path d="M14 4l8 8-8 8-8-8z" class="thin" />
              </svg>
              {t('help.legend.stock')}
            </li>
            <li>
              <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                <circle cx="14" cy="12" r="7" class="silent" />
                <path d="M9 17L19 7" class="silent" />
              </svg>
              {t('help.legend.silent')}
            </li>
            <li>
              <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true">
                <path d="M2 18q12-18 20-6" class="dashed" />
                <path d="M22 12l-3 -4 -3 4 3 4z" class="thin" />
              </svg>
              {t('help.legend.bonusShot')}
            </li>
          </ul>
          <p class="link">
            <button type="button" disabled aria-disabled="true" title={t('help.howToSoon')}>
              {t('help.howTo')}
            </button>
          </p>
        </section>
        <section aria-labelledby="help-keys">
          <h3 id="help-keys">{t('help.keys')}</h3>
          <dl class="keys">
            {#each KEYS as [label, text] (text)}
              <dt><kbd>{label}</kbd></dt>
              <dd>{t(text)}</dd>
            {/each}
          </dl>
          <p class="note">{t('help.camera')}</p>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
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
    padding: 14px 18px 18px;
    border: 1px solid var(--border);
    border-radius: 8px;
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
    font-size: 18px;
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
    border-radius: 4px;
  }

  .close:focus-visible,
  .link button:focus-visible {
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

  .you {
    fill: var(--you);
    stroke: var(--paper);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  .enemy {
    fill: var(--enemy);
    stroke: var(--paper);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  .inner {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .fill {
    fill: var(--paper);
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
  .silent {
    fill: none;
    stroke: var(--warn);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .link {
    margin-top: 12px;
  }

  .link button {
    padding: 4px 10px;
    font: inherit;
    color: var(--text-dim);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
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
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--surface-2);
    font: inherit;
    font-size: 12px;
  }

  .note {
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
