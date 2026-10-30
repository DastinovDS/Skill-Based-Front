<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';
  import FailurePanel from './FailurePanel.svelte';

  interface Props {
    /** The screen to guard. */
    children: Snippet;
    /** Leave for the menu or the previous screen; without it only the reload is offered. */
    onexit?: () => void;
    /** Reloads the page (a test replaces it). */
    onreload?: () => void;
  }

  let {
    children,
    onexit,
    onreload = () => {
      window.location.reload();
    },
  }: Props = $props();
</script>

<!-- A screen that throws while it renders or in an effect shows this instead of a blank page (CLI-03). -->
<svelte:boundary
  onerror={(error: unknown) => {
    console.error('screen failed', error);
  }}
>
  {@render children()}
  {#snippet failed()}
    <FailurePanel
      title={t('error.crash.title')}
      text={t('error.crash.text')}
      primary={{ label: 'match.reload', run: onreload }}
      {onexit}
    />
  {/snippet}
</svelte:boundary>
