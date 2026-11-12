<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The main action of the bar: the ivory tablet; the others are two rules. */
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

<!-- The Lapis button of the game (`.lapis-btn`, theme/primitives.css), sized for a bar. -->
<button
  type="button"
  class="lapis-btn bar-btn {primary ? 'primary' : 'secondary'}"
  aria-keyshortcuts={shortcut ?? undefined}
  {onclick}
>
  {@render children()}
  {#if keyHint !== null}<kbd aria-hidden="true">{keyHint}</kbd>{/if}
</button>

<style>
  .bar-btn,
  .bar-btn.primary {
    height: 40px;
    gap: 10px;
    padding: 0 18px;
    font-size: 12px;
    letter-spacing: 0.18em;
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    box-sizing: border-box;
    padding: 0 6px;
    border: 1px solid currentcolor;
    border-radius: 2px;
    font: 500 12px / 1 var(--font-text);
    letter-spacing: 0;
    text-transform: none;
    opacity: 0.8;
  }
</style>
