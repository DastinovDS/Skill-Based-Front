<script lang="ts">
  import { tick } from 'svelte';
  import { t, tf } from '../i18n/index.ts';

  interface Props {
    open: boolean;
    /** A ranked match (DEC-34): the warning names the queue lock a forfeit can bring. */
    rated?: boolean;
    /** Seconds the queue would be locked for a forfeit now, as the server says (`welcome.forfeit_ban_s`); 0: no lock. */
    banSeconds?: number;
    /** The player confirmed: forfeit the match. */
    onforfeit: () => void;
    onstay: () => void;
  }

  let { open, rated = false, banSeconds = 0, onforfeit, onstay }: Props = $props();

  let stay: HTMLButtonElement | undefined = $state();
  let confirm: HTMLButtonElement | undefined = $state();

  // The safe answer has the focus; Tab stays inside the dialog.
  $effect(() => {
    if (open) void tick().then(() => stay?.focus());
  });

  /** Display only: the server's length in whole hours or rounded-up minutes. */
  function duration(seconds: number): string {
    if (seconds % 3600 === 0) return tf('exit.duration.hours', { n: seconds / 3600 });
    return tf('exit.duration.minutes', { n: Math.ceil(seconds / 60) });
  }

  const ratedText = $derived(
    [
      t('exit.rated.lead'),
      banSeconds > 0
        ? tf('exit.rated.lock', { duration: duration(banSeconds) })
        : t('exit.rated.noLock'),
      t('exit.rated.early'),
    ].join(' '),
  );

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const order = [stay, confirm];
    const at = order.findIndex((button) => button === document.activeElement);
    const next = (at + (event.shiftKey ? order.length - 1 : 1)) % order.length;
    event.preventDefault();
    order[next]?.focus();
  }
</script>

{#if open}
  <div class="backdrop">
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exit-title"
      aria-describedby="exit-text"
      tabindex="-1"
      onkeydown={onKey}
    >
      <h2 id="exit-title">{t('exit.title')}</h2>
      <p id="exit-text">{rated ? ratedText : t('exit.text')}</p>
      <div class="actions">
        <button type="button" class="danger" bind:this={confirm} onclick={onforfeit}>
          {t('exit.confirm')}
        </button>
        <button type="button" class="primary" bind:this={stay} onclick={onstay}>
          {t('exit.stay')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--scrim);
    pointer-events: auto;
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(420px, 100%);
    padding: 18px 20px;
    box-sizing: border-box;
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
  }

  h2,
  p {
    margin: 0;
  }

  p {
    line-height: 1.4;
  }

  h2 {
    font-size: 18px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    min-width: 0;
    padding: 6px 12px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  button:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .primary {
    background: var(--you);
    border-color: var(--paper);
    color: var(--bg);
    font-weight: 600;
  }

  .danger {
    border-color: var(--enemy);
  }
</style>
