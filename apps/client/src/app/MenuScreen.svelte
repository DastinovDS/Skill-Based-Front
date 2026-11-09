<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../hud/Icon.svelte';
  import LapisButton from '../theme/LapisButton.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { Calibration, MapFile } from '../protocol.gen.ts';
  import AccountChip from './AccountChip.svelte';
  import LocaleSelect from './LocaleSelect.svelte';
  import MenuTabs from './MenuTabs.svelte';
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
    /** The tabs "Replays" and "Leaderboard" (#78, #629). */
    onreplays: () => void;
    onboard: () => void;
    onbot: () => void;
    /** The tab "How to play" (CLI-13): open even while a match runs, reading changes nothing. */
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
    /** The own profile and the settings of the account chip (#871). */
    onprofile?: () => void;
    onsettings?: () => void;
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
    onprofile,
    onsettings,
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
    { label: t('menu.bot'), go: onbot },
    { label: t('menu.create'), go: oncreate },
    { label: t('menu.lobby'), go: onlobby },
  ] as const);

  // The line over Play says what Play is now (a data line, not a caption): the running match, the
  // calibration match to come, the ranked queue, or the unrated play of a guest.
  const kicker = $derived(
    hasActiveMatch
      ? t('menu.matchRunning')
      : !hasPassword
        ? t('menu.kicker.guest')
        : calibration !== null
          ? tf('menu.kicker.calibration', {
              next: Math.min(calibration.played + 1, calibration.total),
              total: calibration.total,
            })
          : t('menu.kicker.ranked'),
  );

  const primary = $derived(hasActiveMatch ? onresume : banned ? null : onqueue);

  // Enter plays (or returns); the account menu keeps its own keys while it is open. Typing in a
  // field and a focused button keep their own keys. The rows have no letter keys.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (menuOpen) return;
    if (target instanceof Element && target.closest('input, textarea, select, button, a')) return;
    if (event.key !== 'Enter' || primary === null) return;
    primary();
    event.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

<ScreenFrame {map} phase={banned ? 'banned' : 'idle'} label={t('menu.nav')}>
  {#snippet tabs()}
    <MenuTabs current="play" playOpen onplay={() => undefined} {onreplays} {onboard} {onhowto} />
  {/snippet}
  {#snippet corner()}
    <AccountChip
      {nick}
      {hasPassword}
      {calibration}
      {rating}
      {onprofile}
      {onsettings}
      {onpassword}
      {onlogout}
      bind:open={menuOpen}
    />
  {/snippet}

  <!-- The Play tab (Lapis, #845): a line over Play, Play (or Return, or the lock), then the three
       ways to play, numbered. Nothing under Play but the lock. -->
  {#if notice !== null}
    <p class="wl" role="alert"><Icon name="alert" size={16} />{t(notice)}</p>
  {/if}
  <p class="kicker">{kicker}</p>
  {#if hasActiveMatch}
    <LapisButton variant="primary" size="lg" class="play" onclick={onresume}>
      <UnitMark side="own" size={36} share={0.6} />{t('menu.resume')}
    </LapisButton>
  {:else}
    <LapisButton variant="primary" size="lg" class="play" disabled={banned} onclick={onqueue}>
      <UnitMark side="own" size={36} />{t('menu.play')}
    </LapisButton>
    {#if banned}
      <p class="sub">
        <span
          class="chip ban"
          role="timer"
          aria-label={tf('menu.banAria', { time: formatClock(secondsLeft) })}
        >
          <Icon name="lock" size={13} />{tf('dock.banChip', { time: formatClock(secondsLeft) })}
        </span>
      </p>
    {/if}
  {/if}
  <ol class="modes">
    {#each modes as mode (mode.label)}
      <li>
        <button type="button" class="row" disabled={hasActiveMatch} onclick={mode.go}
          >{mode.label}</button
        >
      </li>
    {/each}
  </ol>
  <div class="locale"><LocaleSelect /></div>
</ScreenFrame>
