<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../i18n/index.ts';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  // No rating at the MVP (#919): the ranked variant of this dialog went with the pop-up catalogue
  // (#765, H4); it comes back with the rating.
  interface Props {
    open: boolean;
    /** The player confirmed: forfeit the match. */
    onforfeit: () => void;
    onstay: () => void;
  }

  let { open, onforfeit, onstay }: Props = $props();

  let stay: HTMLButtonElement | undefined = $state();
  let confirm: HTMLButtonElement | undefined = $state();

  // The safe answer has the focus; Tab stays inside the dialog.
  $effect(() => {
    if (open) void tick().then(() => stay?.focus());
  });

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
    <p class="dlg-lead" id="exit-text">{t('exit.text')}</p>
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
