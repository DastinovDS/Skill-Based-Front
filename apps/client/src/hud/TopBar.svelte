<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { HudChrome } from './chrome.svelte.ts';
  import { formatCentis, formatClock } from './format.ts';
  import type { HudData } from './hudData.ts';
  import { LAST_MINUTE_S } from './hudState.svelte.ts';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';
  import { atCap, cpSegments, isPartial, vpShare } from './topBar.ts';

  interface Props {
    data: HudData | null;
    /** Opens the stance menu and the other overlays. */
    orders: OrderController;
    chrome: HudChrome;
    /** The pause of a private match; without it the button is not shown. */
    onpause?: () => void;
    /** This player has used the pause of the match: the button stays but is disabled. */
    pauseUsed?: boolean;
  }

  let { data, orders, chrome, onpause, pauseUsed = false }: Props = $props();

  /** The key itself is not translated. */
  const STANCE_KEY = 'Q';

  const STANCE_ICONS: Record<'economy' | 'balance' | 'war', IconName> = {
    economy: 'economy',
    balance: 'balance',
    war: 'war',
  };

  const locale = $derived(getLocale());
  const segments = $derived(data === null ? [] : cpSegments(data.cp.value, data.cp.cap));
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
        aria-label={tf('bar.cpLabel', {
          value: formatCentis(data.cp.value, locale),
          cap: formatCentis(data.cp.cap, locale),
        })}
      >
        <span class="term">{t('status.cp')}</span>
        <span class="segments" aria-hidden="true">
          {#each segments as fill, i (i)}
            <span class="segment" class:partial={isPartial(fill)}>
              <span class="fill" style:width="{fill}%"></span>
            </span>
          {/each}
        </span>
        <span class="num" class:full>
          {formatCentis(data.cp.value, locale)}/{formatCentis(data.cp.cap, locale)}
        </span>
      </div>
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
        title={pauseUsed ? t('match.pause.used') : t('match.pause')}
        disabled={pauseUsed}
        onclick={onpause}
      >
        <Icon name="pause" />
      </button>
    {/if}
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

  .segments {
    display: flex;
    gap: 2px;
  }

  .segment {
    position: relative;
    width: 20px;
    height: 12px;
    overflow: hidden;
    border: 1px solid var(--you);
    border-radius: 2px;
    background: var(--bg);
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--you);
  }

  /* The partial segment is hatched as well as short, so it reads without colour. */
  .segment.partial .fill {
    background: repeating-linear-gradient(135deg, var(--you) 0 3px, var(--bg) 3px 5px);
  }

  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .num.full {
    color: var(--warn);
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
