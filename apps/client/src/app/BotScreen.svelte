<script lang="ts">
  import { untrack } from 'svelte';
  import { NEW_MAP, type BotLevel } from '../api/http.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import LevelPicker from './LevelPicker.svelte';
  import MapTiles from './MapTiles.svelte';
  import VersusStrip from './VersusStrip.svelte';
  import { DRAWING_SLOW_MS } from './waiting.ts';

  interface Props {
    dock: DockContext;
    /** Starts the match; answers why it failed (the screen stays, the choices are kept), or null. */
    onstart: (level: BotLevel, pick: string) => Promise<MessageKey | null>;
    onback: () => void;
    /** Start at once at this level on a new map (the bot offer of the queue). */
    start?: BotLevel;
  }

  let { dock, onstart, onback, start }: Props = $props();

  let level = $state<BotLevel>(untrack(() => start) ?? 'normal');
  let pick = $state(NEW_MAP);
  let busy = $state(false);
  let slow = $state(false);
  let failure = $state.raw<MessageKey | null>(null);

  async function submit(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = null;
    try {
      failure = await onstart(level, pick);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (untrack(() => start) !== undefined) void submit();
  });

  // A new map takes a few seconds (#884); a long wait says so instead of looking stuck.
  $effect(() => {
    if (!busy) {
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

  const drawing = $derived(busy && pick === NEW_MAP);
  const seat = $derived(tf('bot.seat', { level: t(`bot.level.${level}`) }));
</script>

<DockFrame
  {dock}
  mode="bot"
  locked={busy}
  phase={busy ? 'search' : 'idle'}
  eyebrow={t('menu.bot')}
  head={drawing ? t('wait.drawing') : busy ? t('bot.starting') : t('bot.pick')}
  pause="each"
  alert={failure === null ? null : t(failure)}
  note={busy && !drawing ? t('invite.starting') : null}
  onback={busy ? undefined : onback}
  onenter={() => void submit()}
>
  {#if busy}
    <VersusStrip opponent={seat} you={dock.nick} youReady={true} opponentReady={true} />
    {#if drawing}
      <p class="status" role="status">
        <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
        {slow ? t('wait.slow') : t('wait.line')}
      </p>
    {/if}
  {:else}
    <LevelPicker
      value={level}
      onchange={(next: BotLevel) => {
        level = next;
      }}
    />
    <MapTiles maps={dock.maps} bind:value={pick} />
  {/if}
  {#snippet actions()}
    {#if !busy}
      <LapisButton variant="primary" onclick={submit}>{t('bot.start')}</LapisButton>
      <button type="button" class="lnk" aria-keyshortcuts="Escape" onclick={onback}>
        {t('common.back')}
      </button>
    {/if}
  {/snippet}
</DockFrame>
