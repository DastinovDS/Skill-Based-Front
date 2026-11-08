<script lang="ts">
  import { t } from '../i18n/index.ts';
  import HowToPlay from '../howto/HowToPlay.svelte';
  import LapisButton from '../theme/LapisButton.svelte';
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
  <p class="copyright">{t('howto.copyright')}</p>
  {#snippet actions()}
    <LapisButton variant="primary" aria-keyshortcuts="Enter Escape" onclick={onback}
      >{t('common.back')}</LapisButton
    >
  {/snippet}
</DockFrame>

<style>
  .copyright {
    margin: 24px 0 0;
    font-size: 14px;
    color: var(--ink-dim);
  }
</style>
