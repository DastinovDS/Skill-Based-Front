<script lang="ts">
  import { tick } from 'svelte';
  import { t, tf } from '../i18n/index.ts';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

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

  const lockText = $derived(
    banSeconds > 0
      ? tf('exit.rated.lock', { duration: duration(banSeconds) })
      : t('exit.rated.noLock'),
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
  <Dialog
    id="exit"
    role="alertdialog"
    eyebrow={t('exit.eyebrow')}
    title={t('exit.title')}
    describedby="exit-text"
    onkeydown={onKey}
  >
    {#if rated}
      <p class="dlg-lead" id="exit-text">{t('exit.rated.lead')}</p>
      <ul class="dlg-lines">
        <li class="dlg-line warn">
          <Icon name="lock" size={18} />
          <span>{lockText} {t('exit.rated.open')}</span>
        </li>
        <li class="dlg-line">
          <Icon name="info" size={18} />
          <span>{t('exit.rated.early')}</span>
        </li>
      </ul>
    {:else}
      <p class="dlg-lead" id="exit-text">{t('exit.text')}</p>
    {/if}
    {#snippet actions()}
      <!-- Esc still keeps playing (Hud); the key is not printed on the button (#919). -->
      <button
        type="button"
        class="dlg-btn pri"
        aria-keyshortcuts="Escape"
        bind:this={stay}
        onclick={onstay}
      >
        {t('exit.stay')}
      </button>
      <!-- Danger A (#919): minium rules, the enemy hatch inks in on hover; the icon and words. -->
      <button
        type="button"
        class="dlg-btn leave danger lapis-danger"
        bind:this={confirm}
        onclick={onforfeit}
      >
        <Icon name="logout" size={18} />{t('exit.confirm')}
      </button>
    {/snippet}
  </Dialog>
{/if}
