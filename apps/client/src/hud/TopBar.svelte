<script lang="ts">
  import { sound } from '../audio/soundState.svelte.ts';
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { HudChrome } from './chrome.svelte.ts';
  import { formatCentis, formatClock } from './format.ts';
  import type { HudData } from './hudData.ts';
  import { LAST_MINUTE_S } from './hudState.svelte.ts';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';
  import { atCap, cpTrack, vpShare } from './topBar.ts';

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
  const track = $derived(data === null ? null : cpTrack(data.cp.value, data.cp.cap));
  const full = $derived(data !== null && atCap(data.cp.value, data.cp.cap));
  const share = $derived(data === null ? 50 : vpShare(data.vp.mine, data.vp.enemy));
  const lastMinute = $derived(data !== null && data.secondsLeft <= LAST_MINUTE_S);
</script>

<header class="bar">
  <div class="left">
    {#if data !== null}
      <div
        class="cp"
        role="img"
        title={full ? t('bar.cpMaxHint') : undefined}
        aria-label={tf(full ? 'bar.cpLabelMax' : 'bar.cpLabel', {
          value: formatCentis(data.cp.value, locale),
          cap: formatCentis(data.cp.cap, locale),
        })}
      >
        <span class="term">{t('status.cp')}</span>
        <!-- Variant C "Track" (#439): one notched pill with a head marker on the growing end. At the
             cap the head goes, a dashed amber ring and the word MAX come: a shape and a word, not a colour. -->
        <span class="gauge" aria-hidden="true">
          <span class="track">
            <span class="fill" style:width="calc((100% - 1px) * {track?.share ?? 0})"></span>
            {#each track?.notches ?? [] as at (at)}
              <span class="notch" style:left="calc({at}% - 1px)"></span>
            {/each}
          </span>
          {#if track?.head === true}
            <span class="head" style:left="calc(2px + (100% - 4px) * {track.share})"></span>
          {/if}
          {#if full}<span class="ring"></span>{/if}
        </span>
        <span class="num">
          {formatCentis(data.cp.value, locale)}/{formatCentis(data.cp.cap, locale)}
        </span>
        {#if full}<span class="max">{t('bar.cpMax')}</span>{/if}
      </div>
      <!-- Economy v2 (DEC-41, item 1) has no stances: the chip is gone. -->
      {#if !orders.v2}
        <button
          type="button"
          class="chip"
          aria-label={tf('orders.stanceOpen', { stance: t(`stance.${data.stance}`) })}
          onclick={() => {
            orders.openRadial(true);
          }}
        >
          <Icon name={STANCE_ICONS[data.stance]} size={16} />
          <span class="chip-name">{t(`stance.${data.stance}`)}</span>
          <kbd>{STANCE_KEY}</kbd>
        </button>
      {/if}
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
      <span class="side mine">
        <svg class="mark" viewBox="0 0 16 14" width="16" height="14" aria-hidden="true">
          <path d="M1.5 1.5h13L8 12.5z" class="one" />
        </svg>
        <span class="nick">{data.nicks.mine}</span>
      </span>
      <span class="vp mine-vp">{data.vp.mine}</span>
      <span class="tug" aria-hidden="true">
        <span class="tug-mine" style:flex-basis="{share}%"></span>
        <span class="tug-enemy"></span>
      </span>
      <span class="vp enemy-vp">{data.vp.enemy}</span>
      <span class="side enemy">
        <span class="nick">{data.nicks.enemy}</span>
        <svg class="mark" viewBox="0 0 16 14" width="16" height="14" aria-hidden="true">
          <path d="M1.5 1.5h13L8 12.5z" class="two-outer" />
          <path d="M4.6 3.6h6.8L8 9.6z" class="two-inner" />
        </svg>
      </span>
    </div>
  {:else}
    <div></div>
  {/if}

  <div class="right">
    {#if data !== null}
      <span class="timer" class:last={lastMinute} role="timer" aria-label={t('status.time')}>
        <Icon name="clock" size={lastMinute ? 20 : 18} />
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
        <Icon name="pause" />
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
      <Icon name={sound.muted ? 'volumeOff' : 'volumeOn'} />
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
      <Icon name="help" />
    </button>
    <button
      type="button"
      class="exit"
      onclick={() => {
        chrome.openExit();
      }}
    >
      <Icon name="logout" size={16} />
      <span class="exit-label">{t('bar.exit')}</span>
    </button>
  </div>
</header>

<style>
  .bar {
    pointer-events: auto;
    box-sizing: border-box;
    height: 48px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .right {
    justify-content: flex-end;
  }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  button:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  .icon-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .icon-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
  }

  .cp {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .term {
    color: var(--text-dim);
  }

  .gauge {
    position: relative;
    flex: none;
    width: 120px;
    height: 12px;
  }

  .track {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border: 1.5px solid var(--you);
    border-radius: 6px;
    background: var(--bg);
  }

  .fill {
    position: absolute;
    inset: 0.5px auto 0.5px 0.5px;
    max-width: calc(100% - 1px);
    border-radius: 4px;
    background: var(--you);
    /* The HUD gets a new value 10 times a second; a linear glide a little longer than one
       snapshot interval turns the steps of the regeneration into a continuous fill. */
    transition: width 120ms linear;
  }

  /* A notch at every whole CP, cut through the fill: the old cells, as ticks. */
  .notch {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--bg);
  }

  /* The head marker: a small triangle over the growing end of the fill. */
  .head {
    position: absolute;
    top: -6px;
    width: 7px;
    height: 5px;
    margin-left: -3.5px;
    background: var(--paper);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    transition: left 120ms linear;
  }

  /* At the cap: a dashed amber ring round the track (the word MAX is beside the number). */
  .ring {
    position: absolute;
    inset: -3px;
    border: 1.6px dashed var(--warn);
    border-radius: 9px;
    animation: cp-pulse 0.8s ease-in-out infinite;
  }

  .max {
    padding: 0 6px;
    border: 1.4px solid var(--warn);
    border-radius: 8px;
    color: var(--warn);
    font-size: 11px;
    font-weight: 700;
    line-height: 13px;
    animation: cp-pulse 0.8s ease-in-out infinite;
  }

  @keyframes cp-pulse {
    0%,
    100% {
      opacity: 0.45;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring,
    .max {
      animation: none;
    }

    .fill,
    .head {
      transition: none;
    }
  }

  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 8px;
    white-space: nowrap;
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  kbd {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
  }

  .score {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .side {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 14ch;
  }

  .nick {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mark {
    flex: none;
  }

  .one {
    fill: var(--you);
    stroke: var(--paper);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .two-outer {
    fill: var(--enemy);
    stroke: var(--paper);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .two-inner {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  .vp {
    font-weight: 700;
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }

  .mine-vp {
    color: var(--you);
  }

  .enemy-vp {
    color: var(--enemy);
  }

  .tug {
    position: relative;
    display: flex;
    width: clamp(80px, 14vw, 200px);
    height: 10px;
    overflow: hidden;
    border: 1px solid var(--paper);
    border-radius: 3px;
  }

  .tug-mine {
    flex: 0 0 auto;
    background: var(--you);
  }

  .tug-enemy {
    flex: 1 1 0;
    background: var(--enemy);
  }

  .timer {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }

  .timer.last {
    color: var(--warn);
    font-size: 22px;
    font-weight: 700;
  }

  .exit {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    white-space: nowrap;
  }

  @media (max-width: 960px) {
    .exit-label,
    .chip-name,
    .term {
      display: none;
    }
  }
</style>
