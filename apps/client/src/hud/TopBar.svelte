<script lang="ts">
  import { sound } from '../audio/soundState.svelte.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { HudChrome } from './chrome.svelte.ts';
  import CpGauge from './CpGauge.svelte';
  import { formatCentis, formatClock } from './format.ts';
  import type { HudData } from './hudData.ts';
  import { LAST_MINUTE_S } from './hudState.svelte.ts';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';
  import { atCap, vpShare } from './topBar.ts';
  import BarGlyph from '../theme/BarGlyph.svelte';
  import CpMark from '../theme/CpMark.svelte';

  interface Props {
    data: HudData | null;
    /** Opens the stance menu and the other overlays. */
    orders: OrderController;
    chrome: HudChrome;
    /** The pause of a private match; without it (none left, or a rated match) the button is not shown. */
    onpause?: () => void;
  }

  let { data, orders, chrome, onpause }: Props = $props();

  /** The key itself is not translated. */
  const STANCE_KEY = 'Q';

  const STANCE_ICONS: Record<'economy' | 'balance' | 'war', IconName> = {
    economy: 'economy',
    balance: 'balance',
    war: 'war',
  };

  const locale = $derived(getLocale());
  const full = $derived(data !== null && atCap(data.cp.value, data.cp.cap));
  const share = $derived(data === null ? 50 : vpShare(data.vp.mine, data.vp.enemy));
  const lastMinute = $derived(data !== null && data.secondsLeft <= LAST_MINUTE_S);
  // The CP do not pay for the move a click would give, or a move was just refused for its CP (#762).
  const short = $derived(orders.ui.current.cpShort);
  const price = $derived(orders.ui.current.cpPrice);
  const factories = $derived(data?.factories ?? null);
  const factoriesFull = $derived(factories !== null && factories.count >= factories.max);
  const next = $derived(data?.stanceProgress ?? null);
</script>

<!-- The Engraved top bar (ui-style 53, the round 5 Combined view): a dark strip under a double rule,
     numbers and signs only; the words are the accessible names and the tooltips. -->
