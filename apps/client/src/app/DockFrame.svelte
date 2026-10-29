<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../hud/Icon.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf } from '../i18n/index.ts';
  import AccountChip from './AccountChip.svelte';
  import type { DockContext, DockMode } from './dock.ts';
  import './dock.css';
  import type { BackdropPhase } from './menuScene.ts';
  import ScreenFrame from './ScreenFrame.svelte';
  import UnitMark from './UnitMark.svelte';

  interface Props {
    dock: DockContext;
    /** The mode this screen is: its row in the rail is marked. */
    mode: DockMode;
    /**
     * The other modes are off (a waiting room: leaving drops the invite). The rail rows, the
     * player chip and the keys B, I and L do nothing; the screen's own "Leave" is the way out.
     */
    locked?: boolean;
    /** What the map says: waiting (marching road), a pair found (solid road and the nick). */
    phase?: Exclude<BackdropPhase, 'banned'>;
    opponent?: string | null;
    /** The small caps line over the title, and the title of the panel. */
    eyebrow: string;
    head: string;
    sub?: string | null;
    /** DEC-05: a public match has no pauses. */
    pause: 'none' | 'each';
    /** An error or a notice that stays on the screen (amber, with the sign). */
    alert?: string | null;
    /** One more line under the "Unrated" line. */
    note?: string | null;
    /** Esc: the way back (the screen decides what leaving does). */
    onback?: () => void;
    /** Enter, when no control has the focus: the main action of the panel. */
    onenter?: () => void;
    children: Snippet;
    actions: Snippet;
  }

  let {
    dock,
    mode,
    locked = false,
    phase = 'idle',
    opponent = null,
    eyebrow,
    head,
    sub = null,
    pause,
    alert = null,
    note = null,
    onback,
    onenter,
    children,
    actions,
  }: Props = $props();

  // The queue ban counts down here too: the server says the time once, at the refusal (DEC-34).
  let beat = $state(0);
  const secondsLeft = $derived.by(() => {
    // `beat` is read so that the derived runs again every second.
    return dock.banUntil === null || beat < 0
      ? 0
      : Math.max(0, Math.ceil((dock.banUntil - (dock.now ?? Date.now)()) / 1000));
  });
  const banned = $derived(secondsLeft > 0);
  $effect(() => {
    const timer = setInterval(() => {
      beat += 1;
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  });

  let accountOpen = $state(false);

  // Keyboard keys are not words of a language: they are labelled the same in every locale.
  const modes = $derived([
    { id: 'bot', icon: 'bot', label: t('menu.bot'), key: 'B', go: dock.onbot },
    { id: 'friend', icon: 'link', label: t('menu.create'), key: 'I', go: dock.oncreate },
    { id: 'lobby', icon: 'users', label: t('menu.lobby'), key: 'L', go: dock.onlobby },
    { id: 'replays', icon: 'history', label: t('menu.replays'), key: 'R', go: dock.onreplays },
    { id: 'board', icon: 'trophy', label: t('menu.leaderboard'), key: 'T', go: dock.onboard },
  ] as const);

  const unrated = $derived(
    !dock.hasPassword
      ? t('dock.unrated.guest')
      : dock.calibration !== null
        ? t('dock.unrated.calibration')
        : t('dock.unrated.rated'),
  );

  // Esc goes back, Enter does the main action; B, I and L open the other modes (as in the menu)
  // unless the screen is a waiting room. A field or a button keeps its own keys; the tiles and
  // levels (radios) do not, so Enter after a choice starts the match.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (accountOpen) return;
    if (event.key === 'Escape') {
      if (onback === undefined) return;
      event.preventDefault();
      onback();
      return;
    }
    const target = event.target;
    const onControl =
      target instanceof Element &&
      target.closest('input, textarea, select, a, button:not([role="radio"])') !== null;
    if (onControl) return;
    if (event.key === 'Enter') {
      if (onenter === undefined) return;
      event.preventDefault();
      onenter();
      return;
    }
    if (locked) return;
    const next = modes.find((m) => m.key.toLowerCase() === event.key.toLowerCase());
    if (next === undefined || next.id === mode) return;
    event.preventDefault();
    next.go();
  }
</script>

<svelte:window {onkeydown} />

<ScreenFrame
  map={dock.map}
  phase={phase === 'idle' && banned ? 'banned' : phase}
  {opponent}
  label={t('menu.nav')}
  panelLabel={eyebrow}
>
  {#snippet corner()}
    {#if banned}
      <span
        class="chip ban"
        role="timer"
        aria-label={tf('menu.banAria', { time: formatClock(secondsLeft) })}
      >
        <Icon name="alert" size={14} />{tf('dock.banChip', { time: formatClock(secondsLeft) })}
      </span>
    {/if}
    <AccountChip
      nick={dock.nick}
      hasPassword={dock.hasPassword}
      calibration={dock.calibration}
      rating={dock.rating ?? null}
      onpassword={dock.onpassword}
      onlogout={dock.onlogout}
      inert={locked}
      bind:open={accountOpen}
    />
  {/snippet}

  <!-- The rail is the menu, still: Play is dimmed (it is the way back), the open mode is marked. -->
  <div class="dockhead">
    {#if banned}
      <div class="eyebrow warn">{t('menu.eyebrow.banned')}</div>
      <div class="big sm warn" aria-hidden="true">
        <Icon name="alert" size={40} />{formatClock(secondsLeft)}
      </div>
      <div class="sub">{t('menu.banReason')}</div>
    {:else}
      <div class="eyebrow">{t('menu.eyebrow.ready')}</div>
      <button type="button" class="big dim" disabled={locked} onclick={dock.onmenu}>
        <UnitMark side="own" size={46} />{t('menu.play')}
      </button>
      <div class="sub"></div>
    {/if}
  </div>
  <div class="rows">
    {#each modes as m (m.id)}
      <button
        type="button"
        class="row"
        class:cur={m.id === mode}
        aria-current={m.id === mode ? 'page' : undefined}
        aria-keyshortcuts={m.key}
        disabled={locked && m.id !== mode}
        onclick={m.id === mode ? undefined : m.go}
      >
        <Icon name={m.icon} size={22} />{m.label}<kbd class="k" aria-hidden="true">{m.key}</kbd>
      </button>
    {/each}
  </div>

  {#snippet panel()}
    <div class="pe">{eyebrow}</div>
    <div class="ph">
      <h2>{head}</h2>
      <div class="tags">
        <span class="chip">{t('dock.chip.unrated')}</span>
        <span class="chip">{pause === 'none' ? t('dock.chip.noPause') : t('dock.chip.pause')}</span>
      </div>
    </div>
    {#if sub !== null && sub !== ''}<p class="ps">{sub}</p>{/if}
    {@render children()}
    {#if alert !== null}
      <p class="wl" role="alert"><Icon name="alert" size={16} /><span>{alert}</span></p>
    {/if}
    {#if banned}
      <p class="wl"><Icon name="alert" size={16} /><span>{t('dock.banLine')}</span></p>
    {/if}
    <p class="note">{unrated}</p>
    {#if note !== null}<p class="note">{note}</p>{/if}
    <div class="acts">{@render actions()}</div>
  {/snippet}
</ScreenFrame>
