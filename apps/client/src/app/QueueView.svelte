<script lang="ts">
  import type { QueueStatus } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
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
    /** The tab was hidden while searching: a sleeping tab can drop out of the queue. */
    hidden?: boolean;
  }

  let {
    status,
    failure,
    busy,
    map = null,
    onconfirm,
    onleave,
    onbot,
    hidden = false,
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
>
  <!-- The queue (#629, Q1 "Timer only"): the clock and one word; the bot offer only after the
       server makes it (60 s); "Keep this tab open" only once the tab was hidden. -->
  {#if status === null || status.state === 'searching'}
    {@const waited = status?.waited_s ?? 0}
    <div
      class="big static clock"
      role="timer"
      aria-label={tf('queue.waited', { time: formatClock(waited) })}
    >
      {formatClock(waited)}
    </div>
    <div class="sub" role="status">
      {status === null ? t('common.loading') : t('queue.searching')}
    </div>
    {#if hidden}
      <p class="wl"><Icon name="alert" size={16} />{t('queue.keepOpen')}</p>
    {/if}
    <div class="qacts">
      {#if status?.bot_offer === true}
        <button type="button" class="qbtn" onclick={onbot}>
          <Icon name="bot" size={18} />{t('queue.playBot')}<span class="chip"
            >{t('dock.chip.unrated')}</span
          >
        </button>
      {/if}
      <button type="button" class="qbtn ghost" aria-keyshortcuts="Escape" onclick={onleave}>
        {t('queue.leave')}
      </button>
    </div>
  {:else}
    <div class="versus">
      <UnitMark side="enemy" size={34} />
      <span class="name">{opponent}</span>
    </div>
    {#if status.state === 'found' && !status.you_confirmed}
      <div class="confirm">
        <button
          type="button"
          class="qbtn pri"
          aria-keyshortcuts="Enter"
          disabled={busy}
          onclick={onconfirm}
        >
          {t('queue.confirm')}
        </button>
        <span class="count"
          >{tf('queue.seconds', { seconds: Math.ceil(status.confirm_in_s ?? 0) })}</span
        >
      </div>
      <div class="qacts">
        <button type="button" class="qbtn ghost" aria-keyshortcuts="Escape" onclick={onleave}>
          {t('queue.decline')}
        </button>
      </div>
    {:else if status.state === 'found'}
      <p class="sub" role="status">
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
</ScreenFrame>
