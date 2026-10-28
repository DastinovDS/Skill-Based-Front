<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';

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
    <main class="crash" role="alert">
      <p>{t('error.crash')}</p>
      <p class="actions">
        <button type="button" onclick={onreload}>{t('match.reload')}</button>
        {#if onexit !== undefined}
          <button type="button" onclick={onexit}>{t('match.toMenu')}</button>
        {/if}
      </p>
    </main>
  {/snippet}
</svelte:boundary>

<style>
  .crash {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
  }

  p {
    margin: 0;
  }

  .actions {
    display: flex;
    gap: 8px;
  }
</style>
