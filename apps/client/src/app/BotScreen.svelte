<script lang="ts">
  import type { BotLevel } from '../api/http.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import LevelPicker from './LevelPicker.svelte';
  import MapTiles from './MapTiles.svelte';
  import VersusStrip from './VersusStrip.svelte';

  interface Props {
    dock: DockContext;
    /** Starts the match; answers why it failed (the screen stays, the choices are kept), or null. */
    onstart: (level: BotLevel, mapId: string | null) => Promise<MessageKey | null>;
    onback: () => void;
  }

  let { dock, onstart, onback }: Props = $props();

  const KEY_BACK = 'Esc';

  let level = $state<BotLevel>('normal');
  let mapId = $state<string | null>(null);
  let busy = $state(false);
  let failure = $state.raw<MessageKey | null>(null);

  async function submit(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = null;
    try {
      failure = await onstart(level, mapId);
    } finally {
      busy = false;
    }
  }

  const seat = $derived(tf('bot.seat', { level: t(`bot.level.${level}`) }));
</script>

<DockFrame
  {dock}
  mode="bot"
  locked={busy}
  phase={busy ? 'search' : 'idle'}
  eyebrow={t('menu.bot')}
  head={busy ? t('bot.starting') : t('bot.pick')}
  pause="each"
  alert={failure === null ? null : t(failure)}
  note={busy ? t('invite.starting') : null}
  onback={busy ? undefined : onback}
  onenter={() => void submit()}
>
  {#if busy}
    <VersusStrip opponent={seat} youReady={true} opponentReady={true} />
  {:else}
    <LevelPicker
      value={level}
      onchange={(next: BotLevel) => {
        level = next;
      }}
    />
    <MapTiles maps={dock.maps} bind:value={mapId} />
  {/if}
  {#snippet actions()}
    {#if !busy}
      <button type="button" class="btn pri" onclick={submit}>
        {t('bot.start')}<kbd class="k" aria-hidden="true">↵</kbd>
      </button>
      <button type="button" class="btn link" aria-keyshortcuts="Escape" onclick={onback}>
        {t('common.back')}<kbd class="k" aria-hidden="true">{KEY_BACK}</kbd>
      </button>
    {/if}
  {/snippet}
</DockFrame>
