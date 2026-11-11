<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import CpMark from '../theme/CpMark.svelte';
  import LapisButton from '../theme/LapisButton.svelte';
  import RuleFrame from '../theme/RuleFrame.svelte';
  import SectionLabel from '../theme/SectionLabel.svelte';
  import StoneOverlay from '../theme/StoneOverlay.svelte';

  interface Props {
    /** `sheet`: the specimen of the style foundation; `overlay`: the stone overlay with a dialog. */
    part: 'sheet' | 'overlay';
  }

  let { part }: Props = $props();

  // The scene `?menu=style` (#841): every primitive and token of the style foundation on one page,
  // for `mise run shots`; `?menu=style-overlay` lays the stone overlay over the main menu.
  const MARK_SIZES = [12, 14, 16, 24, 48] as const;
  const SWATCHES = [
    'stone-bg',
    'stone-panel',
    'stone-raised',
    'ink',
    'ink-dim',
    'rule',
    'line',
    'plate',
    'own',
    'enemy',
    'neutral',
    'vp',
    'warn',
  ] as const;

  function swatch(node: HTMLElement, name: string): void {
    node.style.background = `var(--${name})`;
  }
</script>

{#if part === 'sheet'}
  <main class="specimen">
    <h1 class="title">{t('app.title')}</h1>
    <div class="cols">
      <section class="col">
        <SectionLabel>{t('result.title')}</SectionLabel>
        <p class="text">{t('result.reason.timer.win')}</p>
        <p class="text italic">{t('menu.guestHint')}</p>
        <p class="numerals">1480 · 0123456789</p>

        <SectionLabel>{t('menu.play')}</SectionLabel>
        <div class="row">
          <LapisButton variant="primary" size="lg">{t('menu.play')}</LapisButton>
        </div>
        <div class="row">
          <LapisButton variant="primary">{t('menu.bot')}</LapisButton>
          <LapisButton variant="primary" disabled>{t('menu.lobby')}</LapisButton>
        </div>
        <div class="row">
          <LapisButton>{t('menu.create')}</LapisButton>
          <LapisButton size="sm">{t('common.back')}</LapisButton>
          <LapisButton danger size="sm">{t('exit.confirm')}</LapisButton>
        </div>
      </section>

      <section class="col">
        <RuleFrame as="section" class="panel">
          <SectionLabel as="h2" rule={false}>{t('result.rating')}</SectionLabel>
          <p class="big">1480</p>
          <SectionLabel>{t('result.stat.attacksWon')}</SectionLabel>
          <p class="text">{tf('result.stat.outOf', { n: 4, total: 7 })}</p>
        </RuleFrame>

        <div class="marks" role="img" aria-label={tf('bar.cpLabel', { value: '3', cap: '5' })}>
          {#each MARK_SIZES as size (size)}
            <span class="pair">
              <CpMark {size} />
              <svg
                class="charge"
                viewBox="-5 -5 10 10"
                width={size}
                height={size}
                aria-hidden="true"
              >
                <rect x="-3.2" y="-3.2" width="6.4" height="6.4" transform="rotate(45)" />
              </svg>
            </span>
          {/each}
        </div>
        <p class="readout">
          <CpMark size={16} /><span class="num">3.5</span><span class="cap">/5</span>
        </p>

        <div class="swatches" aria-hidden="true">
          {#each SWATCHES as name (name)}
            <span class="swatch" use:swatch={name}></span>
          {/each}
          <span class="swatch hatch-own"></span>
          <span class="swatch hatch-enemy"></span>
        </div>
      </section>
    </div>
  </main>
{:else}
  <StoneOverlay label={t('exit.title')}>
    <p class="lapis-label">{t('exit.eyebrow')}</p>
    <h2 class="dlg-title">{t('exit.title')}</h2>
    <p class="text">{t('exit.text')}</p>
    <div class="row acts">
      <LapisButton variant="primary">{t('exit.stay')}</LapisButton>
      <LapisButton danger>{t('exit.confirm')}</LapisButton>
    </div>
  </StoneOverlay>
{/if}

<style>
  .specimen {
    position: fixed;
    inset: 0;
    overflow: auto;
    padding: 36px 64px;
    box-sizing: border-box;
    background: var(--stone-tex) var(--stone-bg);
    color: var(--ink);
  }

  .title {
    margin: 0 0 24px;
    font: 400 56px / 1.1 var(--font-display);
    letter-spacing: 0.15em;
    text-shadow:
      0 -1px 0 #000,
      0 2px 0 rgb(236 228 209 / 12%);
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 32px 72px;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .text {
    margin: 0;
    font-size: 18px;
  }

  .italic {
    font-style: italic;
    color: var(--ink-dim);
  }

  .numerals {
    margin: 0;
    font-size: 30px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
  }

  .specimen :global(.panel) {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 26px 30px;
  }

  .big {
    margin: 0;
    font-size: 42px;
    line-height: 1;
  }

  .marks {
    display: flex;
    align-items: flex-end;
    gap: 22px;
  }

  .pair {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .charge rect {
    fill: var(--own);
    stroke: var(--casing);
    stroke-width: 1;
  }

  .readout {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 23px;
  }

  .readout .cap {
    color: var(--ink-dim);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .swatch {
    width: 28px;
    height: 28px;
    box-shadow: inset 0 0 0 1px var(--cut);
  }

  .hatch-own {
    background: var(--hatch-own);
  }

  .hatch-enemy {
    background: var(--hatch-enemy);
  }

  .dlg-title {
    margin: 6px 0 12px;
    font: 400 28px / 1.2 var(--font-display);
    letter-spacing: 0.1em;
  }

  .acts {
    margin-top: 28px;
  }
</style>
