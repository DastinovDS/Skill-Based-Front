<script lang="ts">
  import { t } from '../i18n/index.ts';
  import HowToPlay from '../howto/HowToPlay.svelte';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';

  interface Props {
    /** The frame of the screens before a match: the rail, the corner chip, the map. */
    dock: DockContext;
    onback: () => void;
  }

  let { dock, onback }: Props = $props();
</script>

<!-- The page of the rules (CLI-13, #72): the rail keeps the menu, the rules open in the panel. -->
<DockFrame
  {dock}
  mode="howto"
  pause={null}
  eyebrow={t('howto.eyebrow')}
  head={t('help.howTo')}
  sub={t('menu.tagline')}
  {onback}
  onenter={onback}
>
  <HowToPlay />
  {#snippet actions()}
    <button type="button" class="btn pri" aria-keyshortcuts="Enter Escape" onclick={onback}>
      {t('common.back')}
    </button>
  {/snippet}
</DockFrame>
