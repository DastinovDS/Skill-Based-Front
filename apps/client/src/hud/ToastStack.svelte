<script lang="ts">
  import { t } from '../i18n/index.ts';
  import Icon from './Icon.svelte';
  import type { ToastState } from './toastState.svelte.ts';

  interface Props {
    toasts: ToastState;
  }

  let { toasts }: Props = $props();
</script>

<!-- Toasts at the top right (ui-style 10.4): up to three, a coloured edge and an icon. -->
<ul class="toasts" role="status" aria-live="polite" aria-label={t('toast.title')}>
  {#each toasts.current as toast (toast.id)}
    <li class="toast {toast.tone}">
      <Icon name={toast.icon} size={16} />
      <span class="text">{toast.text}</span>
      <button
        type="button"
        class="close"
        aria-label={t('toast.close')}
        onclick={() => {
          toasts.dismiss(toast.id);
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </li>
  {/each}
</ul>

<style>
  .toasts {
    position: absolute;
    top: 60px;
    right: 12px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(340px, calc(100% - 24px));
    margin: 0;
    padding: 0;
    list-style: none;
    pointer-events: none;
  }

  /* An Engraved plate in a double rule; the tone is a coloured edge and its icon (never colour alone). */
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px 6px 10px;
    border: 1px solid rgb(236 228 209 / 55%);
    border-left: 3px solid var(--neutral);
    background: rgb(14 12 9 / 95%);
    box-shadow:
      inset 0 0 0 2px rgb(14 12 9 / 95%),
      inset 0 0 0 3px rgb(236 228 209 / 18%);
    color: var(--ink);
    font: 500 15px/1.3 var(--font-text);
    animation: toast-in 160ms var(--ease-settle);
  }

  .toast.mine {
    border-left-color: var(--own);
  }

  .toast.enemy {
    border-left-color: var(--enemy);
  }

  .toast.warn {
    border-left-color: var(--warn);
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .close {
    display: grid;
    place-items: center;
    padding: 2px;
    color: var(--text-dim);
    background: none;
    border: none;
    cursor: pointer;
  }

  .close:focus-visible {
    outline: 2px solid var(--paper);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(12px);
    }
  }

  /* The motion setting of the page (#871) decides, not the media query alone. */
  :global(:root[data-motion='reduced']) .toast {
    animation: none;
  }
</style>
