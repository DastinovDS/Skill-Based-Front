<script lang="ts">
  import type { MessageKey } from '../i18n/index.ts';
  import { t } from '../i18n/index.ts';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import MapTiles from './MapTiles.svelte';

  interface Props {
    dock: DockContext;
    /** A match for the public lobby instead of an invite link. */
    isPublic?: boolean;
    /** Creates the invite; answers why it failed (the screen stays, the choices are kept), or null. */
    oncreate: (mapId: string | null) => Promise<MessageKey | null>;
    onback: () => void;
  }

  let { dock, isPublic = false, oncreate, onback }: Props = $props();

  const KEY_BACK = 'Esc';

  let mapId = $state<string | null>(null);
  let busy = $state(false);
  let failure = $state.raw<MessageKey | null>(null);

  async function submit(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = null;
    try {
      failure = await oncreate(mapId);
    } finally {
      busy = false;
    }
  }
</script>

<DockFrame
  {dock}
  mode={isPublic ? 'lobby' : 'friend'}
  eyebrow={isPublic ? t('menu.lobby') : t('menu.create')}
  head={isPublic ? t('create.titlePublic') : t('create.title')}
  sub={isPublic ? t('create.introPublic') : t('create.intro')}
  pause={isPublic ? 'none' : 'each'}
  alert={failure === null ? null : t(failure)}
  {onback}
  onenter={() => void submit()}
>
  <MapTiles maps={dock.maps} bind:value={mapId} />
  {#snippet actions()}
    <button type="button" class="btn pri" disabled={busy} onclick={submit}>
      {t('create.submit')}<kbd class="k" aria-hidden="true">↵</kbd>
    </button>
    <button type="button" class="btn link" aria-keyshortcuts="Escape" onclick={onback}>
      {t('common.back')}<kbd class="k" aria-hidden="true">{KEY_BACK}</kbd>
    </button>
  {/snippet}
</DockFrame>
