<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import Icon from './Icon.svelte';
  import type { NodeNamer } from './nodeName.ts';
  import type { ToastState } from './toastState.svelte.ts';

  interface Props {
    toasts: ToastState;
    /**
     * Takes the camera to the place a toast names (#1004, item 14); without it no toast is a
     * button.
     */
    onshow?: (node: number) => void;
    /** The name of a place by its id, for the hint of a toast with a place. */
    names?: NodeNamer;
  }

  let { toasts, onshow, names }: Props = $props();
</script>

<!-- Toasts at the top right (ui-style 10.4): up to three, a coloured edge and an icon. A toast
     about a place is a button: a click takes the camera there (#1004). -->
<ul class="toasts" role="status" aria-live="polite" aria-label={t('toast.title')}>
  {#each toasts.current as toast (toast.id)}
    <li class="toast {toast.tone}" class:place={toast.place !== undefined && onshow !== undefined}>
      {#if toast.place !== undefined && onshow !== undefined}
        {@const place = toast.place}
        {@const hint = tf('toast.show', { node: names?.(place) ?? String(place) })}
        <button
          type="button"
          class="go"
          title={hint}
          onclick={() => {
            onshow(place);
          }}
        >
          <Icon name={toast.icon} size={toast.cut === true ? 20 : 16} cut={toast.cut === true} />
          <span class="text">{toast.text}</span>
        </button>
      {:else}
        <Icon name={toast.icon} size={toast.cut === true ? 20 : 16} cut={toast.cut === true} />
        <span class="text">{toast.text}</span>
      {/if}
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

  /* A toast about a place (#1004): the plate is the button; on hover or focus its rules light up
     and the text is underlined (shape as well as tone), the pointer says it is clickable. */
  .go {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
  }

  .toast.place:has(.go:hover),
  .toast.place:has(.go:focus-visible) {
    border-top-color: rgb(236 228 209 / 85%);
    border-right-color: rgb(236 228 209 / 85%);
    border-bottom-color: rgb(236 228 209 / 85%);
    background: rgb(28 24 18 / 97%);
  }

  .go:hover .text,
  .go:focus-visible .text {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  .go:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
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
