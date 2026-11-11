<script lang="ts">
  import { untrack } from 'svelte';
  import { sound } from '../audio/soundState.svelte.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import { getLocale, t, tf } from '../i18n/index.ts';
  import { keyBindings } from '../app/keyBindingsState.svelte.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { HudChrome } from './chrome.svelte.ts';
  import CpGauge from './CpGauge.svelte';
  import { formatCentis, formatClock } from './format.ts';
  import type { HudData } from './hudData.ts';
  import { LAST_MINUTE_S } from './hudState.svelte.ts';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';
  import type { NodeNamer } from './nodeName.ts';
  import { NO_ANCHORS, type MapAnchors } from '../render/anchors.ts';
  import { reducedMotion } from '../render/motion.ts';
  import RollNum from './RollNum.svelte';
  import { atCap, railTicks, vpShare } from './topBar.ts';
  import BarGlyph from '../theme/BarGlyph.svelte';
  import CpMark from '../theme/CpMark.svelte';

  interface Props {
    data: HudData | null;
    /** Opens the stance menu and the other overlays. */
    orders: OrderController;
    chrome: HudChrome;
    /** The pause of a private match; without it (none left, or a rated match) the button is not shown. */
    onpause?: () => void;
    /** Where the cities are on screen: a paid rally walk flies its CP mark from its city (#930). */
    anchors?: MapAnchors;
    /** The name of a place by its id (the accessible name of a walk the CP do not pay). */
    names?: NodeNamer;
  }

  let {
    data,
    orders,
    chrome,
    onpause,
    anchors = NO_ANCHORS,
    names = (node: number) => String(node),
  }: Props = $props();

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

  // #930, W10: the walks to rally points the CP will pay (the accessible name of the gauge).
  const rally = $derived(data?.rally ?? null);
  const firstDue = $derived(rally?.dues[0] ?? null);
  const cpLabel = $derived.by(() => {
    if (data === null) return '';
    const value = formatCentis(data.cp.value, locale);
    const cap = formatCentis(data.cp.cap, locale);
    if (short) return tf('bar.cpLabelShort', { value, cap });
    if (rally !== null && firstDue !== null && rally.nextSeconds !== null) {
      if (firstDue.short) {
        return tf('bar.cpLabelDueShort', {
          value,
          cap,
          seconds: rally.nextSeconds,
          node: names(firstDue.node),
        });
      }
      return tf('bar.cpLabelDue', {
        value,
        cap,
        count: rally.dues.length,
        cost: formatCentis(rally.cost, locale),
        seconds: rally.nextSeconds,
      });
    }
    return tf(full ? 'bar.cpLabelMax' : 'bar.cpLabel', { value, cap });
  });

  // #930, P1 "Ruled rail": the way to the next VP credit, ruled in gilt under the tug; each side's
  // gain by its total, sliding into it at the credit as the totals roll.
  const vpNext = $derived(data?.vpNext ?? null);
  const countdown = $derived(vpNext?.countdown ?? null);
  const ticks = $derived(vpNext === null ? [] : railTicks(vpNext.period, vpNext.tickHz));
  // "Less motion": the rail steps once a second (it is information, not decoration).
  const railShare = $derived.by(() => {
    if (countdown === null) return 0;
    if (!reducedMotion() || vpNext === null) return countdown.share;
    const seconds = vpNext.period / vpNext.tickHz;
    return Math.floor(countdown.share * seconds + 1e-6) / seconds;
  });
  const railSeconds = $derived(
    countdown === null ? null : Math.max(1, Math.ceil(countdown.ticks / (vpNext?.tickHz ?? 10))),
  );
  // A credit seen while the bar is up rolls (`creditKey` > 0); the first one seen does not.
  let creditKey = $state(0);
  let creditSeen: number | null = null;
  const credit = $derived(vpNext?.credit ?? null);
  $effect(() => {
    const seq = credit?.seq ?? 0;
    if (data === null) return;
    if (creditSeen !== null && seq > creditSeen && !reducedMotion()) {
      creditKey = untrack(() => creditKey) + 1;
    }
    creditSeen = seq;
  });
  const scoreLabel = $derived.by(() => {
    if (data === null) return '';
    const base = {
      mine: data.nicks.mine,
      enemy: data.nicks.enemy,
      mineVp: data.vp.mine,
      enemyVp: data.vp.enemy,
    };
    if (vpNext === null || railSeconds === null) return tf('bar.scoreLabel', base);
    return tf('bar.scoreLabelNext', {
      ...base,
      seconds: railSeconds,
      mineGain: vpNext.gain.mine,
      enemyGain: vpNext.gain.enemy,
    });
  });
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
        aria-label={cpLabel}
      >
        <!-- The CP mark (#841): the sign of command points, never the charge lozenge. -->
        <span class="term"><CpMark size={16} /></span>
        <!-- The Double frame (ui-style 57a): the scale, the next quantum ruled in, the frame at the cap. -->
        <CpGauge
          value={data.cp.value}
          cap={data.cp.cap}
          next={next?.cp.share ?? null}
          quantum={data.cp.quantum}
          {short}
          {price}
          text={formatCentis(data.cp.value, locale)}
          dues={data.rally.dues}
          walkCost={data.rally.cost}
          paid={data.rally.paid}
          {anchors}
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
        aria-label={tf('orders.stanceOpen', {
          stance: t(`stance.${data.stance}`),
          stanceKey: keyBindings.label('stance'),
        })}
        title={next === null
          ? undefined
          : tf(orders.factoriesFollow ? 'bar.nextTipAll' : 'bar.nextTip', {
              amount: formatCentis(data.cp.quantum, locale),
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
        <kbd>{keyBindings.label('stance')}</kbd>
      </button>
    {/if}
  </div>

  {#if data !== null}
    <div class="score" class:railed={countdown !== null} role="img" aria-label={scoreLabel}>
      <HelmetIcon side="own" size={22} engraved />
      <span class="total mine" aria-hidden="true">
        {#if vpNext !== null && countdown !== null}
          {#key creditKey}
            {#if creditKey > 0 && credit !== null}
              <span class="gain mine slide">+{credit.mine}</span>
            {/if}
            <span class="gain mine" class:after={creditKey > 0}>
              <RollNum text="+{vpNext.gain.mine}" travel={8} />
            </span>
          {/key}
        {/if}
        <span class="vp mine-vp"><RollNum text={String(data.vp.mine)} delayMs={300} /></span>
      </span>
      <span class="tugbox" aria-hidden="true">
        <span class="tug">
          <span class="tug-mine" style:flex-basis="{share}%"></span>
          <span class="tug-enemy"></span>
        </span>
        {#if countdown !== null}
          <!-- P1: the period ruled in gilt up to now, a tick every 5 s, the gilt lozenge at the
               credit. A new period is a new fill: it does not run back. -->
          <span class="rail">
            {#key countdown.round}
              <span class="rail-fill" class:still={reducedMotion()} style:width="{railShare * 100}%"
              ></span>
            {/key}
            {#each ticks as tick, i (i)}
              <i
                class="rail-tick"
                class:end={i === 0 || i === ticks.length - 1}
                style:left="{tick * 100}%"
              ></i>
            {/each}
            <span class="rail-loz" class:full={railShare > 0.985}></span>
          </span>
        {/if}
      </span>
      <span class="total enemy" aria-hidden="true">
        <span class="vp enemy-vp"><RollNum text={String(data.vp.enemy)} delayMs={300} /></span>
        {#if vpNext !== null && countdown !== null}
          {#key creditKey}
            {#if creditKey > 0 && credit !== null}
              <span class="gain enemy slide">+{credit.enemy}</span>
            {/if}
            <span class="gain enemy" class:after={creditKey > 0}>
              <RollNum text="+{vpNext.gain.enemy}" travel={8} />
            </span>
          {/key}
        {/if}
      </span>
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
        muteKey: keyBindings.label('mute'),
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

  .total {
    position: relative;
    display: inline-flex;
  }

  /* Room for the gain beside the total, on its outer side (P1). */
  .railed .total.mine {
    margin-left: 22px;
  }

  .railed .total.enemy {
    margin-right: 22px;
  }

  /* The gain each side gets at the next credit, high by its total, in its side's colour (the side
     tells it, not only the hue: it stands by its own total and helmet). */
  .gain {
    position: absolute;
    bottom: 58%;
    display: inline-flex;
    font: 600 16px/1 var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
    white-space: nowrap;
  }

  .gain.mine {
    right: calc(100% + 1px);
    color: var(--own);
  }

  .gain.enemy {
    left: calc(100% + 1px);
    color: var(--enemy);
  }

  /* At the credit the gains slide into their totals and fade (0.55 s), the totals roll up after
     0.3 s, and the next gains ink in from 1.2 s (the mockup's roll). */
  .gain.slide.mine {
    animation: slide-mine 550ms var(--ease-engrave) both;
  }

  .gain.slide.enemy {
    animation: slide-enemy 550ms var(--ease-engrave) both;
  }

  .gain.after {
    animation: gain-in 1600ms linear both;
  }

  @keyframes slide-mine {
    0% {
      transform: none;
      opacity: 1;
    }
    45% {
      opacity: 1;
    }
    100% {
      transform: translate(13px, 7px);
      opacity: 0;
    }
  }

  @keyframes slide-enemy {
    0% {
      transform: none;
      opacity: 1;
    }
    45% {
      opacity: 1;
    }
    100% {
      transform: translate(-13px, 7px);
      opacity: 0;
    }
  }

  @keyframes gain-in {
    0%,
    75% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
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

  /* The tug over the rail: the pair stands a little low, so the tug sits above the bar's middle. */
  .tugbox {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .railed .tugbox {
    transform: translateY(3px);
    /* The gilt lozenge hangs 14 px past the rail's end: this and the score's gap keep it clear of
       the opponent's total, whatever its width (#940). */
    margin-right: 10px;
  }

  /* P1, the Ruled rail: a casing, the period ruled upright in gilt to now behind a burin edge, an
     ink hairline under it with a tick every 5 s hanging down, the gilt lozenge of the credit. */
  .rail {
    position: relative;
    box-sizing: border-box;
    height: 10px;
    margin-right: 0;
  }

  .rail::before {
    content: '';
    position: absolute;
    left: -1px;
    right: -1px;
    top: 0;
    height: 6px;
    background: var(--casing);
  }

  .rail::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 5px;
    height: 1px;
    background: var(--ink);
  }

  .rail-fill {
    position: absolute;
    left: 0;
    top: 1px;
    height: 4px;
    background: repeating-linear-gradient(90deg, var(--vp) 0 1px, transparent 1px 2.4px);
    transition: width 100ms linear;
  }

  .rail-fill.still {
    transition: none;
  }

  /* The burin edge of the fill. */
  .rail-fill::after {
    content: '';
    position: absolute;
    right: -0.8px;
    top: -0.5px;
    width: 1.4px;
    height: 5px;
    background: var(--ink);
  }

  .rail-tick {
    position: absolute;
    top: 5px;
    width: 1px;
    height: 3px;
    margin-left: -0.5px;
    background: var(--ink);
    opacity: 0.85;
  }

  .rail-tick.end {
    height: 5px;
    opacity: 1;
  }

  .rail-loz {
    position: absolute;
    right: -11px;
    top: -1px;
    box-sizing: border-box;
    width: 6.5px;
    height: 6.5px;
    border: 1px solid var(--vp);
    background: var(--plate);
    box-shadow: 0 0 0 1.4px var(--casing);
    transform: rotate(45deg);
  }

  .rail-loz.full {
    background: var(--vp);
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
    /* The share eases after a credit, behind the totals' roll. */
    transition: flex-basis 700ms var(--ease-engrave) 300ms;
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

  :global(:root[data-motion='reduced']) .gain.slide {
    display: none;
  }

  :global(:root[data-motion='reduced']) .gain.after,
  :global(:root[data-motion='reduced']) .tug-mine {
    animation: none !important;
    transition: none !important;
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
