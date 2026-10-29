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
  }

  // Keyboard keys are not words of a language: they are labelled the same in every locale.
  const KEY_BOT = 'B';
  const KEY_LEAVE = 'Esc';

  let { status, failure, busy, map = null, onconfirm, onleave, onbot }: Props = $props();

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
  {#if status === null}
    <div class="eyebrow">{t('queue.title')}</div>
    <p class="sub" role="status">{t('common.loading')}</p>
  {:else if status.state === 'searching'}
    <div class="eyebrow">{t('queue.title')}</div>
    <div
      class="big sm static"
      role="timer"
      aria-label={tf('queue.waited', { time: formatClock(status.waited_s) })}
    >
      {formatClock(status.waited_s)}
    </div>
    <div class="sub">
      <span role="status">{t('queue.searching')}</span>
      <span>{tf('queue.size', { count: status.queue_size })}</span>
    </div>
    <p class="hint">{t('queue.keepOpen')}</p>
    {#if status.bot_offer}
      <p class="hint">{t('queue.botOffer')}</p>
      <div class="rows">
        <button type="button" class="row" aria-keyshortcuts="B" onclick={onbot}>
          <Icon name="bot" size={22} />{t('queue.playBot')}<kbd class="k" aria-hidden="true"
            >{KEY_BOT}</kbd
          >
        </button>
      </div>
    {/if}
  {:else if status.state === 'found'}
    <div class="eyebrow">{t('queue.foundTitle')}</div>
    <div class="versus">
      <UnitMark side="enemy" size={34} />
      <span class="name">{opponent}</span>
    </div>
    {#if status.you_confirmed}
      <div class="big sm static" role="status">{tf('queue.waitingFor', { nick: opponent })}</div>
      <div class="sub">
        <span>{t('queue.youConfirmed')}</span>
        {#if status.opponent_confirmed}<span>{t('queue.opponentConfirmed')}</span>{/if}
      </div>
    {:else}
      <button
        type="button"
        class="big"
        aria-keyshortcuts="Enter"
        disabled={busy}
        onclick={onconfirm}
      >
        {t('queue.confirm')}<kbd class="k" aria-hidden="true">↵</kbd>
        <span class="count"
          >{tf('queue.seconds', { seconds: Math.ceil(status.confirm_in_s ?? 0) })}</span
        >
      </button>
      <div class="sub">
        <span>{t('queue.confirmHint')}</span>
        {#if status.opponent_confirmed}<span>{t('queue.opponentConfirmed')}</span>{/if}
      </div>
    {/if}
  {:else}
    <div class="eyebrow">{t('queue.foundTitle')}</div>
    <p class="sub" role="status">{t('queue.starting')}</p>
  {/if}
  {#if failure !== null}
    <p class="wl" role="alert"><Icon name="alert" size={16} />{t(failure)}</p>
  {/if}
  <div class="leave">
    <button type="button" class="linkbtn" aria-keyshortcuts="Escape" onclick={onleave}>
      {found ? t('queue.decline') : t('queue.leave')}<kbd class="k" aria-hidden="true"
        >{KEY_LEAVE}</kbd
      >
    </button>
  </div>
</ScreenFrame>
