<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The main action of the bar: filled. */
    primary?: boolean;
    /** The hotkey shown on the button (the caller handles the key). */
    keyHint?: string | null;
    /** The key for assistive technology (`aria-keyshortcuts`). */
    shortcut?: string | null;
    onclick: () => void;
    children: Snippet;
  }

  let { primary = false, keyHint = null, shortcut = null, onclick, children }: Props = $props();
</script>

<button type="button" class:primary aria-keyshortcuts={shortcut ?? undefined} {onclick}>
  {@render children()}
  {#if keyHint !== null}<kbd aria-hidden="true">{keyHint}</kbd>{/if}
</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--text-dim);
  }

  button:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .primary {
    border-color: var(--paper);
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  kbd {
    display: inline-block;
    min-width: 22px;
    height: 22px;
    box-sizing: border-box;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 19px;
    text-align: center;
  }

  .primary kbd {
    border-color: var(--bg);
    background: var(--bg);
    color: var(--text);
  }
</style>
