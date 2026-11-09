<script lang="ts">
  import { NEW_MAP } from '../api/http.ts';
  import type { MessageKey } from '../i18n/index.ts';
  import { t } from '../i18n/index.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import MapTiles from './MapTiles.svelte';

  interface Props {
    dock: DockContext;
    /** A match for the public lobby instead of an invite link. */
    isPublic?: boolean;
    /** Creates the invite; answers why it failed (the screen stays, the choices are kept), or null. */
    oncreate: (pick: string) => Promise<MessageKey | null>;
    onback: () => void;
  }

  let { dock, isPublic = false, oncreate, onback }: Props = $props();

  // A new map by default, a public match too: it is unrated as well (#889).
  let pick = $state(NEW_MAP);
  let busy = $state(false);
  let failure = $state.raw<MessageKey | null>(null);

  async function submit(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = null;
    try {
      failure = await oncreate(pick);
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
  pause={isPublic ? 'none' : 'each'}
  alert={failure === null ? null : t(failure)}
  {onback}
  onenter={() => void submit()}
>
  <MapTiles maps={dock.maps} bind:value={pick} />
  {#snippet actions()}
    <LapisButton variant="primary" disabled={busy} onclick={submit}
      >{t('create.submit')}</LapisButton
    >
    <button type="button" class="lnk" aria-keyshortcuts="Escape" onclick={onback}>
      {t('common.back')}
    </button>
  {/snippet}
</DockFrame>
