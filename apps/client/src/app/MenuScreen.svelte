<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../hud/Icon.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { Calibration, MapFile } from '../protocol.gen.ts';
  import AccountChip from './AccountChip.svelte';
  import LocaleSelect from './LocaleSelect.svelte';
  import ScreenFrame from './ScreenFrame.svelte';
  import UnitMark from './UnitMark.svelte';

  interface Props {
    nick: string;
    notice: MessageKey | null;
    /** The map drawn behind the menu (null: the plain dark page). */
    map?: MapFile | null;
    oncreate: () => void;
    onqueue: () => void;
    onlobby: () => void;
    /** The rows "Replays" (R) and "Leaderboard" (T), #78. */
    onreplays: () => void;
    onboard: () => void;
    onbot: () => void;
    /** The row "How to play" (H, CLI-13): open even while a match runs, reading changes nothing. */
    onhowto: () => void;
    /** The account has a password; without one the way out warns that the account is lost. */
    hasPassword: boolean;
    /** Calibration progress of the account (DEC-34), null for a guest or once it is over. */
    calibration?: Calibration | null;
    /** The displayed rating of a ranked account (#78), null while unknown. */
    rating?: number | null;
    /** The queue is locked until this time (ms since the epoch), or null (DEC-34). */
    banUntil?: number | null;
    /** The clock of the ban countdown; tests pass their own. */
    now?: () => number;
    onpassword: () => void;
    onlogout: () => void;
    /** A match of this guest is running: the way back into it. */
    hasActiveMatch?: boolean;
    onresume?: () => void;
  }

  let {
    nick,
    notice,
    map = null,
    oncreate,
    onqueue,
    onlobby,
    onreplays,
    onboard,
    onbot,
    onhowto,
    hasPassword,
    calibration = null,
    rating = null,
    banUntil = null,
    now = () => Date.now(),
    onpassword,
    onlogout,
    hasActiveMatch = false,
    onresume = () => undefined,
  }: Props = $props();

  // The queue ban counts down on the menu itself: the server says the time once, at the refusal.
  let beat = $state(0);
  const secondsLeft = $derived.by(() => {
    // `beat` is read so that the derived runs again every second.
    return banUntil === null || beat < 0 ? 0 : Math.max(0, Math.ceil((banUntil - now()) / 1000));
  });
  const banned = $derived(!hasActiveMatch && secondsLeft > 0);
  onMount(() => {
    const timer = setInterval(() => {
      beat += 1;
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  });

  let menuOpen = $state(false);

  const modes = $derived([
    { icon: 'bot', label: t('menu.bot'), key: 'B', go: onbot },
    { icon: 'link', label: t('menu.create'), key: 'I', go: oncreate },
    { icon: 'users', label: t('menu.lobby'), key: 'L', go: onlobby },
    { icon: 'history', label: t('menu.replays'), key: 'R', go: onreplays },
    { icon: 'trophy', label: t('menu.leaderboard'), key: 'T', go: onboard },
    { icon: 'info', label: t('help.howTo'), key: 'H', go: onhowto, always: true },
  ] as const);

  const primary = $derived(hasActiveMatch ? onresume : banned ? null : onqueue);

  // Keys of the mockup: Enter plays (or returns), B, I, L, R and T open the other rows, Esc shuts the
  // account menu. Typing in a field and a focused button keep their own keys.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (menuOpen) return;
    if (target instanceof Element && target.closest('input, textarea, select, button, a')) return;
    if (event.key === 'Enter') {
      if (primary === null) return;
      primary();
      event.preventDefault();
      return;
    }
    const mode = modes.find((m) => m.key.toLowerCase() === event.key.toLowerCase());
    if (mode === undefined || (hasActiveMatch && !('always' in mode))) return;
    mode.go();
    event.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

<ScreenFrame {map} phase={banned ? 'banned' : 'idle'} label={t('menu.nav')}>
  {#snippet corner()}
    <AccountChip
      {nick}
      {hasPassword}
      {calibration}
      {rating}
      {onpassword}
      {onlogout}
      bind:open={menuOpen}
    />
  {/snippet}

  {#if notice !== null}
    <p class="wl" role="alert"><Icon name="alert" size={16} />{t(notice)}</p>
  {/if}
  {#if hasActiveMatch}
    <div class="eyebrow">{t('menu.eyebrow.match')}</div>
    <button type="button" class="big" aria-keyshortcuts="Enter" onclick={onresume}>
      <UnitMark side="own" size={44} share={0.6} />{t('menu.resume')}<kbd
        class="k"
        aria-hidden="true">↵</kbd
      >
    </button>
    <div class="sub">{t('menu.matchWaits')}</div>
  {:else if banned}
    <div class="eyebrow warn">{t('menu.eyebrow.banned')}</div>
    <div
      class="big sm warn"
      role="timer"
      aria-label={tf('menu.banAria', { time: formatClock(secondsLeft) })}
    >
      <Icon name="alert" size={40} />{formatClock(secondsLeft)}
    </div>
    <div class="sub">{t('menu.banReason')}</div>
  {:else}
    <div class="eyebrow">{t('menu.eyebrow.ready')}</div>
    <button type="button" class="big" aria-keyshortcuts="Enter" onclick={onqueue}>
      <UnitMark side="own" size={46} />{t('menu.play')}<kbd class="k" aria-hidden="true">↵</kbd>
    </button>
    <div class="sub">{hasPassword ? '' : t('menu.guestHint')}</div>
  {/if}
  <div class="rows">
    {#each modes as mode (mode.key)}
      <button
        type="button"
        class="row"
        disabled={hasActiveMatch && !('always' in mode)}
        aria-keyshortcuts={mode.key}
        onclick={mode.go}
      >
        <Icon name={mode.icon} size={22} />{mode.label}<kbd class="k" aria-hidden="true"
          >{mode.key}</kbd
        >
      </button>
    {/each}
  </div>
  <div class="locale"><LocaleSelect /></div>
</ScreenFrame>
