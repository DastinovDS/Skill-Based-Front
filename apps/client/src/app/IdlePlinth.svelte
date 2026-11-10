<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { NEW_MAP, type BotLevel } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { reducedMotion } from '../render/motion.ts';
  import BotDrawer from './BotDrawer.svelte';
  import DrawingGraph from './DrawingGraph.svelte';
  import GoTablet from './GoTablet.svelte';
  import PauseRule from './PauseRule.svelte';
  import { WAY_PAUSE, WAY_VERB, type BackdropState, type PlayContext, type Way } from './play.ts';
  import VersusLine from './VersusLine.svelte';
  import { DRAWING_SLOW_MS } from './waiting.ts';
  import WayPicker from './WayPicker.svelte';

  interface Props {
    ctx: PlayContext;
    way: Way;
    /** Start a bot match at once at this level on a new map (the queue's offer). */
    start?: BotLevel;
    /** Why the last action failed, from the app (shown above the plinth). */
    notice?: MessageKey | null;
    /** The main-screen motion plays (the first entry, after a match); not after a page. */
    entrance?: boolean;
    /** The width of the drawing sketch on the plinth, px (the size of the window decides). */
    drawWidth: number;
    onbackdrop: (state: BackdropState) => void;
  }

  let { ctx, way, start, notice = null, entrance = false, drawWidth, onbackdrop }: Props = $props();

  let level = $state<BotLevel>(untrack(() => start) ?? 'normal');
  let pick = $state(NEW_MAP);
  /** A bot match or an invite is being asked for: the plinth shows the wait. */
  let busy = $state<'bot' | 'invite' | null>(null);
  let slow = $state(false);
  let failure = $state.raw<MessageKey | null>(null);

  // The queue lock counts down on the plinth: the server says the time once, at the refusal.
  let beat = $state(0);
  const secondsLeft = $derived.by(() => {
    // `beat` is read so that the derived runs again every second.
    const until = ctx.banUntil;
    return until === null || beat < 0
      ? 0
      : Math.max(0, Math.ceil((until - (ctx.now ?? Date.now)()) / 1000));
  });
  const banned = $derived(!ctx.hasActiveMatch && secondsLeft > 0);
  onMount(() => {
    const timer = setInterval(() => {
      beat += 1;
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  });

  $effect(() => {
    onbackdrop({
      phase: busy !== null ? 'search' : banned ? 'banned' : 'idle',
      opponent: null,
      waited: 0,
    });
  });

  async function startBot(): Promise<void> {
    if (busy !== null) return;
    busy = 'bot';
    failure = null;
    try {
      failure = await ctx.onbot(level, pick);
    } finally {
      busy = null;
    }
  }

  async function getLink(): Promise<void> {
    if (busy !== null) return;
    busy = 'invite';
    failure = null;
    try {
      failure = await ctx.oninvite();
    } finally {
      busy = null;
    }
  }

  // The queue's offer of a bot: start at once (the screen shows the wait and a failure).
  onMount(() => {
    if (untrack(() => start) !== undefined) void startBot();
  });

  // A new map takes a few seconds (#884); a long wait says so instead of looking stuck.
  $effect(() => {
    if (busy === null) {
      slow = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      slow = true;
    }, DRAWING_SLOW_MS);
    return () => {
      clearTimeout(timer);
    };
  });

  /** The main button: Return to a running match, else the word of the way. */
  function go(): void {
    if (busy !== null) return;
    if (ctx.hasActiveMatch) ctx.onresume();
    else if (way === 'match') {
      if (!banned) ctx.onsearch();
    } else if (way === 'bot') void startBot();
    else void getLink();
  }

  function choose(next: Way): void {
    failure = null;
    ctx.onway(next);
  }

  // Enter does the main action when no control has the focus (a focused button keeps its own).
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'Enter') return;
    const target = event.target;
    const onControl =
      target instanceof Element &&
      target.closest('input, textarea, select, a, button:not([role="radio"])') !== null;
    if (onControl) return;
    event.preventDefault();
    go();
  }

  const word = $derived(ctx.hasActiveMatch ? t('menu.resume') : t(WAY_VERB[way]));
  const alert = $derived(failure ?? notice);
  const drawing = $derived(busy === 'invite' || (busy === 'bot' && pick === NEW_MAP));
  const seat = $derived(tf('bot.seat', { level: t(`bot.level.${level}`) }));

  // The main-screen motion (#919, item 8; the mockup's `demoMain`): the plinth rises, the ways
  // ink in one after another, the marker drops onto the chosen way, the main button sets behind
  // a burin edge, the options line comes up. Reduced motion: the still end state.
  let plinth: HTMLElement | undefined = $state();
  // Read once, at creation: the app turns it off right after the main screen is up.
  const animate = untrack(() => entrance);
  onMount(() => {
    if (!animate || plinth === undefined || typeof plinth.animate !== 'function') return undefined;
    if (reducedMotion()) return undefined;
    const root = plinth;
    const running: Animation[] = [];
    const play = (
      el: Element | null,
      frames: Keyframe[],
      delay: number,
      duration: number,
      easing: string,
    ): void => {
      if (el === null) return;
      running.push(el.animate(frames, { delay, duration, easing, fill: 'backwards' }));
    };
    const settle = 'cubic-bezier(0.33, 1, 0.68, 1)';
    const engrave = 'cubic-bezier(0.37, 0, 0.63, 1)';
    play(
      root,
      [{ transform: 'translateY(calc(100% + 80px))' }, { transform: 'none' }],
      0,
      900,
      settle,
    );
    root.querySelectorAll('.seg .sl').forEach((label, i) => {
      play(
        label,
        [{ maskPosition: '100% 0' }, { maskPosition: '0 0' }],
        500 + i * 150,
        650,
        engrave,
      );
    });
    play(
      root.querySelector('.mk:not(.ghost)'),
      [
        { opacity: 0, translate: '0 -8px' },
        { opacity: 1, translate: '0 0' },
      ],
      900,
      450,
      settle,
    );
    play(
      root.querySelector('.go'),
      [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
      700,
      800,
      engrave,
    );
    play(root.querySelector('.optl'), [{ opacity: 0 }, { opacity: 1 }], 1100, 500, 'linear');
    return () => {
      for (const animation of running) animation.cancel();
    };
  });
</script>

<svelte:window {onkeydown} />

{#if way === 'bot' && busy === null && !ctx.hasActiveMatch}
  <BotDrawer
    maps={ctx.maps}
    {level}
    {pick}
    onlevel={(next: BotLevel) => {
      level = next;
    }}
    onpick={(next: string) => {
      pick = next;
    }}
  />
{/if}
{#if alert !== null}
  <p class="alert rule-frame stone-panel" role="alert">
    <Icon name="alert" size={16} /><span>{t(alert)}</span>
  </p>
{/if}
<div class="plinth rule-frame stone-panel" bind:this={plinth} data-way={way}>
  {#if busy !== null}
    <!-- Bot: drawing, and Invite: drawing in the same composition (#919, round 2 item 1). -->
    <div class="stat">
      <DrawingGraph width={drawWidth} still={!drawing} />
      <div class="two">
        <p class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {drawing ? (slow ? t('wait.slow') : t('wait.drawing')) : t('bot.starting')}
        </p>
        <VersusLine you={ctx.nick} opponent={busy === 'bot' ? seat : null} />
      </div>
    </div>
    <div class="end">
      <GoTablet word={t(WAY_VERB[way])} disabled />
    </div>
  {:else}
    <WayPicker {way} onchoose={choose} disabled={ctx.hasActiveMatch}>
      {#snippet options()}
        {#if ctx.hasActiveMatch}
          <span class="prule">{t('menu.matchRunning')}</span>
        {:else if way === 'match' && banned}
          <span
            class="prule ban"
            role="timer"
            aria-label={tf('menu.banAria', { time: formatClock(secondsLeft) })}
          >
            <Icon name="lock" size={14} />{tf('dock.banChip', { time: formatClock(secondsLeft) })}
          </span>
        {:else}
          <PauseRule pause={WAY_PAUSE[way]} />
        {/if}
      {/snippet}
    </WayPicker>
    <div class="end">
      <GoTablet
        {word}
        disabled={!ctx.hasActiveMatch && way === 'match' && banned}
        keys="Enter"
        onclick={go}
      />
    </div>
  {/if}
</div>
