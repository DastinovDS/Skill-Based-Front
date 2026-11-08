<script lang="ts">
  import type { QueueStatus } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import ScreenFrame from './ScreenFrame.svelte';
  import UnitMark from './UnitMark.svelte';

  interface Props {
    /** Null until the first answer. */
    status: QueueStatus | null;
    failure: MessageKey | null;
    /** A confirmation is on its way. */
    busy: boolean;
    map?: MapFile | null;
    onconfirm: () => void;
    onleave: () => void;
    onbot: () => void;
    /** The own nick, for the pair once an opponent is found. */
    nick?: string | null;
  }

  let {
    status,
    failure,
    busy,
    map = null,
    onconfirm,
    onleave,
    onbot,
    nick = null,
  }: Props = $props();

  const searching = $derived(status === null || status.state === 'searching');
  const found = $derived(status?.state === 'found');
  const opponent = $derived(status?.opponent_nick ?? '');
  const phase = $derived(
    searching ? 'search' : status?.you_confirmed === true ? 'confirmed' : 'found',
  );

  // Enter confirms a found pair, Esc leaves the queue or declines, B takes the bot offer.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const onControl = target instanceof Element && target.closest('input, select, button, a');
    if (event.key === 'Enter' && found && status?.you_confirmed === false && !onControl) {
      event.preventDefault();
      onconfirm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onleave();
    } else if (event.key.toLowerCase() === 'b' && searching && status?.bot_offer === true) {
      event.preventDefault();
      onbot();
    }
  }
</script>

<svelte:window {onkeydown} />

<ScreenFrame
  {map}
  {phase}
  opponent={found ? opponent : null}
  waited={status?.waited_s ?? 0}
  label={t('queue.title')}
  center
>
  <!-- The queue (#629, Q1; Lapis, #845): in the middle, a label, the clock and one word; the bot
       offer only after the server makes it (60 s). Spare captions: no "Keep this tab open". -->
  <section class="lead">
    {#if status === null || status.state === 'searching'}
      {@const waited = status?.waited_s ?? 0}
      <p class="kicker">{t('queue.title')}</p>
      <p class="clock" role="timer" aria-label={tf('queue.waited', { time: formatClock(waited) })}>
        {formatClock(waited)}
      </p>
      <p class="sub" role="status">
        <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
        {status === null ? t('common.loading') : t('queue.searching')}
      </p>
      <div class="acts">
        <LapisButton aria-keyshortcuts="Escape" onclick={onleave}>{t('queue.leave')}</LapisButton>
      </div>
      {#if status?.bot_offer === true}
        <div class="offer">
          <LapisButton variant="primary" onclick={onbot}>{t('queue.playBot')}</LapisButton>
          <span class="chip">{t('dock.chip.unrated')}</span>
        </div>
      {/if}
    {:else}
      <p class="kicker">{t('queue.found')}</p>
      <div class="versus">
        <UnitMark side="own" size={38} />
        {#if nick !== null}<span class="name">{nick}</span>{/if}
        <span class="vs-x">{t('versus.against')}</span>
        <span class="name">{opponent}</span>
        <UnitMark side="enemy" size={38} />
      </div>
      {#if status.state === 'found' && !status.you_confirmed}
        <p class="sub" role="timer">
          {tf('queue.confirmWithin', { seconds: Math.ceil(status.confirm_in_s ?? 0) })}
        </p>
        <div class="acts">
          <LapisButton
            variant="primary"
            aria-keyshortcuts="Enter"
            disabled={busy}
            onclick={onconfirm}>{t('queue.confirm')}</LapisButton
          >
          <LapisButton aria-keyshortcuts="Escape" onclick={onleave}
            >{t('queue.decline')}</LapisButton
          >
        </div>
      {:else if status.state === 'found'}
        <p class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {tf('queue.waitingFor', {
            nick: opponent,
            seconds: Math.ceil(status.confirm_in_s ?? 0),
          })}
        </p>
      {:else}
        <p class="sub" role="status">{t('queue.starting')}</p>
      {/if}
    {/if}
    {#if failure !== null}
      <p class="wl" role="alert"><Icon name="alert" size={16} />{t(failure)}</p>
    {/if}
  </section>
</ScreenFrame>
