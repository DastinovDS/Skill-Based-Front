<script lang="ts">
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import StatusButton from './StatusButton.svelte';

  interface Props {
    /** The one thing that happened, in a few words. */
    title: string;
    /** What it means and what to do, one plain sentence. */
    text: string;
    /** The main action (`Enter`): Retry, Reload. */
    primary: { label: 'match.retry' | 'match.reload'; run: () => void };
    /** The way out to the menu (`Esc`), if there is a screen to go to. */
    onexit?: (() => void) | undefined;
  }

  let { title, text, primary, onexit }: Props = $props();

  // `Enter` on a focused button presses that button, not the main action.
  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      primary.run();
    } else if (event.key === 'Escape' && onexit !== undefined) {
      event.preventDefault();
      onexit();
    }
  }
</script>

<!-- A whole screen that failed (the map did not load, the screen crashed): the `!` in amber, plain
     words, the way out. Self-contained on purpose: the crash screen must not depend on the screens
     that may be the thing that crashed. -->
<svelte:window {onkeydown} />

<main class="failure" role="alert">
  <div class="card">
    <span class="badge"><Icon name="alert" size={26} /></span>
    <h1>{title}</h1>
    <p>{text}</p>
    <div class="actions">
      <StatusButton primary keyHint="↵" shortcut="Enter" onclick={primary.run}
        >{t(primary.label)}</StatusButton
      >
      {#if onexit !== undefined}
        <StatusButton keyHint="Esc" shortcut="Escape" onclick={onexit}
          >{t('match.toMenu')}</StatusButton
        >
      {/if}
    </div>
  </div>
</main>

<style>
  .failure {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--text);
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    box-sizing: border-box;
    width: min(440px, 100%);
    padding: 24px 28px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--warn);
    border-radius: 10px;
    background: var(--surface);
  }

  .badge {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--warn);
    color: var(--bg);
  }

  h1 {
    margin: 6px 0 0;
    font-size: 24px;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }

  p {
    margin: 0;
    font-size: 16px;
    line-height: 1.4;
    color: var(--text-dim);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
</style>