<header class="bar">
  <div class="left">
    {#if data !== null}
      <div
        class="cp"
        class:short
        role="img"
        title={short ? t('bar.cpShortHint') : full ? t('bar.cpMaxHint') : undefined}
        aria-label={tf(short ? 'bar.cpLabelShort' : full ? 'bar.cpLabelMax' : 'bar.cpLabel', {
          value: formatCentis(data.cp.value, locale),
          cap: formatCentis(data.cp.cap, locale),
        })}
      >
        <!-- The CP mark (#841): the sign of command points, never the charge lozenge. -->
        <span class="term"><CpMark size={16} /></span>
        <!-- The Double frame (ui-style 57a): the scale, the next quantum ruled in, the frame at the cap. -->
        <CpGauge
          value={data.cp.value}
          cap={data.cp.cap}
          next={next?.cp.share ?? null}
          {short}
          {price}
          text={formatCentis(data.cp.value, locale)}
        />
      </div>
      <!-- DEC-41, item 2; #762: own factories, builds under way counted, of the max. -->
      {#if factories !== null}
        <span
          class="factories"
          class:full={factoriesFull}
          role="img"
          title={factoriesFull ? t('bar.factoriesFull') : t('bar.factories')}
          aria-label={tf(factoriesFull ? 'bar.factoriesLabelFull' : 'bar.factoriesLabel', {
            count: factories.count,
            max: factories.max,
          })}
        >
          <Icon name="factory" size={22} cut />
          <span class="num">{factories.count}/{factories.max}</span>
        </span>
      {/if}
      <!-- The stance (DEC-44) as its icon, the capital's next charge as a small upright cell, and the key. -->
      <button
        type="button"
        class="chip"
        aria-label={tf('orders.stanceOpen', { stance: t(`stance.${data.stance}`) })}
        title={next === null
          ? undefined
          : tf(orders.factoriesFollow ? 'bar.nextTipAll' : 'bar.nextTip', {
              cp: next.cp.seconds,
              capital: next.capital.seconds,
            })}
        onclick={() => {
          orders.openRadial(true);
        }}
      >
        <Icon name={STANCE_ICONS[data.stance]} size={20} cut />
        {#if next !== null}
          <span class="capital" aria-hidden="true">
            <i style:height="{next.capital.share * 100}%"></i>
          </span>
        {/if}
        <kbd>{STANCE_KEY}</kbd>
      </button>
    {/if}
  </div>

  {#if data !== null}
    <div
      class="score"
      role="img"
      aria-label={tf('bar.scoreLabel', {
        mine: data.nicks.mine,
        enemy: data.nicks.enemy,
        mineVp: data.vp.mine,
        enemyVp: data.vp.enemy,
      })}
    >
      <HelmetIcon side="own" size={22} engraved />
      <span class="vp mine-vp">{data.vp.mine}</span>
      <span class="tug" aria-hidden="true">
        <span class="tug-mine" style:flex-basis="{share}%"></span>
        <span class="tug-enemy"></span>
      </span>
      <span class="vp enemy-vp">{data.vp.enemy}</span>
      <HelmetIcon side="enemy" size={22} engraved />
    </div>
  {:else}
    <div></div>
  {/if}

  <div class="right">
    {#if data !== null}
      <span class="timer" class:last={lastMinute} role="timer" aria-label={t('status.time')}>
        <BarGlyph name="clock" size={17} />
        <span class="time">{formatClock(data.secondsLeft)}</span>
      </span>
    {/if}
    {#if onpause !== undefined}
      <button
        type="button"
        class="icon-button"
        aria-label={t('match.pause')}
        title={t('match.pause')}
        onclick={onpause}
      >
        <BarGlyph name="pause" />
      </button>
    {/if}
    <button
      type="button"
      class="icon-button"
      aria-label={sound.muted ? t('bar.soundOff') : t('bar.soundOn')}
      aria-pressed={sound.muted}
      title={tf('bar.soundTip', {
        tip: sound.muted ? t('bar.soundOff') : t('bar.soundOn'),
      })}
      onclick={() => {
        sound.toggleMute();
      }}
    >
      <BarGlyph name={sound.muted ? 'soundOff' : 'soundOn'} />
    </button>
    <button
      type="button"
      class="icon-button"
      aria-label={t('bar.help')}
      aria-expanded={chrome.helpOpen}
      title={t('bar.help')}
      onclick={() => {
        chrome.helpOpen = !chrome.helpOpen;
      }}
    >
      <BarGlyph name="help" />
    </button>
    <button
      type="button"
      class="icon-button"
      aria-label={t('bar.exit')}
      title={t('bar.exit')}
      onclick={() => {
        chrome.openExit();
      }}
    >
      <BarGlyph name="exit" />
    </button>
  </div>
</header>

<style>
  .bar {
    pointer-events: auto;
    box-sizing: border-box;
    height: 52px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 0 18px;
    /* The double rule under the strip: a rule, a dark gap, a faint second rule. */
    border-bottom: 1px solid rgb(236 228 209 / 55%);
    background: rgb(14 12 9 / 96%);
    box-shadow:
      0 3px 0 rgb(14 12 9 / 96%),
      0 4px 0 rgb(236 228 209 / 22%);
    color: var(--ink);
    font: 18px/1 var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .right {
    justify-content: flex-end;
    gap: 8px;
  }

  /* A framed control: one rule, a dark gap and a faint inner rule (ui-style 53). */
  button {
    box-sizing: border-box;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 9px;
    border: 1px solid rgb(236 228 209 / 60%);
    border-radius: 0;
    background: none;
    box-shadow:
      inset 0 0 0 2px var(--plate),
      inset 0 0 0 3px rgb(236 228 209 / 22%);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--ink);
    background: rgb(236 228 209 / 6%);
  }

  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  .icon-button {
    width: 30px;
    padding: 0;
  }

  .cp {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .term {
    display: inline-flex;
  }

  .num {
    white-space: nowrap;
  }

  /* The factory counter: the cut factory and own/max; at the max a dashed frame (shape, not colour). */
  .factories {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 19px;
  }

  .factories.full {
    outline: 1px dashed rgb(236 228 209 / 50%);
    outline-offset: 3px;
    color: var(--ink-dim);
  }

  /* The capital's next charge: a small upright cell that fills ruled from the bottom (DEC-44). */
  .capital {
    position: relative;
    display: inline-block;
    width: 12px;
    height: 16px;
    box-sizing: border-box;
    border: 1px solid var(--ink);
    box-shadow: 0 0 0 2px var(--plate);
  }

  .capital i {
    position: absolute;
    left: 1px;
    right: 1px;
    bottom: 1px;
    max-height: calc(100% - 2px);
    background: repeating-linear-gradient(0deg, var(--own) 0 1px, transparent 1px 2.5px);
  }

  kbd {
    padding: 0 4px;
    border: 1px solid rgb(236 228 209 / 40%);
    color: var(--ink-dim);
    font: 500 11px/14px var(--font-display);
    letter-spacing: 0.06em;
  }

  .score {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .vp {
    min-width: 1.2ch;
    font-size: 27px;
    font-weight: 500;
    text-align: center;
  }

  .mine-vp {
    color: var(--own);
  }

  .enemy-vp {
    color: var(--enemy);
  }

  /* The tug of war: a ruled band, mine solid, the enemy's hatched at 45 degrees, a tick at the half. */
  .tug {
    position: relative;
    display: flex;
    box-sizing: content-box;
    width: clamp(80px, 14vw, 190px);
    height: 8px;
    padding: 1px 0;
    border-top: 1px solid var(--ink);
    border-bottom: 1px solid var(--ink);
  }

  .tug::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -5px;
    bottom: -5px;
    width: 1px;
    background: var(--ink);
    opacity: 0.55;
  }

  .tug-mine {
    flex: 0 0 auto;
    background: var(--own);
  }

  .tug-enemy {
    flex: 1 1 0;
    background: var(--hatch-enemy);
  }

  .timer {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 8px;
  }

  .time {
    font-size: 27px;
  }

  /* The last minute: amber, heavier and a size up (more than the colour tells it). */
  .timer.last {
    color: var(--warn);
  }

  .timer.last .time {
    font-size: 31px;
    font-weight: 700;
  }

  @media (max-width: 960px) {
    .bar {
      padding: 0 10px;
    }

    .factories,
    .term {
      display: none;
    }
  }
</style>
